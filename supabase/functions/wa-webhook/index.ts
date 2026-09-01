// Recebe os eventos da Evolution Go e grava a conversa.
//
// ESTA FUNÇÃO É PÚBLICA. Ela roda com verify_jwt = false (ver config.toml)
// porque quem a chama é a Evolution, que não tem login do Waterfall. Sem uma
// tranca própria, qualquer pessoa da internet injetaria mensagem falsa no seu
// CRM. A tranca é o WEBHOOK_TOKEN, conferido na primeira linha do handler.
//
// A Evolution Go só aceita uma URL de webhook, sem headers personalizados —
// então o segredo viaja na query string. Não é o ideal (query string aparece em
// log de proxy), mas é o que a API oferece, e o segredo é rotacionável.
//
// TRÊS REGRAS QUE ESTA FUNÇÃO SEGUE, e o motivo de cada uma:
//
//   1. SEMPRE responde 200, mesmo quando não entende o evento. Webhook que
//      devolve 500 entra na fila de retentativa da Evolution e atrasa tudo que
//      vem depois. O que deu errado vira log, não erro HTTP.
//
//   2. IDEMPOTÊNCIA pelo `wa_message_id` (unique no banco). Reentrega é o
//      comportamento normal de qualquer webhook; sem isso a conversa duplica
//      sozinha. Aqui a duplicata é detectada pelo código 23505 do Postgres e
//      tratada como sucesso silencioso.
//
//   3. NADA de credencial no log. O corpo do evento traz `instanceToken`; ele
//      nunca é impresso.
//
// Formato do evento (conferido na doc do Evolution Go):
//   { event: "Message", instanceId, instanceToken,
//     data: { Info: { Chat, Sender, IsFromMe, IsGroup, ID, Type, PushName,
//                     Timestamp, MediaType },
//             Message: { conversation: "texto" } } }

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { jidParaNumero, ehGrupo, ehStatus, mesmoNumero } from '../_compartilhado/telefone.ts'
import { sincronizarAvatar } from '../_compartilhado/avatar.ts'

const TOKEN_ESPERADO = Deno.env.get('WEBHOOK_TOKEN') ?? ''
const INSTANCIA = Deno.env.get('EVOLUTION_INSTANCIA') ?? 'waterfall'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  // service_role: esta função escreve sem usuário logado, então ela passa por
  // cima do RLS por definição. É exatamente por isso que a tranca do token
  // acima não pode falhar.
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// O texto pode vir em vários lugares conforme o tipo da mensagem.
function textoDaMensagem(mensagem: any): string {
  if (!mensagem) return ''
  return (
    mensagem.conversation ??
    mensagem.extendedTextMessage?.text ??
    mensagem.imageMessage?.caption ??
    mensagem.videoMessage?.caption ??
    mensagem.documentMessage?.caption ??
    ''
  )
}

const TIPOS: Record<string, string> = {
  text: 'texto', image: 'imagem', audio: 'audio',
  video: 'video', document: 'documento', ptt: 'audio',
}

function tipoDaMensagem(info: any, mensagem: any): string {
  const bruto = String(info?.MediaType || info?.Type || '').toLowerCase()
  if (TIPOS[bruto]) return TIPOS[bruto]
  if (mensagem?.imageMessage) return 'imagem'
  if (mensagem?.audioMessage) return 'audio'
  if (mensagem?.videoMessage) return 'video'
  if (mensagem?.documentMessage) return 'documento'
  return textoDaMensagem(mensagem) ? 'texto' : 'outro'
}

// Acha o cliente dono deste número.
//
// A comparação é `mesmoNumero`, e não uma montagem própria de variantes: ela
// converte OS DOIS LADOS para E.164 antes de comparar. Foi exatamente isso que
// faltou na primeira versão — o cadastro guarda "(47) 99233-0354" e o WhatsApp
// entrega "554792330354" (sem o nono dígito), e comparar o número local cru
// contra o internacional nunca casa. Ver scripts/testar-telefone.mjs.
async function acharCliente(numero: string): Promise<string | null> {
  if (!numero) return null

  // O cadastro guarda o telefone com máscara, então a busca não pode ser feita
  // no banco por igualdade. São poucas centenas de clientes: trazer os
  // telefones e comparar aqui é mais simples e mais correto do que um LIKE que
  // erraria em "(47) 9123-4567".
  const { data, error } = await supabase.from('clientes').select('id, telefone')
  if (error || !data) return null

  for (const cliente of data) {
    if (!cliente.telefone) continue
    if (mesmoNumero(numero, cliente.telefone)) return cliente.id
  }
  return null
}

// Esta conversa já virou cartão no funil alguma vez?
//
// É a trava contra duplicata, e ela pergunta pelo `conversa_id` — não pelo
// telefone nem pelo nome, que mudam. Vale para cartão de qualquer etapa,
// inclusive `ganho` e `perdido`: negócio que já foi trabalhado e fechado não
// volta para "novo" porque a pessoa mandou "bom dia" seis meses depois.
async function temCartao(conversaId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('oportunidades')
    .select('id')
    .eq('conversa_id', conversaId)
    .limit(1)
    .maybeSingle()

  // Na dúvida (erro de rede, tabela fora do ar), responde "já tem" e NÃO abre
  // cartão. Entre um lead que falta e um funil poluído de duplicatas, o que
  // falta é recuperável na próxima mensagem; a duplicata é trabalho manual.
  if (error) return true
  return !!data
}

// Abre a negociação de um número que ainda não é cliente.
//
// A oportunidade nasce SEM `cliente_id` de propósito — ver o cabeçalho da
// migração 011. O nome e o telefone ficam na própria negociação, para o cartão
// ter identidade mesmo antes de existir cadastro.
async function abrirLead(
  { conversaId, numero, nome, texto }:
  { conversaId: string; numero: string; nome: string; texto: string },
) {
  // Entra no fim da coluna "novo", como qualquer cartão criado à mão.
  const { data: ultima } = await supabase
    .from('oportunidades')
    .select('ordem')
    .eq('etapa', 'novo')
    .order('ordem', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { error } = await supabase.from('oportunidades').insert({
    cliente_id: null,
    conversa_id: conversaId,
    contato_nome: nome || null,
    contato_telefone: numero,
    titulo: nome ? `${nome} (WhatsApp)` : `Contato novo ${numero}`,
    etapa: 'novo',
    canal: 'whatsapp',
    // A primeira mensagem é o melhor resumo que existe do que a pessoa quer.
    observacoes: texto ? `Primeira mensagem: "${texto}"` : null,
    ordem: Number(ultima?.ordem ?? 0) + 1000,
    criado_por: 'whatsapp',
  })

  if (error) console.error('falha ao abrir lead:', error.message)
}

Deno.serve(async (req) => {
  // 1. A tranca. Antes de qualquer coisa.
  const url = new URL(req.url)
  const enviado = url.searchParams.get('token') ?? req.headers.get('x-waterfall-token') ?? ''
  if (!TOKEN_ESPERADO || enviado !== TOKEN_ESPERADO) {
    return new Response('nao autorizado', { status: 401 })
  }

  let evento: any = null
  try {
    evento = await req.json()
  } catch {
    return new Response('ok', { status: 200 })
  }

  try {
    const nomeEvento = String(evento?.event ?? '').toLowerCase()
    if (nomeEvento !== 'message' && nomeEvento !== 'send_message') {
      // Conexão, presença, recibo de leitura: ainda não tratados. Responder 200
      // evita retentativa de algo que nunca vamos processar.
      return new Response('ok', { status: 200 })
    }

    const info = evento?.data?.Info ?? {}
    const chat = String(info.Chat ?? '')

    // Grupo e status ficam de fora: não são atendimento a cliente, e entrariam
    // na caixa de entrada empurrando o que importa para baixo.
    if (ehGrupo(chat) || ehStatus(chat)) return new Response('ok', { status: 200 })

    const numero = jidParaNumero(chat)
    if (!numero) return new Response('ok', { status: 200 })

    const daGente = info.IsFromMe === true
    const mensagemBruta = evento?.data?.Message ?? {}
    const texto = textoDaMensagem(mensagemBruta)
    const tipo = tipoDaMensagem(info, mensagemBruta)
    const waId = String(info.ID ?? '')
    const ocorridoEm = info.Timestamp ? new Date(info.Timestamp).toISOString() : new Date().toISOString()

    // 2. A conversa. `upsert` pelo número: é ele a identidade do fio.
    const { data: existente } = await supabase
      .from('conversas')
      .select('id, cliente_id, nao_lidas')
      .eq('numero', numero)
      .maybeSingle()

    let conversaId = existente?.id ?? null
    let clienteId = existente?.cliente_id ?? null

    let conversaNova = false
    if (!conversaId) {
      clienteId = await acharCliente(numero)
      const { data: criada, error: erroCriacao } = await supabase
        .from('conversas')
        .insert({
          numero,
          cliente_id: clienteId,
          nome_whatsapp: info.PushName ?? null,
          instancia: INSTANCIA,
        })
        .select('id')
        .single()

      conversaNova = !erroCriacao

      // Corrida: duas mensagens do mesmo número novo chegando juntas. A segunda
      // esbarra no unique do número — basta reler.
      if (erroCriacao) {
        const { data: relida } = await supabase
          .from('conversas').select('id').eq('numero', numero).maybeSingle()
        conversaId = relida?.id ?? null
      } else {
        conversaId = criada?.id ?? null
      }
    }
    if (!conversaId) return new Response('ok', { status: 200 })

    // Número desconhecido que escreveu é um lead: abre uma negociação na etapa
    // `novo`, para ele aparecer no CRM em vez de depender de alguém reparar na
    // caixa de entrada.
    //
    // A CONDIÇÃO MUDOU, e vale registrar por quê. Antes exigia `conversaNova` —
    // só a PRIMEIRA mensagem de um número que nunca tinha escrito abria cartão.
    // O efeito prático foi que nenhuma conversa que já existia quando esta
    // lógica subiu virou lead, e nunca ia virar: `conversaNova` jamais seria
    // verdade para elas de novo. A caixa de entrada tinha sete contatos sem
    // cadastro e o funil, nenhum.
    //
    // Agora a pergunta é outra e é a certa: "esta conversa já tem cartão?".
    // Ela não duplica (é o mesmo `conversa_id` que responde) e se cura sozinha:
    // conversa antiga ganha o cartão na próxima mensagem que chegar.
    //
    //   * `!clienteId` — quem já é cliente entra pelo funil normal, quando
    //     houver negócio, e não a cada "bom dia";
    //   * `!daGente` — conversa que VOCÊ começou não é lead: você já sabe com
    //     quem está falando e por quê.
    if (!clienteId && !daGente && !(await temCartao(conversaId))) {
      await abrirLead({ conversaId, numero, nome: info.PushName ?? '', texto })
    }

    // A foto de perfil do contato, na primeira mensagem dele.
    //
    // FORA DO CAMINHO DA RESPOSTA, de propósito. Buscar a foto é uma ida à
    // Evolution mais um download de imagem — meio segundo, às vezes mais. A
    // regra 1 desta função é responder 200 rápido; segurar o webhook por causa
    // de um enfeite de tela é o jeito de encher a fila de retentativa da
    // Evolution. `waitUntil` mantém a tarefa viva depois do 200.
    //
    // Se falhar, ninguém fica sabendo e está tudo bem: a conversa aparece com
    // as iniciais, e a varredura da função `wa-avatar` tenta de novo depois.
    if (conversaNova) {
      const tarefa = sincronizarAvatar({ id: conversaId, numero })
      // @ts-ignore — EdgeRuntime existe no Supabase, não nos tipos do Deno.
      if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(tarefa)
    }

    // 3. A mensagem. O unique do wa_message_id é o que segura a reentrega.
    const { error: erroMensagem } = await supabase.from('mensagens').insert({
      conversa_id: conversaId,
      wa_message_id: waId || null,
      direcao: daGente ? 'saida' : 'entrada',
      tipo,
      texto,
      status: daGente ? 'enviada' : 'entregue',
      ocorrido_em: ocorridoEm,
    })

    const duplicada = erroMensagem?.code === '23505'
    if (erroMensagem && !duplicada) {
      console.error('falha ao gravar mensagem:', erroMensagem.message)
      return new Response('ok', { status: 200 })
    }
    if (duplicada) return new Response('ok', { status: 200 })

    // 4. O espelho na conversa, para a lista da caixa de entrada não precisar
    // varrer as mensagens. Só mensagem recebida soma não lidas.
    const previa = (texto || `[${tipo}]`).slice(0, 120)
    const atualizacao: Record<string, unknown> = {
      ultima_em: ocorridoEm,
      ultima_previa: previa,
    }
    if (!daGente) {
      atualizacao.nao_lidas = (existente?.nao_lidas ?? 0) + 1
      if (info.PushName) atualizacao.nome_whatsapp = info.PushName
    }
    await supabase.from('conversas').update(atualizacao).eq('id', conversaId)

    return new Response('ok', { status: 200 })
  } catch (falha) {
    // Regra 1: o erro é nosso, não da Evolution. Logar e responder 200.
    console.error('erro no webhook:', (falha as Error)?.message)
    return new Response('ok', { status: 200 })
  }
})
