// O que uma mensagem do WhatsApp diz — lido do objeto `Message` cru.
//
// Mora aqui, e não no webhook, porque agora são DUAS portas de entrada com o
// mesmo formato: a mensagem ao vivo (evento Message) e a que vem no histórico do
// celular (evento HistorySync). Duas leituras separadas acabariam discordando
// sobre o que é uma foto ou um texto.
//
// O ponto mais delicado é o EMBRULHO. O WhatsApp põe a mensagem de verdade
// dentro de outra em vários casos — mensagem temporária (`ephemeralMessage`),
// visualização única, documento com legenda, a cópia que o seu outro aparelho
// recebe (`deviceSentMessage`). Ao vivo, a whatsmeow já desembrulha; no
// histórico, não. Sem desembrulhar, toda conversa com mensagens temporárias
// ligadas viraria uma fileira de balões vazios.

const EMBRULHOS = [
  'ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension',
  'documentWithCaptionMessage', 'deviceSentMessage', 'editedMessage', 'botInvokeMessage',
  'lottieStickerMessage', 'groupMentionedMessage',
]

export function desembrulhar(mensagem: any): any {
  let atual = mensagem
  for (let volta = 0; volta < 5 && atual; volta++) {
    const chave = EMBRULHOS.find((k) => atual?.[k]?.message)
    if (!chave) break
    atual = atual[chave].message
  }
  return atual ?? {}
}

// Chaves que vêm junto da mensagem mas não SÃO a mensagem: metadado de
// criptografia, de contexto. Uma mensagem que só tem isto não tem o que mostrar.
const SO_METADADO = new Set([
  'messageContextInfo', 'senderKeyDistributionMessage', 'fastRatchetKeySenderKeyDistributionMessage',
])

// Coisas que mudam OUTRA mensagem ou que o atendimento não precisa ver como
// balão: reação, voto de enquete, fixar, "manter na conversa".
const NAO_E_BALAO = new Set([
  'reactionMessage', 'encReactionMessage', 'pollUpdateMessage', 'pinInChatMessage',
  'keepInChatMessage', 'encEventResponseMessage', 'protocolMessage',
])

// Os tipos do ProtocolMessage que importam (waE2E.ProtocolMessage_Type). O Go
// serializa o enum como número; a versão por nome fica por garantia.
const REVOGAR = new Set([0, '0', 'REVOKE'])
const EDITAR = new Set([14, '14', 'MESSAGE_EDIT'])

export type Alteracao =
  | { tipo: 'apagar'; waId: string }
  | { tipo: 'editar'; waId: string; texto: string }

// "Apagar para todos" e "editar" chegam como mensagens novas que apontam para a
// original pelo id. Devolve o que fazer com a original, ou null.
export function alteracaoDe(mensagemBruta: any): Alteracao | null {
  const protocolo = desembrulhar(mensagemBruta)?.protocolMessage ?? mensagemBruta?.protocolMessage
  if (!protocolo) return null
  const waId = String(protocolo.key?.ID ?? protocolo.key?.id ?? '')
  if (!waId) return null
  if (EDITAR.has(protocolo.type)) {
    const texto = textoDaMensagem(protocolo.editedMessage)
    return texto ? { tipo: 'editar', waId, texto } : null
  }
  // Sem `?? 0` de propósito: o Go omite o campo só quando ele não existe, e um
  // ProtocolMessage sem tipo é outra coisa (chave de criptografia, aviso de
  // histórico) — tratá-lo como "apagar" sumiria com mensagens de verdade.
  if (REVOGAR.has(protocolo.type)) return { tipo: 'apagar', waId }
  return null
}

// Tem algo para mostrar como balão?
export function temConteudo(mensagemBruta: any): boolean {
  const m = desembrulhar(mensagemBruta)
  const chaves = Object.keys(m ?? {}).filter((k) => m[k] != null && !SO_METADADO.has(k))
  if (!chaves.length) return false
  return chaves.some((k) => !NAO_E_BALAO.has(k))
}

export function textoDaMensagem(mensagemBruta: any): string {
  const m = desembrulhar(mensagemBruta)
  if (!m) return ''
  const direto =
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    m.documentMessage?.caption ??
    m.buttonsResponseMessage?.selectedDisplayText ??
    m.listResponseMessage?.title ??
    m.templateButtonReplyMessage?.selectedDisplayText
  if (direto) return String(direto)

  // Os que não têm texto mas têm o que dizer. Sem isto, apareciam como "tipo de
  // mensagem que o sistema ainda não mostra" — e localização de cliente é
  // justamente o tipo de coisa que quem marca a visita precisa ver.
  if (m.locationMessage || m.liveLocationMessage) {
    const local = m.locationMessage ?? m.liveLocationMessage
    const lat = local.degreesLatitude
    const lng = local.degreesLongitude
    const nome = [local.name, local.address].filter(Boolean).join(' — ')
    const link = lat != null && lng != null ? `https://maps.google.com/?q=${lat},${lng}` : ''
    return ['📍 Localização', nome, link].filter(Boolean).join('\n')
  }
  if (m.contactMessage) return `👤 Contato: ${m.contactMessage.displayName ?? ''}`.trim()
  if (m.contactsArrayMessage) {
    const nomes = (m.contactsArrayMessage.contacts ?? []).map((c: any) => c.displayName).filter(Boolean)
    return `👤 Contatos: ${nomes.join(', ')}`
  }
  const enquete = m.pollCreationMessage ?? m.pollCreationMessageV2 ?? m.pollCreationMessageV3
  if (enquete) {
    const opcoes = (enquete.options ?? []).map((o: any) => `• ${o.optionName}`).join('\n')
    return [`📊 Enquete: ${enquete.name ?? ''}`, opcoes].filter(Boolean).join('\n')
  }
  return ''
}

const TIPOS: Record<string, string> = {
  text: 'texto', image: 'imagem', audio: 'audio',
  video: 'video', document: 'documento', ptt: 'audio',
}

// `info` é o MessageInfo da mensagem ao vivo; no histórico ele não existe.
export function tipoDaMensagem(info: any, mensagemBruta: any): string {
  const bruto = String(info?.MediaType || info?.Type || '').toLowerCase()
  if (TIPOS[bruto]) return TIPOS[bruto]
  const m = desembrulhar(mensagemBruta)
  if (m?.imageMessage) return 'imagem'
  // Figurinha é uma imagem (webp) para quem está lendo — tratá-la como "outro"
  // deixava um balão vazio no meio da conversa.
  if (m?.stickerMessage) return 'imagem'
  if (m?.audioMessage) return 'audio'
  if (m?.videoMessage || m?.ptvMessage) return 'video'
  if (m?.documentMessage) return 'documento'
  if (m?.conversation || m?.extendedTextMessage) return 'texto'
  return 'outro'
}

// O que a lista da caixa de entrada mostra quando a mensagem não tem texto. É o
// vocabulário do próprio WhatsApp, para ninguém precisar aprender outro.
export const PREVIA_DE_MIDIA: Record<string, string> = {
  imagem: '📷 Foto', audio: '🎤 Áudio', video: '🎥 Vídeo', documento: '📄 Documento',
}

export function previaDe(texto: string, tipo: string): string {
  return (texto || PREVIA_DE_MIDIA[tipo] || `[${tipo}]`).slice(0, 120)
}
