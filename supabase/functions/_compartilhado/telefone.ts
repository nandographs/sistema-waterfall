// Números de telefone, do lado do servidor.
//
// CÓPIA de src/lib/telefone.js, de propósito. O bundler das Edge Functions só
// empacota o que está dentro de supabase/functions/, então importar o arquivo
// do aplicativo daqui não funcionaria no deploy. A lógica é a mesma e os testes
// vivem em scripts/testar-telefone.mjs — ao mexer em um, mexa no outro.
//
// O caso que justifica o arquivo inteiro é o nono dígito: o cadastro pode ter
// "(47) 9123-4567" e o WhatsApp responder "5547991234567". Sem casar as duas
// formas, a conversa do cliente aparece como número desconhecido.

const DDI_BRASIL = '55'
const DDD_MINIMO = 11
const DDD_MAXIMO = 99

export const soDigitos = (texto: unknown): string =>
  String(texto ?? '').replace(/\D+/g, '')

export const ehGrupo = (jid: unknown): boolean => String(jid ?? '').includes('@g.us')
export const ehStatus = (jid: unknown): boolean => String(jid ?? '').startsWith('status@')

// '5547991234567:63@s.whatsapp.net' -> '5547991234567'
// O sufixo ':63' é o número do aparelho pareado; não faz parte do telefone.
export function jidParaNumero(jid: unknown): string {
  const texto = String(jid ?? '')
  if (!texto || ehGrupo(texto) || ehStatus(texto)) return ''
  return soDigitos(texto.split('@')[0].split(':')[0])
}

export function paraE164(telefone: unknown, ddi = DDI_BRASIL): string {
  let digitos = soDigitos(telefone)
  if (!digitos) return ''

  if (digitos.startsWith(ddi) && (digitos.length === 12 || digitos.length === 13)) {
    return digitos
  }
  if (digitos.length > 13) return digitos
  if (digitos.startsWith('0')) digitos = digitos.replace(/^0+/, '')

  if (digitos.length === 10 || digitos.length === 11) {
    const ddd = Number(digitos.slice(0, 2))
    if (ddd < DDD_MINIMO || ddd > DDD_MAXIMO) return ''
    return ddi + digitos
  }
  return ''
}

function partesBR(e164: string) {
  const digitos = soDigitos(e164)
  if (!digitos.startsWith(DDI_BRASIL)) return null
  if (digitos.length !== 12 && digitos.length !== 13) return null
  return { ddi: DDI_BRASIL, ddd: digitos.slice(2, 4), assinante: digitos.slice(4) }
}

// As duas formas do mesmo celular: com e sem o nono dígito. Fixo fica de fora —
// pôr um 9 na frente de um fixo inventa um número que não existe.
export function variantesBR(e164: string): string[] {
  const partes = partesBR(e164)
  if (!partes) {
    const digitos = soDigitos(e164)
    return digitos ? [digitos] : []
  }
  const { ddi, ddd, assinante } = partes
  const variantes = new Set([ddi + ddd + assinante])

  if (assinante.length === 9 && assinante.startsWith('9')) {
    variantes.add(ddi + ddd + assinante.slice(1))
  } else if (assinante.length === 8 && /^[6-9]/.test(assinante)) {
    variantes.add(ddi + ddd + '9' + assinante)
  }
  return [...variantes]
}

// O JID que a Evolution espera. Gêmeo do `numeroParaJid` de src/lib/telefone.js.
//
// NÃO É COSMÉTICO. Medido contra a instância: `POST /user/avatar` com o número
// cru ("5547991868646") não responde NUNCA — a requisição fica pendurada até
// estourar o tempo, sem erro. Com o JID, a mesma chamada volta em 0,3 s. A
// resolução interna do número é o que trava. Ver o cabeçalho de avatar.ts.
export function numeroParaJid(telefone: unknown): string {
  const e164 = paraE164(telefone)
  return e164 ? `${e164}@s.whatsapp.net` : ''
}

export function mesmoNumero(a: unknown, b: unknown): boolean {
  const um = paraE164(a)
  const outro = paraE164(b)
  if (!um || !outro) return false
  if (um === outro) return true
  const doPrimeiro = new Set(variantesBR(um))
  return variantesBR(outro).some((v) => doPrimeiro.has(v))
}

// ---- A lista de telefones do cliente (migração 016) ----
//
// Gêmeos de src/lib/telefone.js. O cliente pode ter o celular dele, o fixo de
// casa e o da esposa; o webhook precisa reconhecer a pessoa venha a mensagem de
// qual deles for. Sem isso, quem escreve do segundo número entra como lead —
// um contato novo, com cartão novo, ao lado da ficha que já existia.

export type TelefoneDoCliente = { numero?: unknown; rotulo?: unknown }

export function normalizarTelefones(telefones: unknown): { numero: string; rotulo: string }[] {
  return (Array.isArray(telefones) ? telefones : [])
    .map((t: TelefoneDoCliente) => ({
      numero: String(t?.numero ?? '').trim(),
      rotulo: String(t?.rotulo ?? '').trim(),
    }))
    .filter((t) => t.numero)
}

// Os telefones de um cliente, venha ele da lista nova ou da coluna antiga.
export function telefonesDoCliente(
  cliente: { telefones?: unknown; telefone?: unknown } | null | undefined,
): { numero: string; rotulo: string }[] {
  const lista = normalizarTelefones(cliente?.telefones)
  if (lista.length) return lista
  const unico = String(cliente?.telefone ?? '').trim()
  return unico ? [{ numero: unico, rotulo: '' }] : []
}

// Algum telefone do cliente é este número? Compara com `mesmoNumero`, que
// converte os dois lados para E.164 antes — é o que faz o cadastro com máscara
// casar com o que a Evolution entrega, com ou sem o nono dígito.
export function clienteTemNumero(
  cliente: { telefones?: unknown; telefone?: unknown } | null | undefined,
  numero: unknown,
): boolean {
  return telefonesDoCliente(cliente).some((t) => mesmoNumero(t.numero, numero))
}
