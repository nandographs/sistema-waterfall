// Aritmética de datas do sistema — sempre em horário LOCAL.
//
// A REGRA DESTA CASA: nunca escreva `new Date('2026-08-01')`.
// Esse formato é interpretado como UTC pelo JavaScript e, no horário de
// Brasília (UTC-3), volta como 31/07 às 21h. Num calendário isso não é um
// detalhe: o mês inteiro anda um dia para trás e a grade desalinha do dia da
// semana correto.
//
// Aqui datas são TEXTO no formato 'AAAA-MM-DD' (o mesmo que o Postgres usa em
// colunas `date`) e só viram objeto Date através de `new Date(ano, mes-1, dia)`,
// que o JavaScript interpreta no fuso local — o comportamento que queremos.
//
// Sem dependências, para poder ser testado direto no Node
// (ver scripts/testar-datas.mjs).

const p2 = (n) => String(n).padStart(2, '0')

// '2026-08-01' -> [2026, 8, 1]; entrada inválida -> null
export function partesISO(iso) {
  const partes = String(iso || '').slice(0, 10).split('-').map(Number)
  if (partes.length !== 3 || partes.some((n) => !Number.isFinite(n))) return null
  return partes
}

// '2026-08-01' -> Date local à meia-noite
export function paraDate(iso) {
  const partes = partesISO(iso)
  if (!partes) return null
  return new Date(partes[0], partes[1] - 1, partes[2])
}

// Date -> '2026-08-01' (lendo os componentes LOCAIS, nunca toISOString)
export function paraISO(data) {
  if (!(data instanceof Date) || Number.isNaN(data.getTime())) return ''
  return `${data.getFullYear()}-${p2(data.getMonth() + 1)}-${p2(data.getDate())}`
}

// O dia de hoje segundo o relógio de quem está usando o sistema.
export const hojeISO = () => paraISO(new Date())

export function somarDias(iso, n) {
  const data = paraDate(iso)
  if (!data) return ''
  data.setDate(data.getDate() + Number(n || 0))
  return paraISO(data)
}

// Distância em dias de `a` até `b` (negativo se `b` for anterior).
// Normaliza para meio-dia antes de subtrair, para o horário de verão (quando
// um dia tem 23 ou 25 horas) não gerar um resultado quebrado.
export function diferencaEmDias(a, b) {
  const da = paraDate(a)
  const db = paraDate(b)
  if (!da || !db) return null
  da.setHours(12)
  db.setHours(12)
  return Math.round((db - da) / 86400000)
}

// 0 = domingo ... 6 = sábado
export function diaDaSemana(iso) {
  const data = paraDate(iso)
  return data ? data.getDay() : null
}

export const ehFimDeSemana = (iso) => [0, 6].includes(diaDaSemana(iso))
export const ehHoje = (iso) => String(iso || '').slice(0, 10) === hojeISO()
export const ehPassado = (iso) => !!iso && String(iso).slice(0, 10) < hojeISO()

// ---- Mês ----

export const mesDe = (iso) => String(iso || '').slice(0, 7)
export const mesAtual = () => mesDe(hojeISO())

// Anda N meses num mês 'AAAA-MM' ('2026-12' + 1 -> '2027-01')
export function mudarMes(mes, n) {
  const [ano, m] = String(mes || '').split('-').map(Number)
  if (!Number.isFinite(ano) || !Number.isFinite(m)) return ''
  const alvo = new Date(ano, m - 1 + Number(n || 0), 1)
  return `${alvo.getFullYear()}-${p2(alvo.getMonth() + 1)}`
}

export function diasNoMes(mes) {
  const [ano, m] = String(mes || '').split('-').map(Number)
  if (!Number.isFinite(ano) || !Number.isFinite(m)) return 0
  // Dia 0 do mês seguinte é o último dia deste mês.
  return new Date(ano, m, 0).getDate()
}

// ---- Grades do calendário ----

export const inicioDaSemana = (iso) => somarDias(iso, -diaDaSemana(iso))

// Os 7 dias da semana (domingo a sábado) que contêm `iso`.
export function semanaDe(iso) {
  const inicio = inicioDaSemana(iso)
  return Array.from({ length: 7 }, (_, i) => somarDias(inicio, i))
}

// A grade do mês, começando no domingo da semana do dia 1 e terminando no
// sábado da semana do último dia. Devolve 28, 35 ou 42 datas — só as semanas
// necessárias, para fevereiro não exibir uma linha inteira vazia no fim.
export function gradeDoMes(mes) {
  const primeiro = `${mes}-01`
  const deslocamento = diaDaSemana(primeiro)
  if (deslocamento === null) return []
  const semanas = Math.ceil((deslocamento + diasNoMes(mes)) / 7)
  const inicio = somarDias(primeiro, -deslocamento)
  return Array.from({ length: semanas * 7 }, (_, i) => somarDias(inicio, i))
}

// ---- Exibição ----

export const DIAS_CURTOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

// '2026-08' -> 'Agosto de 2026'
export function rotuloMes(mes) {
  const [ano, m] = String(mes || '').split('-').map(Number)
  if (!MESES[m - 1]) return ''
  const nome = MESES[m - 1]
  return `${nome.charAt(0).toUpperCase()}${nome.slice(1)} de ${ano}`
}

// '2026-08-01' -> 'sábado, 1 de agosto'
export function diaExtenso(iso) {
  const partes = partesISO(iso)
  if (!partes) return ''
  const data = paraDate(iso)
  const semana = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
  return `${semana[data.getDay()]}, ${partes[2]} de ${MESES[partes[1] - 1]}`
}

// '2026-08-01' -> '01/08'
export function diaCurto(iso) {
  const partes = partesISO(iso)
  return partes ? `${p2(partes[2])}/${p2(partes[1])}` : ''
}

// Rótulo relativo para datas próximas: 'Hoje', 'Amanhã', 'Ontem'.
// Fora dessa janela devolve '' e a tela usa a data normal.
export function rotuloRelativo(iso) {
  const dias = diferencaEmDias(hojeISO(), iso)
  if (dias === 0) return 'Hoje'
  if (dias === 1) return 'Amanhã'
  if (dias === -1) return 'Ontem'
  return ''
}

// O Postgres devolve `time` como '14:00:00'; a tela mostra '14:00'.
export function formatHora(hora) {
  const texto = String(hora || '').trim()
  return /^\d{2}:\d{2}/.test(texto) ? texto.slice(0, 5) : ''
}

// Chave de ordenação de um item de agenda. Quem não tem hora marcada vai para o
// fim do dia — é um compromisso "quando der", não um às 00:00.
export function chaveOrdem(item) {
  return `${String(item?.data || '').slice(0, 10)} ${formatHora(item?.hora) || '99:99'}`
}
