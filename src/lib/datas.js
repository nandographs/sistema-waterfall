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

// ---- Períodos ----
//
// O recorte de data que as telas oferecem ("este mês", "esta semana"…). O
// rótulo mora junto do cálculo de propósito: são a mesma decisão, e separá-los
// é como a tela acaba dizendo "Este mês" enquanto filtra outra coisa.

export const PERIODOS = {
  todos: 'Todo o período',
  hoje: 'Hoje',
  semana: 'Esta semana',
  mes: 'Este mês',
  mes_passado: 'Mês passado',
  ano: 'Este ano',
}

// O intervalo { de, ate } de um período, INCLUSIVO nas duas pontas — as telas
// comparam com texto ISO, que ordena corretamente como string.
//
// `todos` devolve null: "sem recorte" não é um intervalo, e inventar um
// intervalo gigante faria a tela filtrar à toa.
//
// `hoje` é parâmetro em vez de hojeISO() lá dentro para isto ser testável: um
// período que só acerta no dia em que o teste rodou não prova nada.
export function intervaloDoPeriodo(periodo, hoje = hojeISO()) {
  if (periodo === 'hoje') return { de: hoje, ate: hoje }

  if (periodo === 'semana') {
    // Semana de domingo a sábado, igual à grade do calendário desta casa.
    const inicio = inicioDaSemana(hoje)
    return { de: inicio, ate: somarDias(inicio, 6) }
  }

  if (periodo === 'mes' || periodo === 'mes_passado') {
    const mes = periodo === 'mes' ? mesDe(hoje) : mudarMes(mesDe(hoje), -1)
    return { de: `${mes}-01`, ate: `${mes}-${p2(diasNoMes(mes))}` }
  }

  if (periodo === 'ano') {
    const ano = String(hoje).slice(0, 4)
    return { de: `${ano}-01-01`, ate: `${ano}-12-31` }
  }

  return null
}

// Uma data cai dentro do período? Sem recorte, tudo cai. Registro SEM data não
// cai em recorte nenhum: ele não aconteceu em momento algum que se possa
// filtrar, e deixá-lo passar faria "Hoje" mostrar coisa de data desconhecida.
export function dentroDoPeriodo(iso, periodo, hoje = hojeISO()) {
  const intervalo = intervaloDoPeriodo(periodo, hoje)
  if (!intervalo) return true
  const dia = String(iso || '').slice(0, 10)
  return !!dia && dia >= intervalo.de && dia <= intervalo.ate
}

// ---- Escala do relatório ----
//
// O recorte acima (`PERIODOS`) é fixo no presente: "este mês", "esta semana".
// O relatório precisa de outra coisa — uma ESCALA que se possa navegar para
// trás e para frente, para comparar setembro com agosto ou 2026 com 2025.
//
// Por isso o par (escala, âncora): a escala diz o tamanho da janela e a âncora
// é qualquer dia dentro dela. Andar no tempo é mexer só na âncora, e a janela
// se recalcula sozinha — é o que impede o clássico "31 de março menos um mês".

export const ESCALAS_RELATORIO = {
  semanal: 'Semanal',
  mensal: 'Mensal',
  anual: 'Anual',
}

// A janela { de, ate } daquela escala, inclusiva nas duas pontas.
export function intervaloDoRelatorio(escala, ancora) {
  if (escala === 'semanal') {
    const inicio = inicioDaSemana(ancora)
    return { de: inicio, ate: somarDias(inicio, 6) }
  }
  if (escala === 'anual') {
    const ano = String(ancora || '').slice(0, 4)
    return { de: `${ano}-01-01`, ate: `${ano}-12-31` }
  }
  const mes = mesDe(ancora)
  return { de: `${mes}-01`, ate: `${mes}-${p2(diasNoMes(mes))}` }
}

// Anda `n` períodos (negativo volta). Devolve a âncora nova.
//
// No mensal a âncora nova é sempre o DIA 1: partir do dia 31 e voltar um mês
// cairia em 28/02 e, ao avançar de novo, em 28/03 — o mês "andaria" sozinho.
export function andarNoRelatorio(escala, ancora, n) {
  const passos = Number(n || 0)
  if (escala === 'semanal') return somarDias(ancora, 7 * passos)
  if (escala === 'anual') {
    const ano = Number(String(ancora || '').slice(0, 4))
    return Number.isFinite(ano) ? `${ano + passos}-01-01` : ''
  }
  const mes = mudarMes(mesDe(ancora), passos)
  return mes ? `${mes}-01` : ''
}

// Como o período se chama na tela e no PDF.
export function rotuloDoRelatorio(escala, ancora) {
  if (escala === 'semanal') {
    const { de, ate } = intervaloDoRelatorio('semanal', ancora)
    // Data cheia nas duas pontas: a semana atravessa mês (e às vezes ano), e
    // "30/08 a 05/09" sem o ano vira dúvida em qualquer relatório arquivado.
    return `${dataBR(de)} a ${dataBR(ate)}`
  }
  if (escala === 'anual') return String(ancora || '').slice(0, 4)
  return rotuloMes(mesDe(ancora))
}

// O período atual é o que contém hoje? Serve para a tela não oferecer "próximo"
// e para o PDF avisar que o período ainda está correndo.
export function periodoEmCurso(escala, ancora, hoje = hojeISO()) {
  const { de, ate } = intervaloDoRelatorio(escala, ancora)
  return hoje >= de && hoje <= ate
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

// '2026-08-01' -> '01/08/2026'. É a mesma conta do `formatData` do repositório,
// que passou a chamar esta — a diferença é só o que cada um devolve para vazio:
// aqui '' (para concatenar), lá '—' (para mostrar na tela).
export function dataBR(iso) {
  const partes = partesISO(iso)
  return partes ? `${p2(partes[2])}/${p2(partes[1])}/${partes[0]}` : ''
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
