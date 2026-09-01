// A foto de perfil do WhatsApp do contato.
//
// Este arquivo é o único lugar que sabe buscar, baixar e guardar essa imagem.
// Ele é usado por dois chamadores diferentes, e por isso mora aqui e não dentro
// de uma função:
//   * `wa-webhook`, quando um número novo escreve pela primeira vez;
//   * `wa-avatar`, quando a tela pede para reconferir as conversas antigas.
//
// O CAMINHO DA IMAGEM, e por que ele não é simplesmente a URL do WhatsApp:
// a Evolution devolve um endereço assinado do `pps.whatsapp.net` que expira em
// poucas horas. Guardá-lo daria uma foto boa hoje e um quadrado quebrado
// amanhã. Então baixamos a imagem e a guardamos no bucket privado
// `whatsapp-midia`, no mesmo esquema das fotos do cadastro (migração 007): o
// banco guarda o caminho, e a tela pede uma URL assinada na hora de exibir.
//
// A API, conferida no Swagger da instância (a versão Go, não a Node):
//   POST /user/avatar  com { number, preview }  ->  gin.H
//
// O `number` TEM QUE SER O JID COMPLETO ("5547...@s.whatsapp.net"), e esta é a
// linha mais importante do arquivo. Medido contra a instância de produção:
//
//   número cru  "5547991868646"                 -> pendura para sempre (sem
//                                                  resposta, sem erro; morre no
//                                                  tempo limite)
//   JID         "5547991868646@s.whatsapp.net"  -> responde em 0,3 s
//
// A resolução interna do número é o que trava. O sintoma é traiçoeiro porque
// não é um erro: a chamada simplesmente nunca volta, e a função inteira fica
// pendurada até a plataforma matá-la — sem gravar nada e sem dizer por quê.
// Foi exatamente o que aconteceu na primeira versão desta funcionalidade.
//
// Formato da resposta, quando dá certo (conferido na instância):
//   { "data": { "url": "https://pps.whatsapp.net/...", "id": "1947561686",
//               "type": "image", "direct_path": "..." } }
// Quando a pessoa não tem foto visível, vem HTTP 500 com
//   { "error": "that user or group does not have a profile picture" }
// — que é resposta legítima, e não falha (ver abaixo).
//
// Ainda assim lemos os campos com tolerância: as versões da Evolution já
// mudaram o nome disso mais de uma vez.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { chamarEvolution } from './evolution.ts'
import { numeroParaJid } from './telefone.ts'

const BUCKET = 'whatsapp-midia'

// Quanto tempo uma foto conferida vale antes de valer a pena olhar de novo.
// Gente troca foto de perfil em semanas, não em minutos; sete dias evita
// conversa com a foto de dois anos atrás sem transformar a abertura da caixa de
// entrada numa saraivada de chamadas à Evolution.
export const VALIDADE_DIAS = 7

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  // service_role: escreve o caminho da foto e sobe o arquivo sem depender de um
  // usuário logado — o webhook não tem nenhum.
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// A resposta é `gin.H` (mapa solto). Estes são os nomes já vistos em versões
// diferentes da Evolution; a primeira chave que existir vence.
function lerCampo(corpo: any, nomes: string[]): string {
  const fontes = [corpo, corpo?.data, corpo?.Data, corpo?.result]
  for (const fonte of fontes) {
    if (!fonte || typeof fonte !== 'object') continue
    for (const nome of nomes) {
      const valor = fonte[nome]
      if (typeof valor === 'string' && valor) return valor
    }
  }
  return ''
}

// Impressão digital do conteúdo, para o caminho mudar quando a foto mudar.
//
// Sem isto, a foto nova sobrescreveria o mesmo caminho e o navegador continuaria
// mostrando a antiga do cache — o bug clássico de avatar que "não atualiza".
// Com isto, foto nova é caminho novo, e caminho novo é URL nova.
async function digital(bytes: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hash)].slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

type Resultado = { mudou: boolean; motivo: string }

// Confere (e guarda, se preciso) a foto de UM número.
//
// Nunca lança: esta rotina é enfeite de tela. Se a Evolution estiver fora do ar
// ou o contato tiver escondido a foto, a conversa continua funcionando com as
// iniciais — que é o que já acontecia antes desta funcionalidade existir.
export async function sincronizarAvatar(
  conversa: { id: string; numero: string; avatar_id?: string | null; avatar_path?: string | null },
  { forcar = false }: { forcar?: boolean } = {},
): Promise<Resultado> {
  const { id, numero } = conversa
  if (!id || !numero) return { mudou: false, motivo: 'conversa sem número' }

  // O JID, e não o número. Ver o cabeçalho: com o número cru esta chamada não
  // volta nunca.
  const jid = numeroParaJid(numero)
  if (!jid) return { mudou: false, motivo: 'número fora do formato esperado' }

  try {
    const resposta = await chamarEvolution('/user/avatar', {
      metodo: 'POST',
      // `preview: false` traz a imagem grande (uns 640px). A pequena tem 96px e
      // ficaria borrada na ficha do cliente, que mostra a foto a 96px em tela
      // retina — ou seja, 192 pixels de verdade.
      corpo: { number: jid, preview: false },
    })

    // "Não tem foto" chega como ERRO HTTP, e não como resposta vazia: a
    // instância devolve 500 com "that user or group does not have a profile
    // picture". Isso é resposta legítima — a pessoa não pôs foto, ou pôs a
    // privacidade em "meus contatos" e você não está na lista dela. Marcar
    // `avatar_ausente` é o que impede de perguntar de novo a cada carregamento.
    if (!resposta.ok) {
      const texto = String(resposta.corpo?.error ?? resposta.corpo ?? '')
      const semFoto = resposta.status === 404 ||
        /does not have a profile picture|no (avatar|profile picture)|not found/i.test(texto)
      if (semFoto) {
        await supabase.from('conversas')
          .update({ avatar_ausente: true, avatar_em: new Date().toISOString() })
          .eq('id', id)
        return { mudou: false, motivo: 'contato sem foto visível' }
      }
      // Erro de verdade (instância caída, 401): NÃO carimba `avatar_em`, para a
      // próxima tentativa acontecer assim que a Evolution voltar.
      return { mudou: false, motivo: `evolution respondeu ${resposta.status}` }
    }

    const url = lerCampo(resposta.corpo, ['url', 'URL', 'profilePictureUrl', 'pictureUrl', 'avatar'])
    const idFoto = lerCampo(resposta.corpo, ['id', 'ID', 'pictureId', 'PictureID'])

    if (!url) {
      await supabase.from('conversas')
        .update({ avatar_ausente: true, avatar_em: new Date().toISOString() })
        .eq('id', id)
      return { mudou: false, motivo: 'contato sem foto visível' }
    }

    // Atalho: mesmo id da última vez e o arquivo já está guardado. Não baixa
    // nada — é o caso comum, e é o que torna a reconferência semanal barata.
    if (!forcar && idFoto && idFoto === conversa.avatar_id && conversa.avatar_path) {
      await supabase.from('conversas')
        .update({ avatar_em: new Date().toISOString(), avatar_ausente: false })
        .eq('id', id)
      return { mudou: false, motivo: 'foto inalterada' }
    }

    const imagem = await fetch(url)
    if (!imagem.ok) return { mudou: false, motivo: `download falhou (${imagem.status})` }
    const bytes = await imagem.arrayBuffer()
    if (!bytes.byteLength) return { mudou: false, motivo: 'imagem vazia' }

    const caminho = `avatares/${numero}/${await digital(bytes)}.jpg`

    // O caminho já é o mesmo: a pessoa não trocou a foto, só o id mudou de
    // formato entre versões da Evolution. Nada a subir.
    if (caminho !== conversa.avatar_path) {
      const { error: erroUpload } = await supabase.storage.from(BUCKET).upload(caminho, bytes, {
        contentType: imagem.headers.get('content-type') || 'image/jpeg',
        upsert: true,
      })
      if (erroUpload) return { mudou: false, motivo: `storage: ${erroUpload.message}` }

      // A foto antiga não serve mais para ninguém. Falha aqui é ignorada de
      // propósito: um arquivo órfão no bucket é bem menos grave do que uma
      // exceção que derruba a sincronização inteira.
      if (conversa.avatar_path) {
        await supabase.storage.from(BUCKET).remove([conversa.avatar_path]).catch(() => {})
      }
    }

    await supabase.from('conversas').update({
      avatar_path: caminho,
      avatar_id: idFoto || null,
      avatar_em: new Date().toISOString(),
      avatar_ausente: false,
    }).eq('id', id)

    return { mudou: caminho !== conversa.avatar_path, motivo: 'foto atualizada' }
  } catch (falha) {
    return { mudou: false, motivo: (falha as Error)?.message ?? 'falha desconhecida' }
  }
}

// Confere várias conversas, em fila.
//
// EM FILA, E NÃO EM PARALELO, de propósito: a Evolution conversa com um único
// aparelho pareado do outro lado. Vinte pedidos simultâneos é o jeito conhecido
// de o WhatsApp achar que aquilo não é gente e limitar a instância. Uma de cada
// vez é lento e é o certo — e ninguém está esperando na frente da tela, porque
// isto roda em segundo plano.
export async function sincronizarVarios(
  lista: Array<{ id: string; numero: string; avatar_id?: string | null; avatar_path?: string | null }>,
  { forcar = false }: { forcar?: boolean } = {},
) {
  let atualizadas = 0
  for (const conversa of lista) {
    const { mudou } = await sincronizarAvatar(conversa, { forcar })
    if (mudou) atualizadas++
  }
  return { conferidas: lista.length, atualizadas }
}
