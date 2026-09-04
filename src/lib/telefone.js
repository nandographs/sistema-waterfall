// Números de telefone: do cadastro para o WhatsApp e de volta.
//
// Este arquivo existe porque o casamento entre `clientes.telefone` e o número
// que a Evolution devolve é o bug silencioso mais provável da integração — ele
// não quebra nada, só faz a conversa do cliente aparecer como "número
// desconhecido" e o histórico se partir em dois.
//
// São quatro descompassos, todos reais:
//   1. o cadastro guarda com máscara:      (47) 99123-4567
//   2. o WhatsApp entrega o JID:           5547991234567@s.whatsapp.net
//   3. celular anterior a 2016 pode estar cadastrado SEM o nono dígito, e o
//      WhatsApp responde COM ele (ou o contrário, em contatos antigos);
//   4. fixo não tem nono dígito nenhum — acrescentar um inventaria um número.
//
// Lógica pura: sem React, sem Supabase, sem rede. Testada em
// scripts/testar-telefone.mjs.

const DDI_BRASIL = '55'

// DDDs brasileiros válidos vão de 11 a 99, mas nem todos existem. A lista
// completa não vale a manutenção aqui: o que precisamos saber é se os dois
// primeiros dígitos PODEM ser um DDD, para decidir se o número já vem com ele.
const DDD_MINIMO = 11
const DDD_MAXIMO = 99

export function soDigitos(texto) {
  return String(texto ?? '').replace(/\D+/g, '')
}

// Tira o sufixo do JID do WhatsApp: '5547991234567@s.whatsapp.net' -> dígitos.
// Grupos ('...@g.us') e status ('status@broadcast') devolvem '' — quem chama
// decide o que fazer, mas nenhum dos dois é um telefone.
export function jidParaNumero(jid) {
  const texto = String(jid ?? '')
  if (!texto) return ''
  if (ehGrupo(texto) || ehStatus(texto)) return ''
  return soDigitos(texto.split('@')[0].split(':')[0])
}

export const ehGrupo = (jid) => String(jid ?? '').includes('@g.us')
export const ehStatus = (jid) => String(jid ?? '').startsWith('status@')

// Telefone do cadastro -> E.164 sem o '+': 5547991234567.
//
// Aceita com ou sem DDI, com ou sem máscara. Devolve '' quando não dá para
// afirmar que é um telefone — melhor não casar do que casar errado e mostrar a
// conversa de um cliente na ficha de outro.
export function paraE164(telefone, ddi = DDI_BRASIL) {
  let digitos = soDigitos(telefone)
  if (!digitos) return ''

  // Já veio com o DDI do Brasil? (55 + DDD + 8 ou 9 dígitos = 12 ou 13)
  if (digitos.startsWith(ddi) && (digitos.length === 12 || digitos.length === 13)) {
    return digitos
  }

  // Número internacional já formatado (outro DDI): devolve como está, sem
  // tentar adivinhar. Só descarta o zero de operadora, se houver.
  if (digitos.length > 13) return digitos

  // Zero à esquerda de DDD ("047 99123-4567") é resquício de discagem antiga.
  if (digitos.startsWith('0')) digitos = digitos.replace(/^0+/, '')

  // DDD + 8 (fixo) ou DDD + 9 (celular).
  if (digitos.length === 10 || digitos.length === 11) {
    const ddd = Number(digitos.slice(0, 2))
    if (ddd < DDD_MINIMO || ddd > DDD_MAXIMO) return ''
    return ddi + digitos
  }

  // Sem DDD não dá para montar nada: um "99123-4567" solto pode ser de
  // qualquer cidade do país.
  return ''
}

// Quebra um E.164 brasileiro em partes. null se não for um número BR.
export function partesBR(e164) {
  const digitos = soDigitos(e164)
  if (!digitos.startsWith(DDI_BRASIL)) return null
  if (digitos.length !== 12 && digitos.length !== 13) return null
  return {
    ddi: DDI_BRASIL,
    ddd: digitos.slice(2, 4),
    assinante: digitos.slice(4),
  }
}

// AS DUAS FORMAS do mesmo celular: com e sem o nono dígito.
//
// É isto que resolve o descompasso 3. Para fixo (8 dígitos que não começam com
// 6-9) devolve só a forma original — acrescentar um 9 ali criaria um número que
// não existe.
export function variantesBR(e164) {
  const partes = partesBR(e164)
  if (!partes) {
    const digitos = soDigitos(e164)
    return digitos ? [digitos] : []
  }

  const { ddi, ddd, assinante } = partes
  const variantes = new Set([ddi + ddd + assinante])

  if (assinante.length === 9 && assinante.startsWith('9')) {
    // Celular com nono dígito -> a forma antiga, sem ele.
    variantes.add(ddi + ddd + assinante.slice(1))
  } else if (assinante.length === 8 && /^[6-9]/.test(assinante)) {
    // Celular antigo (começa em 6-9) -> a forma atual, com o 9 na frente.
    variantes.add(ddi + ddd + '9' + assinante)
  }

  return [...variantes]
}

// Os dois telefones são a mesma pessoa? Compara pelas variantes, então
// "(47) 9123-4567" do cadastro casa com "5547991234567" do WhatsApp.
export function mesmoNumero(a, b) {
  const umE164 = paraE164(a)
  const outroE164 = paraE164(b)
  if (!umE164 || !outroE164) return false
  if (umE164 === outroE164) return true

  const doPrimeiro = new Set(variantesBR(umE164))
  return variantesBR(outroE164).some((v) => doPrimeiro.has(v))
}

// E.164 -> máscara de leitura: 5547991234567 -> (47) 99123-4567.
// Número de outro país volta como veio, com '+' na frente.
export function formatarE164(e164) {
  const partes = partesBR(e164)
  if (!partes) {
    const digitos = soDigitos(e164)
    return digitos ? `+${digitos}` : ''
  }
  const { ddd, assinante } = partes
  const meio = assinante.length === 9 ? assinante.slice(0, 5) : assinante.slice(0, 4)
  const fim = assinante.length === 9 ? assinante.slice(5) : assinante.slice(4)
  return `(${ddd}) ${meio}-${fim}`
}

// O JID que a Evolution espera no envio.
export function numeroParaJid(telefone) {
  const e164 = paraE164(telefone)
  return e164 ? `${e164}@s.whatsapp.net` : ''
}

// ---- A lista de telefones do cliente (migração 016) ----
//
// Um cliente tem o celular dele, o fixo de casa e o da esposa. A coluna
// `telefones` guarda a lista; `telefone` continua existindo e vale o PRIMEIRO
// da lista, porque é ela que o WhatsApp, a Ordem de Serviço e o Pedido leem.

// Descarta linha sem número e normaliza os campos. Tudo daqui para baixo assume
// que passou por aqui.
export function normalizarTelefones(telefones) {
  return (Array.isArray(telefones) ? telefones : [])
    .map((t) => ({
      numero: String(t?.numero ?? '').trim(),
      rotulo: String(t?.rotulo ?? '').trim(),
    }))
    .filter((t) => t.numero)
}

// Os telefones de um cliente, venha ele da lista nova ou da coluna antiga.
//
// É o único lugar que responde "quais são os números desta pessoa?", e existe
// para as telas não precisarem saber se aquele cadastro é anterior à migração.
export function telefonesDoCliente(cliente) {
  const lista = normalizarTelefones(cliente?.telefones)
  if (lista.length) return lista
  const unico = String(cliente?.telefone ?? '').trim()
  return unico ? [{ numero: unico, rotulo: '' }] : []
}

// O número que representa o cliente: o primeiro da lista.
export function telefonePrincipal(cliente) {
  return telefonesDoCliente(cliente)[0]?.numero || ''
}

// Prepara o cadastro para gravar: a lista limpa e a coluna `telefone` alinhada
// com o primeiro item.
//
// A coluna é DERIVADA, nunca digitada à parte — é isso que impede o principal da
// ficha de discordar do número que o WhatsApp usa para casar a conversa.
export function comTelefonePrincipal(cliente) {
  const telefones = normalizarTelefones(cliente?.telefones)
  if (!telefones.length) return { ...cliente, telefones }
  return { ...cliente, telefones, telefone: telefones[0].numero }
}

// Algum telefone do cliente é este número? Compara pelas variantes com e sem o
// nono dígito (ver mesmoNumero), então funciona com o que o WhatsApp devolve.
export function clienteTemNumero(cliente, numero) {
  return telefonesDoCliente(cliente).some((t) => mesmoNumero(t.numero, numero))
}
