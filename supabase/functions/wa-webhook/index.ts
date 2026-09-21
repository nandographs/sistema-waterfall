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
import { jidParaNumero, ehGrupo, ehStatus, ehLid, soDigitos, clienteTemNumero } from '../_compartilhado/telefone.ts'
import { sincronizarAvatar } from '../_compartilhado/avatar.ts'
import { guardarMidiaDaMensagem, temMidia } from '../_compartilhado/midia.ts'

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
  // Figurinha é uma imagem (webp) para quem está lendo — tratá-la como "outro"
  // deixava um balão vazio no meio da conversa.
  if (mensagem?.stickerMessage) return 'imagem'
  if (mensagem?.audioMessage) return 'audio'
  if (mensagem?.videoMessage) return 'video'
  if (mensagem?.documentMessage || mensagem?.documentWithCaptionMessage) return 'documento'
  return textoDaMensagem(mensagem) ? 'texto' : 'outro'
}

// O que a lista da caixa de entrada mostra quando a mensagem não tem texto. É o
// vocabulário do próprio WhatsApp, para ninguém precisar aprender outro.
const PREVIA_DE_MIDIA: Record<string, string> = {
  imagem: '📷 Foto', audio: '🎤 Áudio', video: '🎥 Vídeo', documento: '📄 Documento',
}

// O TELEFONE de quem está do outro lado — que nem sempre é o que está em `Chat`.
//
// O WhatsApp passou a endereçar algumas conversas por LID ("...@lid"), um
// identificador interno, e manda o telefone de verdade num campo à parte. Ler os
// dígitos do LID como se fossem telefone foi o que criou a conversa fantasma
// "74384874193115" — e o que fazia a mensagem que VOCÊ manda pelo celular cair
// numa conversa diferente da do contato.
//
// Qual campo alternativo olhar depende de quem falou:
//   * mensagem que CHEGA: o outro lado é o remetente -> `SenderAlt`;
//   * mensagem que você mandou (inclusive do celular, fora do sistema): o outro
//     lado é o destinatário -> `RecipientAlt`.
// Tentamos o esperado primeiro e o outro depois, porque recibos de leitura
// preenchem esses campos de forma menos previsível.
//
// Devolve também o LID, quando houver, para o chamador poder reencontrar uma
// conversa que foi gravada errada antes desta correção.
function contatoDoEvento(fonte: any, daGente: boolean): { numero: string; lid: string } {
  const chat = String(fonte?.Chat ?? '')
  const lid = ehLid(chat) ? soDigitos(chat.split('@')[0]) : ''
  if (!lid) return { numero: jidParaNumero(chat), lid: '' }

  const alternativas = daGente
    ? [fonte?.RecipientAlt, fonte?.SenderAlt]
    : [fonte?.SenderAlt, fonte?.RecipientAlt]
  for (const alt of alternativas) {
    const numero = jidParaNumero(alt)
    if (numero) return { numero, lid }
  }
  return { numero: '', lid }
}

// Conversa gravada com o LID no lugar do telefone, antes desta correção.
//
// Quando chega a primeira mensagem que traz o telefone de verdade, a conversa
// antiga é RENOMEADA para ele — o histórico fica, e a pessoa passa a ser uma só.
// Só renomeia se ainda não existir conversa com o telefone real: se existir,
// juntar as duas exigiria mover mensagens, cartões e anotações, e isso não é
// coisa para um webhook fazer às cegas. Nesse caso fica registrado no log.
async function corrigirConversaDoLid(lid: string, numero: string) {
  if (!lid || !numero || lid === numero) return
  const { data: fantasma } = await supabase
    .from('conversas').select('id').eq('numero', lid).maybeSingle()
  if (!fantasma) return

  const { data: verdadeira } = await supabase
    .from('conversas').select('id').eq('numero', numero).maybeSingle()
  if (verdadeira) {
    console.warn(`conversa do LID ${lid} e do número ${numero} coexistem; não juntei automaticamente`)
    return
  }
  await supabase.from('conversas').update({ numero }).eq('id', fantasma.id)
  // O cartão do lead carregava o LID como telefone de contato.
  await supabase.from('oportunidades').update({ contato_telefone: numero })
    .eq('conversa_id', fantasma.id).eq('contato_telefone', lid)
}

// Recibo de entrega/leitura.
//
// É o que faz o sistema ACOMPANHAR o celular. Dois casos, e eles são diferentes:
//
//   * "read-self": VOCÊ leu a conversa em outro aparelho — o celular, o
//     WhatsApp Web. O contador de não lidas do sistema zera, porque você já viu.
//     Sem isto, ler no celular deixava a caixa de entrada gritando mensagens que
//     ninguém precisa mais ler.
//
//   * o CONTATO recebeu/leu o que você mandou: o ✓ vira ✓✓ e depois azul.
//
// O formato vem do whatsmeow (events.Receipt): os campos de origem da mensagem
// no mesmo nível de `MessageIDs` e `Type`.
async function tratarRecibo(dados: any) {
  const recibo = dados?.Receipt ?? dados ?? {}
  const tipo = String(recibo.Type ?? '').toLowerCase()
  const ids: string[] = (Array.isArray(recibo.MessageIDs) ? recibo.MessageIDs : []).map(String)
  const daGente = recibo.IsFromMe === true

  if (ehGrupo(recibo.Chat) || ehStatus(recibo.Chat)) return

  if (tipo === 'read-self' || tipo === 'played-self') {
    const { numero } = contatoDoEvento(recibo, true)
    if (!numero) return
    await supabase.from('conversas').update({ nao_lidas: 0 }).eq('numero', numero)
    return
  }

  if (!ids.length || daGente) return

  if (tipo === 'read' || tipo === 'played') {
    // Falha não vira lida: se o envio falhou, o recibo é de outra coisa.
    await supabase.from('mensagens').update({ status: 'lida' })
      .in('wa_message_id', ids).neq('status', 'falhou')
  } else if (tipo === '' || tipo === 'delivered') {
    // Só sobe de "enviada" para "entregue" — nunca rebaixa uma que já foi lida
    // (os recibos podem chegar fora de ordem).
    await supabase.from('mensagens').update({ status: 'entregue' })
      .in('wa_message_id', ids).in('status', ['pendente', 'enviada'])
  }
}

// Acha o cliente dono deste número.
//
// A comparação sai de `clienteTemNumero`, que por baixo usa `mesmoNumero` — e
// não uma montagem própria de variantes. `mesmoNumero` converte OS DOIS LADOS
// para E.164 antes de comparar. Foi exatamente isso que faltou na primeira
// versão: o cadastro guarda "(47) 99233-0354" e o WhatsApp entrega
// "554792330354" (sem o nono dígito), e comparar o número local cru contra o
// internacional nunca casa. Ver scripts/testar-telefone.mjs.
async function acharCliente(numero: string): Promise<string | null> {
  if (!numero) return null

  // O cadastro guarda o telefone com máscara, então a busca não pode ser feita
  // no banco por igualdade. São poucas centenas de clientes: trazer os
  // telefones e comparar aqui é mais simples e mais correto do que um LIKE que
  // erraria em "(47) 9123-4567".
  //
  // Traz `telefones` (a lista da migração 016) junto com a coluna antiga: o
  // cliente pode ter o celular dele, o fixo de casa e o da esposa, e a mensagem
  // pode chegar de qualquer um deles. `clienteTemNumero` olha todos e cai na
  // coluna `telefone` quando o cadastro é anterior à migração.
  //
  // PAGINADO, e isto já foi bug: o Supabase devolve no máximo 1000 linhas por
  // consulta, sem avisar. Depois da importação dos clientes históricos, quem
  // estava além do milésimo nunca era reconhecido — escrevia e virava lead, com
  // a ficha dele existindo. É o mesmo defeito que o aplicativo teve na lista de
  // clientes ("Ver todos os clientes, não só os mil primeiros").
  const PAGINA = 1000
  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await supabase
      .from('clientes')
      .select('id, telefone, telefones')
      .order('id')
      .range(inicio, inicio + PAGINA - 1)
    if (error || !data) return null

    for (const cliente of data) {
      if (clienteTemNumero(cliente, numero)) return cliente.id
    }
    if (data.length < PAGINA) return null
  }
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

    // TEMPORÁRIO — o formato real dos eventos, para conferir o que esta versão
    // supõe (nomes dos campos de LID, do recibo, da mídia). Só a ESTRUTURA: nem
    // texto de mensagem nem o `instanceToken` passam por aqui. Sai no próximo
    // commit, depois de conferido nos logs da função.
    console.log('evento', JSON.stringify({
      evento: evento?.event,
      chaves: Object.keys(evento?.data ?? {}),
      info: evento?.data?.Info ? {
        Chat: evento.data.Info.Chat, SenderAlt: evento.data.Info.SenderAlt,
        RecipientAlt: evento.data.Info.RecipientAlt, AddressingMode: evento.data.Info.AddressingMode,
        IsFromMe: evento.data.Info.IsFromMe, Type: evento.data.Info.Type, MediaType: evento.data.Info.MediaType,
      } : undefined,
      mensagem: evento?.data?.Message ? Object.keys(evento.data.Message) : undefined,
      recibo: evento?.data?.Type !== undefined || evento?.data?.MessageIDs ? {
        Type: evento.data.Type, Chat: evento.data.Chat, IsFromMe: evento.data.IsFromMe,
        SenderAlt: evento.data.SenderAlt, RecipientAlt: evento.data.RecipientAlt,
        ids: evento.data.MessageIDs?.length,
      } : undefined,
    }))

    // Recibo de entrega/leitura: é o que mantém o sistema em dia com o celular.
    // O nome do evento varia entre versões; os três já apareceram.
    if (nomeEvento === 'receipt' || nomeEvento === 'read_receipt' || nomeEvento === 'readreceipt') {
      await tratarRecibo(evento?.data)
      return new Response('ok', { status: 200 })
    }

    if (nomeEvento !== 'message' && nomeEvento !== 'send_message') {
      // Conexão, presença, histórico: ainda não tratados. Responder 200 evita
      // retentativa de algo que nunca vamos processar.
      return new Response('ok', { status: 200 })
    }

    const info = evento?.data?.Info ?? {}
    const chat = String(info.Chat ?? '')

    // Grupo e status ficam de fora: não são atendimento a cliente, e entrariam
    // na caixa de entrada empurrando o que importa para baixo.
    if (ehGrupo(chat) || ehStatus(chat)) return new Response('ok', { status: 200 })

    const daGente = info.IsFromMe === true

    // O telefone de verdade, mesmo quando o WhatsApp endereçou por LID. Ver
    // `contatoDoEvento`.
    const resolvido = contatoDoEvento(info, daGente)
    const { lid } = resolvido
    let numero = resolvido.numero
    if (!numero && lid) {
      // LID sem o telefone junto. NÃO descarta: este webhook responde 200 sempre,
      // então a Evolution nunca reenviaria — a mensagem estaria perdida para
      // sempre. Grava sob o LID, como antes desta correção; na primeira mensagem
      // dessa pessoa que trouxer o telefone, `corrigirConversaDoLid` renomeia a
      // conversa e o histórico fica inteiro.
      console.warn(`mensagem de LID ${lid} sem telefone alternativo; gravada sob o LID`)
      numero = lid
    }
    if (!numero) return new Response('ok', { status: 200 })
    if (lid && numero !== lid) await corrigirConversaDoLid(lid, numero)
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
          // Só quando a mensagem é DELES. Se foi você que escreveu primeiro —
          // pelo celular, fora do sistema — o `PushName` do evento é o SEU nome,
          // e o contato ficaria batizado como "Waterfall Company Brazil".
          nome_whatsapp: daGente ? null : (info.PushName ?? null),
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
    const { data: gravada, error: erroMensagem } = await supabase.from('mensagens').insert({
      conversa_id: conversaId,
      wa_message_id: waId || null,
      direcao: daGente ? 'saida' : 'entrada',
      tipo,
      texto,
      status: daGente ? 'enviada' : 'entregue',
      ocorrido_em: ocorridoEm,
    }).select('id').single()

    const duplicada = erroMensagem?.code === '23505'
    if (erroMensagem && !duplicada) {
      console.error('falha ao gravar mensagem:', erroMensagem.message)
      return new Response('ok', { status: 200 })
    }
    if (duplicada) return new Response('ok', { status: 200 })

    // 3b. A mídia, FORA do caminho da resposta — como a foto de perfil.
    //
    // Baixar e decifrar um áudio leva segundos; segurar o 200 por isso encheria
    // a fila de retentativa da Evolution. A mensagem já está gravada e aparece
    // na tela com "carregando mídia"; quando o arquivo chega, o UPDATE dispara o
    // Realtime e a tela troca o marcador pela foto ou pelo player.
    //
    // Vale também para a mídia que VOCÊ mandou pelo celular: ela chega aqui como
    // mensagem de saída, e aparece no sistema igual.
    if (gravada?.id && temMidia(mensagemBruta)) {
      const tarefa = guardarMidiaDaMensagem({
        mensagemId: gravada.id, conversaId, waId, mensagemBruta,
      })
      // @ts-ignore — EdgeRuntime existe no Supabase, não nos tipos do Deno.
      if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(tarefa)
      else await tarefa
    }

    // 4. O espelho na conversa, para a lista da caixa de entrada não precisar
    // varrer as mensagens. Só mensagem recebida soma não lidas.
    const previa = (texto || PREVIA_DE_MIDIA[tipo] || `[${tipo}]`).slice(0, 120)
    const atualizacao: Record<string, unknown> = {
      ultima_em: ocorridoEm,
      ultima_previa: previa,
    }
    if (!daGente) {
      atualizacao.nao_lidas = (existente?.nao_lidas ?? 0) + 1
      if (info.PushName) atualizacao.nome_whatsapp = info.PushName
    } else {
      // Quem respondeu, leu. Se você escreveu pelo celular, as mensagens que
      // estavam esperando já foram vistas — zerar aqui não depende do recibo de
      // leitura chegar (e ele só chega se o evento estiver assinado no painel).
      atualizacao.nao_lidas = 0
    }
    await supabase.from('conversas').update(atualizacao).eq('id', conversaId)

    return new Response('ok', { status: 200 })
  } catch (falha) {
    // Regra 1: o erro é nosso, não da Evolution. Logar e responder 200.
    console.error('erro no webhook:', (falha as Error)?.message)
    return new Response('ok', { status: 200 })
  }
})
