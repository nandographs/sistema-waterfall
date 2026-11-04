// O histórico que o celular manda quando o número é pareado (evento HistorySync).
//
// É o que faz o sistema começar como o WhatsApp Web começa: com as conversas que
// já existiam, e não com uma caixa de entrada vazia esperando alguém escrever.
// O celular manda em lotes — primeiro as conversas recentes, depois o resto —
// e cada lote é um evento separado. Esta função trata UM lote.
//
// TRÊS DECISÕES, e o porquê de cada uma:
//
//   1. NÃO abre lead no CRM. O histórico é passado: transformar cada conversa
//      antiga num cartão "em contato" enterraria o funil de uma vez. Quem
//      escrever de novo entra pelo caminho normal do webhook.
//
//   2. EM LOTE, não mensagem a mensagem. Um lote traz centenas de conversas; ir
//      ao banco uma vez por mensagem estouraria o tempo da função. As conversas
//      que faltam nascem num insert só, e as mensagens em blocos.
//
//   3. Idempotente pelo `wa_message_id`, como o webhook. A Evolution reentrega
//      quando a função não responde 2xx — por isso aqui um erro vira exceção (o
//      webhook devolve 500 e o lote volta), e reentrega de algo já gravado não
//      duplica nada.
//
// Formato (waHistorySync.HistorySync serializado pelo Go):
//   { Data: { syncType, conversations: [{ ID, pnJID, lidJID, name, unreadCount,
//             messages: [{ message: { key: { remoteJID, fromMe, ID },
//                                     message, messageTimestamp, pushName,
//                                     status } }] }],
//             pushnames: [{ ID, pushname }] } }
// Lido com tolerância a maiúsculas: o nome dos campos já variou entre versões.

import { ehGrupo, ehStatus, ehLid, jidParaNumero, soDigitos, clienteTemNumero } from './telefone.ts'
import { desembrulhar, temConteudo, textoDaMensagem, tipoDaMensagem, previaDe } from './conteudo.ts'
import { guardarMidiaDaMensagem, temMidia } from './midia.ts'
import { INSTANCIA } from './conexao.ts'

const campo = (obj: any, ...nomes: string[]) => {
  for (const nome of nomes) if (obj?.[nome] != null) return obj[nome]
  return undefined
}

// WebMessageInfo.status: 3 = entregue, 4 = lida, 5 = ouvida.
function statusDeSaida(bruto: unknown): string {
  const n = Number(bruto)
  if (n >= 4) return 'lida'
  if (n === 3) return 'entregue'
  return 'enviada'
}

// Mídia do histórico é baixada só se for recente, e poucas por lote. Baixar um
// áudio leva segundos e a Evolution fala com um aparelho só; trazer a foto de
// dois anos atrás de cada conversa afogaria a instância no primeiro dia. O que
// fica de fora aparece como "indisponível — veja no celular".
const MIDIA_RECENTE_MS = 3 * 24 * 60 * 60 * 1000
const MIDIAS_POR_LOTE = 15

async function carregarClientes(supabase: any) {
  // Paginado: o Supabase corta em 1000 linhas sem avisar (ver acharCliente no
  // webhook, onde isso já foi bug).
  const todos: any[] = []
  for (let inicio = 0; ; inicio += 1000) {
    const { data, error } = await supabase
      .from('clientes').select('id, telefone, telefones').order('id').range(inicio, inicio + 999)
    if (error) throw new Error(`clientes: ${error.message}`)
    todos.push(...data)
    if (data.length < 1000) return todos
  }
}

type Linha = {
  wa_message_id: string; direcao: string; tipo: string; texto: string
  status: string; ocorrido_em: string; bruta: any
}

export async function importarHistorico(supabase: any, dados: any): Promise<{ conversas: number; mensagens: number }> {
  const hs = campo(dados, 'Data', 'data') ?? dados ?? {}
  const conversasHs: any[] = campo(hs, 'conversations', 'Conversations') ?? []
  if (!conversasHs.length) return { conversas: 0, mensagens: 0 }

  // Nome de perfil dos contatos, que vem numa lista à parte.
  const nomes = new Map<string, string>()
  for (const p of campo(hs, 'pushnames', 'Pushnames') ?? []) {
    const numero = jidParaNumero(campo(p, 'ID', 'id'))
    const nome = campo(p, 'pushname', 'Pushname')
    if (numero && nome) nomes.set(numero, String(nome))
  }

  // 1. Cada conversa do lote vira { numero, linhas }.
  const porNumero = new Map<string, { nome: string; naoLidas: number | null; linhas: Linha[] }>()
  for (const conv of conversasHs) {
    const jid = String(campo(conv, 'ID', 'id') ?? '')
    if (!jid || ehGrupo(jid) || ehStatus(jid) || jid.includes('@newsletter') || jid.includes('@broadcast')) continue

    // Conversa endereçada por LID traz o telefone em `pnJID`. Sem ele, fica
    // sob o LID, como no webhook — melhor um fio com o número estranho do que
    // a conversa perdida.
    const numero = ehLid(jid)
      ? (jidParaNumero(campo(conv, 'pnJID', 'pnJid', 'PnJID')) || soDigitos(jid.split('@')[0]))
      : jidParaNumero(jid)
    if (!numero) continue

    const linhas: Linha[] = []
    for (const item of campo(conv, 'messages', 'Messages') ?? []) {
      const info = campo(item, 'message', 'Message') ?? {}
      const chave = campo(info, 'key', 'Key') ?? {}
      const waId = String(campo(chave, 'ID', 'id') ?? '')
      const bruta = campo(info, 'message', 'Message')
      if (!waId || !bruta || !temConteudo(bruta)) continue

      const daGente = campo(chave, 'fromMe', 'FromMe') === true
      const segundos = Number(campo(info, 'messageTimestamp', 'MessageTimestamp') ?? 0)
      const tipo = tipoDaMensagem(null, bruta)
      linhas.push({
        wa_message_id: waId,
        direcao: daGente ? 'saida' : 'entrada',
        tipo,
        texto: textoDaMensagem(bruta),
        status: daGente ? statusDeSaida(campo(info, 'status', 'Status')) : 'entregue',
        ocorrido_em: new Date(segundos ? segundos * 1000 : Date.now()).toISOString(),
        bruta: desembrulhar(bruta),
      })
      if (!daGente && !nomes.has(numero)) {
        const nome = campo(info, 'pushName', 'PushName')
        if (nome) nomes.set(numero, String(nome))
      }
    }
    if (!linhas.length) continue

    const atual = porNumero.get(numero)
    const naoLidas = Number(campo(conv, 'unreadCount', 'UnreadCount'))
    porNumero.set(numero, {
      nome: nomes.get(numero) ?? String(campo(conv, 'name', 'displayName', 'Name') ?? ''),
      naoLidas: Number.isFinite(naoLidas) ? naoLidas : null,
      linhas: [...(atual?.linhas ?? []), ...linhas],
    })
  }
  if (!porNumero.size) return { conversas: 0, mensagens: 0 }

  // 2. As conversas que já existem, numa consulta por bloco de números.
  const numeros = [...porNumero.keys()]
  const existentes = new Map<string, any>()
  for (let i = 0; i < numeros.length; i += 200) {
    const { data, error } = await supabase
      .from('conversas').select('id, numero, ultima_em, nome_whatsapp')
      .in('numero', numeros.slice(i, i + 200))
    if (error) throw new Error(`conversas: ${error.message}`)
    for (const c of data) existentes.set(c.numero, c)
  }

  // 3. As que faltam nascem de uma vez, já casadas com o cadastro. Os clientes
  // só são carregados se houver conversa nova — reentrega de um lote já
  // importado não paga essa consulta.
  const novas = numeros.filter((n) => !existentes.has(n))
  if (novas.length) {
    const clientes = await carregarClientes(supabase)
    const registros = novas.map((numero) => {
      const { nome, naoLidas, linhas } = porNumero.get(numero)!
      const ultima = linhas.reduce((a, b) => (a.ocorrido_em > b.ocorrido_em ? a : b))
      return {
        numero,
        cliente_id: clientes.find((c) => clienteTemNumero(c, numero))?.id ?? null,
        nome_whatsapp: nome || null,
        instancia: INSTANCIA,
        ultima_em: ultima.ocorrido_em,
        ultima_previa: previaDe(ultima.texto, ultima.tipo),
        nao_lidas: naoLidas ?? 0,
      }
    })
    const { error } = await supabase
      .from('conversas').upsert(registros, { onConflict: 'numero', ignoreDuplicates: true })
    if (error) throw new Error(`criar conversas: ${error.message}`)

    for (let i = 0; i < novas.length; i += 200) {
      const { data } = await supabase
        .from('conversas').select('id, numero, ultima_em, nome_whatsapp')
        .in('numero', novas.slice(i, i + 200))
      for (const c of data ?? []) existentes.set(c.numero, { ...c, recemCriada: true })
    }
  }

  // 4. As mensagens, em blocos. `ignoreDuplicates` faz a reentrega passar reto,
  // e o retorno traz só as que entraram agora — é com elas que a mídia é
  // baixada.
  const todas: (Linha & { conversa_id: string })[] = []
  for (const [numero, { linhas }] of porNumero) {
    const conversa = existentes.get(numero)
    if (conversa) for (const l of linhas) todas.push({ ...l, conversa_id: conversa.id })
  }
  const brutas = new Map(todas.map((l) => [l.wa_message_id, l]))
  const inseridas: { id: string; wa_message_id: string; conversa_id: string }[] = []
  for (let i = 0; i < todas.length; i += 500) {
    const bloco = todas.slice(i, i + 500).map(({ bruta: _bruta, ...linha }) => linha)
    const { data, error } = await supabase
      .from('mensagens')
      .upsert(bloco, { onConflict: 'wa_message_id', ignoreDuplicates: true })
      .select('id, wa_message_id, conversa_id')
    if (error) throw new Error(`mensagens: ${error.message}`)
    inseridas.push(...(data ?? []))
  }

  // 5. O espelho da última mensagem, nas conversas que já existiam — só quando
  // o histórico é MAIS NOVO do que o que o sistema já sabia. Lote antigo que
  // chega depois não pode fazer a lista mostrar uma mensagem de 2024 como a
  // última.
  const atualizacoes = []
  for (const [numero, { nome, naoLidas, linhas }] of porNumero) {
    const conversa = existentes.get(numero)
    if (!conversa || conversa.recemCriada) continue
    const ultima = linhas.reduce((a, b) => (a.ocorrido_em > b.ocorrido_em ? a : b))
    const campos: Record<string, unknown> = {}
    if (!conversa.ultima_em || ultima.ocorrido_em > conversa.ultima_em) {
      campos.ultima_em = ultima.ocorrido_em
      campos.ultima_previa = previaDe(ultima.texto, ultima.tipo)
      if (naoLidas != null) campos.nao_lidas = naoLidas
    }
    if (!conversa.nome_whatsapp && nome) campos.nome_whatsapp = nome
    if (Object.keys(campos).length) atualizacoes.push({ id: conversa.id, campos })
  }
  for (let i = 0; i < atualizacoes.length; i += 10) {
    await Promise.all(atualizacoes.slice(i, i + 10).map(({ id, campos }) =>
      supabase.from('conversas').update(campos).eq('id', id)))
  }

  // 6. A mídia recente, em segundo plano e uma de cada vez.
  const agora = Date.now()
  const comMidia = inseridas
    .map((m) => ({ ...m, linha: brutas.get(m.wa_message_id)! }))
    .filter((m) => m.linha && temMidia(m.linha.bruta) && agora - new Date(m.linha.ocorrido_em).getTime() < MIDIA_RECENTE_MS)
    .slice(0, MIDIAS_POR_LOTE)
  if (comMidia.length) {
    const tarefa = (async () => {
      for (const m of comMidia) {
        await guardarMidiaDaMensagem({
          mensagemId: m.id, conversaId: m.conversa_id, waId: m.wa_message_id, mensagemBruta: m.linha.bruta,
        })
      }
    })()
    // @ts-ignore — EdgeRuntime existe no Supabase, não nos tipos do Deno.
    if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(tarefa)
    else await tarefa
  }

  return { conversas: porNumero.size, mensagens: inseridas.length }
}
