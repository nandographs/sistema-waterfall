// Teste do relatório financeiro (src/relatorio/html.js + resumoDoPeriodo).
// Não toca no banco nem no navegador. Uso: node scripts/testar-relatorio.mjs
//
// O que este arquivo protege: um relatório em PDF é lido como verdade e some
// para dentro de uma pasta. Se o total estiver errado, ninguém confere contra o
// sistema — só aparece meses depois, batendo com o contador. Por isso o teste é
// do CONTEÚDO (os números que saem no documento), e não de layout.

import { resumoDoPeriodo, formatBRL } from '../src/data/financeiro.js'
import { montarHtmlRelatorio, repartirEmFolhas, nomeArquivoRelatorio, esc } from '../src/relatorio/html.js'
import { intervaloDoRelatorio, rotuloDoRelatorio } from '../src/lib/datas.js'

let falhas = 0
const check = (cond, msg) => {
  console.log(`${cond ? 'ok ' : 'FALHOU'} ${msg}`)
  if (!cond) falhas++
}
const eq = (a, b, msg) => check(
  JSON.stringify(a) === JSON.stringify(b),
  `${msg}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` — esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`}`,
)

// Agosto de 2026: duas entradas e uma saída realizadas, mais contas em aberto.
// Há também movimento de julho e de setembro, que NÃO podem vazar para agosto.
const lancamentos = [
  { tipo: 'entrada', status: 'realizado', valor: 3000, dataPagamento: '2026-08-03', vencimento: '2026-08-01', categoria: 'venda', descricao: 'Venda 12', clienteId: 'c1' },
  { tipo: 'entrada', status: 'realizado', valor: 500, dataPagamento: '2026-08-20', vencimento: '2026-08-20', categoria: 'servico', descricao: 'Troca de refil', clienteId: 'c2' },
  { tipo: 'saida', status: 'realizado', valor: 800, dataPagamento: '2026-08-10', vencimento: '2026-08-10', categoria: 'fornecedor', descricao: 'Compra de filtros' },
  { tipo: 'entrada', status: 'previsto', valor: 1200, vencimento: '2026-08-28', categoria: 'venda', descricao: 'Venda 13 (2/3)', clienteId: 'c1' },
  { tipo: 'saida', status: 'previsto', valor: 300, vencimento: '2026-08-30', categoria: 'aluguel', descricao: 'Aluguel' },
  // fora de agosto
  { tipo: 'entrada', status: 'realizado', valor: 9999, dataPagamento: '2026-07-15', vencimento: '2026-07-15', categoria: 'venda', descricao: 'Julho' },
  { tipo: 'entrada', status: 'realizado', valor: 7777, dataPagamento: '2026-09-02', vencimento: '2026-09-02', categoria: 'venda', descricao: 'Setembro' },
]

const nomeCategoria = (c) => ({ venda: 'Venda', servico: 'Serviço', fornecedor: 'Fornecedor', aluguel: 'Aluguel' }[c] ?? c)
const nomeCliente = (id) => ({ c1: 'Maria & Cia', c2: 'João <Teste>' }[id] ?? '')

console.log('--- resumoDoPeriodo nas três escalas ---')
{
  const mes = resumoDoPeriodo(lancamentos, intervaloDoRelatorio('mensal', '2026-08-12'))
  eq(mes.entradas.realizado, 3500, 'entradas de agosto (julho e setembro ficam de fora)')
  eq(mes.saidas.realizado, 800, 'saídas de agosto')
  eq(mes.resultado, 2700, 'resultado é o caixa realizado')
  eq(mes.entradas.previsto, 1200, 'a receber em agosto')
  eq(mes.projetado, 3600, 'projetado = (3500+1200) − (800+300)')
  eq(mes.movimentos.realizados.length, 3, 'três movimentos realizados')
  eq(
    mes.movimentos.realizados.map((l) => l.dataPagamento),
    ['2026-08-03', '2026-08-10', '2026-08-20'],
    'listados na ordem em que aconteceram',
  )
  eq(mes.movimentos.previstos.length, 2, 'dois em aberto')
}
{
  // A semana de 02 a 08/08 pega só a venda do dia 03.
  const semana = resumoDoPeriodo(lancamentos, intervaloDoRelatorio('semanal', '2026-08-05'))
  eq(semana.entradas.realizado, 3000, 'a semana pega só o que caiu dentro dela')
  eq(semana.saidas.realizado, 0, 'a compra do dia 10 é de outra semana')
  eq(semana.movimentos.realizados.length, 1, 'um movimento na semana')
}
{
  const ano = resumoDoPeriodo(lancamentos, intervaloDoRelatorio('anual', '2026-08-12'))
  eq(ano.entradas.realizado, 3500 + 9999 + 7777, 'o ano soma julho, agosto e setembro')
  eq(ano.movimentos.realizados.length, 5, 'todos os realizados do ano')
}
{
  const vazio = resumoDoPeriodo(lancamentos, intervaloDoRelatorio('anual', '2020-01-01'))
  eq(vazio.resultado, 0, 'ano sem movimento dá zero')
  eq(vazio.movimentos.realizados, [], 'e nenhuma linha')
}

console.log('\n--- repartirEmFolhas ---')
eq(repartirEmFolhas([], 14, 34).length, 1, 'lista vazia ainda rende uma folha (com o resumo)')
eq(repartirEmFolhas(Array(10).fill('x'), 14, 34).length, 1, '10 linhas cabem na primeira folha')
eq(repartirEmFolhas(Array(14).fill('x'), 14, 34).length, 1, 'exatamente 14 ainda é uma folha')
eq(repartirEmFolhas(Array(15).fill('x'), 14, 34).length, 2, '15 já pede a segunda')
eq(repartirEmFolhas(Array(48).fill('x'), 14, 34).map((f) => f.length), [14, 34], 'primeira menor, demais cheias')
eq(repartirEmFolhas(Array(49).fill('x'), 14, 34).map((f) => f.length), [14, 34, 1], 'a sobra vira a última folha')
{
  // Nenhuma linha pode se perder nem aparecer duas vezes na quebra.
  const linhas = Array.from({ length: 137 }, (_, i) => i)
  const juntas = repartirEmFolhas(linhas, 14, 34).flat()
  eq(juntas, linhas, '137 linhas atravessam a paginação inteiras e na ordem')
}

console.log('\n--- o documento montado ---')
{
  const resumo = resumoDoPeriodo(lancamentos, intervaloDoRelatorio('mensal', '2026-08-12'))
  const anterior = resumoDoPeriodo(lancamentos, intervaloDoRelatorio('mensal', '2026-07-12'))
  const html = montarHtmlRelatorio({
    rotuloEscala: 'Mensal',
    rotuloPeriodo: rotuloDoRelatorio('mensal', '2026-08-12'),
    emCurso: false,
    emitidoEm: '2026-09-04',
    resumo,
    resumoAnterior: anterior,
    nomeCategoria,
    nomeCliente,
  })

  check(html.includes('Agosto de 2026'), 'traz o período no cabeçalho')
  check(html.includes(esc(formatBRL(3500))), 'mostra o total de entradas')
  check(html.includes(esc(formatBRL(2700))), 'mostra o resultado')
  check(html.includes('Compra de filtros'), 'lista o movimento de saída')
  // O rótulo bonito tem que valer TAMBÉM no quadro de categorias, e não só
  // na lista de movimentos — a chave crua ('fornecedor') não é para ser lida.
  check(html.includes('Fornecedor'), 'categoria sai com o rótulo, não com a chave do banco')
  check(!/>fornecedor</.test(html), 'e a chave crua não aparece em lugar nenhum')
  check(html.includes('Venda 13 (2/3)'), 'lista o que está em aberto')
  check(!html.includes('Julho'), 'não vaza movimento de julho para o relatório de agosto')
  check(html.includes('Emitido em 04/09/2026'), 'carimba a data de emissão')

  // Julho teve 9999 de entrada e agosto 3500: queda de 65%.
  check(html.includes('-65%'), 'compara com o período anterior')

  // O nome do cliente vem do cadastro e pode ter qualquer caractere.
  check(html.includes('João &lt;Teste&gt;'), 'escapa HTML vindo do cadastro')
  check(!html.includes('<Teste>'), 'e não deixa a tag crua passar')

  const folhas = (html.match(/class="pagina"/g) || []).length
  eq(folhas, 2, 'uma folha de realizados + uma de em aberto')
}
{
  // Período em curso precisa avisar: quem arquiva o PDF não vê que o mês ainda
  // não fechou, e compara um mês pela metade com um mês inteiro.
  const resumo = resumoDoPeriodo(lancamentos, intervaloDoRelatorio('mensal', '2026-08-12'))
  const html = montarHtmlRelatorio({
    rotuloEscala: 'Mensal', rotuloPeriodo: 'Agosto de 2026', emCurso: true,
    emitidoEm: '2026-08-15', resumo, resumoAnterior: resumo,
  })
  check(html.includes('ainda em curso'), 'avisa que o período não fechou')
}
{
  // Sem movimento nenhum o documento ainda existe, e diz isso.
  const vazio = resumoDoPeriodo([], intervaloDoRelatorio('semanal', '2026-08-05'))
  const html = montarHtmlRelatorio({
    rotuloEscala: 'Semanal', rotuloPeriodo: '02/08/2026 a 08/08/2026', emCurso: false,
    emitidoEm: '2026-08-10', resumo: vazio, resumoAnterior: vazio,
  })
  check(html.includes('Nenhuma movimentação'), 'período vazio diz que está vazio')
  check(html.includes('—'), 'variação sem base anterior vira traço, não +100%')
  eq((html.match(/class="pagina"/g) || []).length, 1, 'uma folha só')
}

console.log('\n--- nome do arquivo ---')
eq(
  nomeArquivoRelatorio('Mensal', 'Agosto de 2026'),
  'relatorio-financeiro-mensal-agosto-de-2026.pdf',
  'acento e espaço saem do nome do arquivo',
)
eq(
  nomeArquivoRelatorio('Semanal', '09/08/2026 a 15/08/2026'),
  'relatorio-financeiro-semanal-09082026-a-15082026.pdf',
  'a barra da data não vira pasta no nome do arquivo',
)

console.log(`\n${falhas === 0 ? 'TUDO OK' : `${falhas} FALHA(S)`}`)
process.exit(falhas === 0 ? 0 : 1)
