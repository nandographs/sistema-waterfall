// Teste da aritmética de datas (src/lib/datas.js).
// Não toca no banco nem no navegador. Uso: node scripts/testar-datas.mjs
//
// Estes testes existem por um motivo específico: um erro de fuso aqui não
// quebra nada visivelmente — ele só desloca o calendário em um dia, e você
// descobre semanas depois, quando um compromisso aparece na terça em vez da
// quarta. Por isso a bateria começa justamente pelo caso do fuso.

import {
  partesISO, paraDate, paraISO, hojeISO, somarDias, diferencaEmDias, diaDaSemana,
  ehFimDeSemana, mesDe, mudarMes, diasNoMes, inicioDaSemana, semanaDe, gradeDoMes,
  rotuloMes, diaExtenso, diaCurto, formatHora, chaveOrdem, DIAS_CURTOS,
  intervaloDoPeriodo, dentroDoPeriodo,
} from '../src/lib/datas.js'

let falhas = 0
const check = (cond, msg) => {
  console.log(`${cond ? 'ok ' : 'FALHOU'} ${msg}`)
  if (!cond) falhas++
}
const eq = (a, b, msg) => check(
  JSON.stringify(a) === JSON.stringify(b),
  `${msg}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` — esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`}`,
)

console.log('--- o fuso (a razão de este arquivo existir) ---')
// `new Date('2026-08-01')` é UTC: em Brasília (UTC-3) ele vira 31/07 21:00.
// paraDate/paraISO têm que ir e voltar sem perder o dia, em qualquer fuso.
eq(paraISO(paraDate('2026-08-01')), '2026-08-01', 'ida e volta preserva o dia')
eq(paraISO(paraDate('2026-01-01')), '2026-01-01', 'virada de ano preserva o dia')
eq(paraISO(paraDate('2026-03-01')), '2026-03-01', '1º de março preserva o dia')
eq(paraDate('2026-08-01').getDate(), 1, 'o dia do mês é 1, não 31')
eq(paraDate('2026-08-01').getMonth(), 7, 'o mês é agosto (índice 7)')
eq(hojeISO().length, 10, 'hojeISO devolve AAAA-MM-DD')
eq(hojeISO(), paraISO(new Date()), 'hojeISO usa os componentes locais')

console.log('\n--- partesISO ---')
eq(partesISO('2026-08-01'), [2026, 8, 1], 'quebra a data em números')
eq(partesISO('2026-08-01T10:00:00Z'), [2026, 8, 1], 'ignora a parte de hora')
eq(partesISO(''), null, 'vazio devolve null')
eq(partesISO(null), null, 'null devolve null')
eq(partesISO('abacaxi'), null, 'texto inválido devolve null')

console.log('\n--- somarDias ---')
eq(somarDias('2026-08-01', 1), '2026-08-02', 'dia seguinte')
eq(somarDias('2026-08-31', 1), '2026-09-01', 'vira o mês')
eq(somarDias('2026-12-31', 1), '2027-01-01', 'vira o ano')
eq(somarDias('2026-03-01', -1), '2026-02-28', 'volta um dia atravessando fevereiro')
eq(somarDias('2028-03-01', -1), '2028-02-29', 'ano bissexto: 29/02 existe')
eq(somarDias('2026-08-01', 0), '2026-08-01', 'zero não muda nada')
eq(somarDias('2026-08-01', -7), '2026-07-25', 'uma semana atrás')
eq(somarDias('', 5), '', 'data vazia devolve vazio')

console.log('\n--- diferencaEmDias ---')
eq(diferencaEmDias('2026-08-01', '2026-08-08'), 7, 'uma semana à frente')
eq(diferencaEmDias('2026-08-08', '2026-08-01'), -7, 'uma semana atrás é negativo')
eq(diferencaEmDias('2026-08-01', '2026-08-01'), 0, 'mesmo dia é zero')
eq(diferencaEmDias('2026-12-31', '2027-01-01'), 1, 'atravessa o ano')
// Em 2026 o Brasil não tem horário de verão, mas o teste protege o cálculo
// caso ele volte (ou em qualquer fuso que o tenha): um dia de 23h ou 25h não
// pode virar 0,96 ou 1,04 dia arredondado errado.
eq(diferencaEmDias('2026-10-17', '2026-10-19'), 2, 'dois dias, sem sobrar hora')
eq(diferencaEmDias('2026-02-14', '2026-03-01'), 15, 'atravessa fevereiro')

console.log('\n--- diaDaSemana ---')
eq(diaDaSemana('2026-08-01'), 6, '1º de agosto de 2026 é sábado')
eq(diaDaSemana('2026-08-02'), 0, '2 de agosto de 2026 é domingo')
eq(diaDaSemana('2026-07-31'), 5, '31 de julho de 2026 é sexta')
eq(DIAS_CURTOS[diaDaSemana('2026-08-01')], 'Sáb', 'o rótulo bate com o índice')
check(ehFimDeSemana('2026-08-01') && ehFimDeSemana('2026-08-02'), 'sábado e domingo são fim de semana')
check(!ehFimDeSemana('2026-07-31'), 'sexta não é fim de semana')

console.log('\n--- mês ---')
eq(mesDe('2026-08-01'), '2026-08', 'extrai o mês')
eq(mudarMes('2026-12', 1), '2027-01', 'dezembro + 1 vira janeiro do ano seguinte')
eq(mudarMes('2026-01', -1), '2025-12', 'janeiro - 1 volta para dezembro')
eq(mudarMes('2026-08', 0), '2026-08', 'zero não muda')
eq(mudarMes('2026-08', 6), '2027-02', 'seis meses à frente')
eq(diasNoMes('2026-02'), 28, 'fevereiro comum tem 28')
eq(diasNoMes('2028-02'), 29, 'fevereiro bissexto tem 29')
eq(diasNoMes('2026-08'), 31, 'agosto tem 31')
eq(diasNoMes('2026-04'), 30, 'abril tem 30')

console.log('\n--- semana ---')
eq(inicioDaSemana('2026-08-01'), '2026-07-26', 'a semana do sábado 01/08 começa no domingo 26/07')
eq(semanaDe('2026-08-01').length, 7, 'a semana tem 7 dias')
eq(semanaDe('2026-08-01')[0], '2026-07-26', 'começa no domingo')
eq(semanaDe('2026-08-01')[6], '2026-08-01', 'termina no sábado')
check(semanaDe('2026-08-01').includes('2026-08-01'), 'a semana contém o dia pedido')

console.log('\n--- gradeDoMes ---')
{
  const agosto = gradeDoMes('2026-08')
  eq(agosto.length % 7, 0, 'a grade fecha em semanas inteiras')
  eq(agosto[0], '2026-07-26', 'começa no domingo da semana do dia 1')
  eq(diaDaSemana(agosto[0]), 0, 'o primeiro dia da grade é um domingo')
  eq(diaDaSemana(agosto[agosto.length - 1]), 6, 'o último dia da grade é um sábado')
  check(agosto.includes('2026-08-01') && agosto.includes('2026-08-31'), 'contém o mês inteiro')

  // Fevereiro de 2027 começa numa segunda e tem 28 dias: 1 + 28 = 29 células,
  // que cabem em 5 semanas. A grade não pode inventar uma 6ª linha vazia.
  eq(gradeDoMes('2027-02').length, 35, 'fevereiro de 2027 ocupa 5 semanas')

  // Fevereiro de 2026 começa num domingo e tem 28 dias: exatamente 4 semanas.
  eq(gradeDoMes('2026-02').length, 28, 'fevereiro de 2026 ocupa 4 semanas exatas')
  eq(gradeDoMes('2026-02')[0], '2026-02-01', 'e começa no próprio dia 1')

  // Todo dia do mês tem que aparecer uma vez só.
  const doMes = gradeDoMes('2026-08').filter((d) => mesDe(d) === '2026-08')
  eq(doMes.length, 31, 'os 31 dias de agosto aparecem na grade')
  eq(new Set(doMes).size, 31, 'sem dias repetidos')
}

console.log('\n--- exibição ---')
eq(rotuloMes('2026-08'), 'Agosto de 2026', 'rótulo do mês com maiúscula')
eq(rotuloMes('2026-03'), 'Março de 2026', 'acento preservado')
eq(diaExtenso('2026-08-01'), 'sábado, 1 de agosto', 'dia por extenso')
eq(diaExtenso('2026-07-31'), 'sexta-feira, 31 de julho', 'dia por extenso com hífen')
eq(diaCurto('2026-08-01'), '01/08', 'dia curto com zero à esquerda')
eq(formatHora('14:00:00'), '14:00', 'corta os segundos que o Postgres manda')
eq(formatHora('09:30'), '09:30', 'já no formato certo passa direto')
eq(formatHora(''), '', 'sem hora devolve vazio')
eq(formatHora(null), '', 'null devolve vazio')

console.log('\n--- chaveOrdem ---')
// Quem não marcou hora vai para o fim do dia — é um "quando der", não um 00:00.
{
  const itens = [
    { data: '2026-08-01', hora: '' },
    { data: '2026-08-01', hora: '14:00:00' },
    { data: '2026-08-01', hora: '09:00:00' },
    { data: '2026-07-31', hora: '' },
  ]
  const ordenado = itens
    .slice()
    .sort((a, b) => chaveOrdem(a).localeCompare(chaveOrdem(b)))
    .map((i) => `${diaCurto(i.data)} ${formatHora(i.hora) || '—'}`)
  eq(
    ordenado,
    ['31/07 —', '01/08 09:00', '01/08 14:00', '01/08 —'],
    'ordena por dia, depois por hora, com os sem-hora no fim do dia',
  )
}

console.log('\n--- períodos (o recorte de data dos filtros) ---')
{
  // Quarta-feira, 12/08/2026. Ancorado num dia fixo de propósito: um período
  // que só acerta no dia em que o teste rodou não prova nada.
  const quarta = '2026-08-12'

  eq(intervaloDoPeriodo('todos', quarta), null, 'sem recorte não é um intervalo')
  eq(intervaloDoPeriodo('hoje', quarta), { de: '2026-08-12', ate: '2026-08-12' }, 'hoje é um dia só')
  eq(
    intervaloDoPeriodo('semana', quarta),
    { de: '2026-08-09', ate: '2026-08-15' },
    'a semana da quarta vai do domingo ao sábado',
  )
  eq(
    intervaloDoPeriodo('mes', quarta),
    { de: '2026-08-01', ate: '2026-08-31' },
    'este mês pega o mês inteiro, até o último dia',
  )
  eq(
    intervaloDoPeriodo('mes_passado', quarta),
    { de: '2026-07-01', ate: '2026-07-31' },
    'mês passado',
  )
  eq(
    intervaloDoPeriodo('ano', quarta),
    { de: '2026-01-01', ate: '2026-12-31' },
    'este ano',
  )
}
{
  // Os cantos: virada de ano, fevereiro (com e sem bissexto) e a semana que
  // atravessa dois meses — onde um cálculo ingênuo erra.
  eq(
    intervaloDoPeriodo('mes_passado', '2026-01-15'),
    { de: '2025-12-01', ate: '2025-12-31' },
    'mês passado em janeiro volta para dezembro do ano anterior',
  )
  eq(
    intervaloDoPeriodo('mes', '2026-02-10'),
    { de: '2026-02-01', ate: '2026-02-28' },
    'fevereiro comum termina no dia 28',
  )
  eq(
    intervaloDoPeriodo('mes', '2028-02-10'),
    { de: '2028-02-01', ate: '2028-02-29' },
    'fevereiro bissexto termina no dia 29',
  )
  eq(
    intervaloDoPeriodo('semana', '2026-08-31'),
    { de: '2026-08-30', ate: '2026-09-05' },
    'a semana pode atravessar a virada do mês',
  )
  eq(
    intervaloDoPeriodo('semana', '2026-08-09'),
    { de: '2026-08-09', ate: '2026-08-15' },
    'domingo é o primeiro dia da própria semana',
  )
  eq(
    intervaloDoPeriodo('semana', '2026-08-15'),
    { de: '2026-08-09', ate: '2026-08-15' },
    'sábado é o último dia da própria semana',
  )
}
{
  const quarta = '2026-08-12'
  eq(dentroDoPeriodo('2026-08-12', 'hoje', quarta), true, 'o próprio dia cai em hoje')
  eq(dentroDoPeriodo('2026-08-11', 'hoje', quarta), false, 'ontem não cai em hoje')
  eq(dentroDoPeriodo('2026-08-09', 'semana', quarta), true, 'a borda de baixo é inclusiva')
  eq(dentroDoPeriodo('2026-08-15', 'semana', quarta), true, 'a borda de cima é inclusiva')
  eq(dentroDoPeriodo('2026-08-16', 'semana', quarta), false, 'o domingo seguinte já é outra semana')
  eq(dentroDoPeriodo('2020-01-01', 'todos', quarta), true, 'sem recorte tudo passa')
  eq(dentroDoPeriodo('', 'todos', quarta), true, 'sem recorte, até o sem-data passa')
  eq(dentroDoPeriodo('', 'mes', quarta), false, 'registro sem data não cai em recorte nenhum')
  eq(
    dentroDoPeriodo('2026-08-12T15:30:00Z', 'hoje', quarta),
    true,
    'timestamp completo é cortado no dia antes de comparar',
  )
}

console.log(`\n${falhas === 0 ? 'TUDO OK' : `${falhas} FALHA(S)`}`)
process.exit(falhas === 0 ? 0 : 1)
