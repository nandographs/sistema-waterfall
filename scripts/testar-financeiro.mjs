// Teste das regras de dinheiro (src/data/financeiro.js).
// Não toca no banco nem no navegador. Uso: node scripts/testar-financeiro.mjs

import {
  somarMeses, dividirCentavos, totaisDaVenda, planoDeParcelas,
  resumoDoMes, variacao, somarMesesNoMes, mesDe,
  normalizarPagamentos, diferencaDosPagamentos, pagamentosDaCondicao, resolverPagamentos,
  planoDePagamentos, resumoDosPagamentos,
} from '../src/data/financeiro.js'

let falhas = 0
const check = (cond, msg) => {
  console.log(`${cond ? 'ok ' : 'FALHOU'} ${msg}`)
  if (!cond) falhas++
}
const eq = (a, b, msg) => check(
  JSON.stringify(a) === JSON.stringify(b),
  `${msg}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` — esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`}`,
)

console.log('--- somarMeses ---')
eq(somarMeses('2026-07-25', 1), '2026-08-25', 'mês seguinte, dia igual')
eq(somarMeses('2026-07-25', 6), '2027-01-25', 'atravessa o ano')
eq(somarMeses('2026-01-31', 1), '2026-02-28', '31/01 + 1 mês cai em 28/02 (sem overflow)')
eq(somarMeses('2028-01-31', 1), '2028-02-29', 'ano bissexto: 29/02')
eq(somarMeses('2026-08-31', 1), '2026-09-30', '31/08 + 1 mês cai em 30/09')
eq(somarMeses('2026-07-25', 0), '2026-07-25', 'zero mês não muda a data')
eq(somarMeses('', 3), '', 'data vazia devolve vazio')

console.log('\n--- dividirCentavos ---')
eq(dividirCentavos(1000, 3), [334, 333, 333], 'R$10,00 em 3x sem perder centavo')
eq(dividirCentavos(1000, 3).reduce((a, b) => a + b, 0), 1000, 'a soma bate com o total')
eq(dividirCentavos(100, 1), [100], 'parcela única')
eq(dividirCentavos(10, 4), [3, 3, 2, 2], 'resto distribuído nas primeiras')

console.log('\n--- totaisDaVenda ---')
{
  const itens = [
    { quantidade: 1, valorUnitario: 2990, desconto: 100 },
    { quantidade: 2, valorUnitario: 180, desconto: 0 },
  ]
  const { subtotal, total } = totaisDaVenda(itens, 50, 30)
  eq(subtotal, 3250, 'subtotal soma os itens já com desconto de linha')
  eq(total, 3230, 'total aplica desconto geral e soma frete')
}
eq(totaisDaVenda([], 0, 0), { subtotal: 0, total: 0 }, 'sem itens dá zero')
eq(
  totaisDaVenda([{ quantidade: 1, valorUnitario: 100, desconto: 500 }]).subtotal,
  0,
  'desconto maior que a linha não vira valor negativo',
)
eq(totaisDaVenda([{ quantidade: 1, valorUnitario: 100 }], 999).total, 0, 'total nunca fica negativo')

console.log('\n--- planoDeParcelas ---')
{
  const p = planoDeParcelas({ descricao: 'Venda 1', total: 0, data: '2026-07-25' })
  eq(p.length, 0, 'valor zero não gera lançamento')
}
{
  const p = planoDeParcelas({
    descricao: 'Venda 1', total: 1000, data: '2026-07-25', primeiroVencimento: '2026-07-25',
  })
  eq(p.length, 1, 'à vista gera 1 lançamento')
  eq(p[0].valor, 1000, 'valor cheio')
  eq(p[0].vencimento, '2026-07-25', 'vence na data')
  eq(p[0].descricao, 'Venda 1', 'sem sufixo de parcela quando é única')
  eq(p[0].status, 'previsto', 'nasce previsto')
}
{
  const p = planoDeParcelas({
    descricao: 'Venda 2', total: 1000, parcelas: 3, primeiroVencimento: '2026-07-25',
  })
  eq(p.length, 3, '3 parcelas')
  eq(p.map((l) => l.valor), [333.34, 333.33, 333.33], 'centavo extra vai na 1ª parcela')
  eq(
    Math.round(p.reduce((s, l) => s + l.valor, 0) * 100) / 100,
    1000,
    'a soma das parcelas bate exatamente com o total',
  )
  eq(p.map((l) => l.vencimento), ['2026-07-25', '2026-08-25', '2026-09-25'], 'vencimentos mensais')
  eq(p.map((l) => l.descricao), ['Venda 2 (1/3)', 'Venda 2 (2/3)', 'Venda 2 (3/3)'], 'sufixo n/N')
  eq(p.map((l) => l.parcela), [1, 2, 3], 'numeração sequencial')
}
{
  const p = planoDeParcelas({
    descricao: 'Venda 3', total: 3000, entrada: 600, parcelas: 3,
    data: '2026-07-25', primeiroVencimento: '2026-08-25',
  })
  eq(p.length, 4, 'entrada + 3 parcelas = 4 lançamentos')
  eq(p[0].valor, 600, 'entrada com o valor informado')
  eq(p[0].vencimento, '2026-07-25', 'entrada vence na data da venda')
  eq(p[0].descricao, 'Venda 3 (entrada)', 'entrada identificada')
  eq(p.slice(1).map((l) => l.valor), [800, 800, 800], 'restante dividido igualmente')
  eq(
    Math.round(p.reduce((s, l) => s + l.valor, 0) * 100) / 100,
    3000,
    'entrada + parcelas somam o total',
  )
  eq(p.every((l) => l.parcelas === 4), true, 'todos sabem que são 4 no total')
}
{
  const p = planoDeParcelas({ descricao: 'V', total: 500, entrada: 900, data: '2026-07-25' })
  eq(p.length, 1, 'entrada maior que o total vira pagamento único')
  eq(p[0].valor, 500, 'entrada é limitada ao total')
}
{
  const p = planoDeParcelas({
    descricao: 'V', total: 100, parcelas: 3, primeiroVencimento: '2026-01-31',
  })
  eq(
    p.map((l) => l.vencimento),
    ['2026-01-31', '2026-02-28', '2026-03-31'],
    'vencimentos em fim de mês não escorregam',
  )
}

console.log('\n--- pagamentos: normalizar e conferir a soma ---')
{
  const lista = normalizarPagamentos([
    { forma: 'dinheiro', valor: '500', entrada: true, parcelas: 3 },
    { forma: 'cartao', valor: 2500, parcelas: '3' },
    { forma: 'pix', valor: 0 },
    { forma: 'pix', valor: '' },
  ])
  eq(lista.length, 2, 'linha sem valor não conta como forma de pagamento')
  eq(lista[0].parcelas, 1, 'entrada nunca parcela, mesmo se vier parcelas na linha')
  eq(lista[1].parcelas, 3, 'parcelas viram número')
  eq(lista[0].valor, 500, 'valor vira número')
}
eq(normalizarPagamentos(null), [], 'lista ausente vira lista vazia')
eq(diferencaDosPagamentos(3000, [{ forma: 'dinheiro', valor: 500, entrada: true }, { forma: 'cartao', valor: 2500 }]), 0, 'plano que fecha dá diferença zero')
eq(diferencaDosPagamentos(3000, [{ forma: 'dinheiro', valor: 500 }]), 250000, 'falta em centavos')
eq(diferencaDosPagamentos(3000, [{ forma: 'pix', valor: 3200 }]), -20000, 'excesso vem negativo')
eq(
  diferencaDosPagamentos(0.3, [{ forma: 'pix', valor: 0.1 }, { forma: 'pix', valor: 0.2 }]),
  0,
  'centavos: 0,1 + 0,2 fecha com 0,3 (não dependemos de ponto flutuante)',
)

console.log('\n--- resolverPagamentos: campo em branco vale "o restante" ---')
eq(
  resolverPagamentos([{ forma: 'pix', valor: '' }], 3000),
  [{ forma: 'pix', valor: 3000 }],
  'uma forma só, em branco, leva a venda inteira (o caso comum, sem digitar nada)',
)
eq(
  resolverPagamentos([
    { forma: 'dinheiro', valor: 500, entrada: true },
    { forma: 'cartao', valor: '', parcelas: 3 },
  ], 3000),
  [
    { forma: 'dinheiro', valor: 500, entrada: true },
    { forma: 'cartao', valor: 2500, parcelas: 3 },
  ],
  'com entrada de 500, o cartão fica com os 2.500 restantes',
)
eq(
  resolverPagamentos([{ forma: 'pix', valor: 100 }, { forma: 'cartao', valor: '' }], 100),
  [{ forma: 'pix', valor: 100 }, { forma: 'cartao', valor: 0 }],
  'sem sobra o restante é zero, e não um valor negativo',
)
{
  const duasEmBranco = [{ forma: 'pix', valor: '' }, { forma: 'cartao', valor: '' }]
  eq(
    resolverPagamentos(duasEmBranco, 3000),
    duasEmBranco,
    'duas em branco são ambíguas: a lista volta como veio, para a soma acusar',
  )
}
eq(
  resolverPagamentos([{ forma: 'pix', valor: 3000 }], 3000),
  [{ forma: 'pix', valor: 3000 }],
  'nada em branco, nada a resolver',
)

console.log('\n--- planoDePagamentos: várias formas na mesma venda ---')
{
  // O caso que motivou tudo: entrada em dinheiro, resto parcelado no cartão.
  const p = planoDePagamentos({
    descricao: 'Venda 10',
    data: '2026-07-25',
    pagamentos: [
      { forma: 'dinheiro', valor: 500, entrada: true },
      { forma: 'cartao', valor: 2500, parcelas: 3, primeiroVencimento: '2026-08-25' },
    ],
  })
  eq(p.length, 4, 'entrada + 3 parcelas = 4 lançamentos')
  eq(p.map((l) => l.valor), [500, 833.34, 833.33, 833.33], 'cada forma dividida por conta própria')
  eq(
    Math.round(p.reduce((s, l) => s + l.valor, 0) * 100) / 100,
    3000,
    'a soma de tudo bate com o total da venda',
  )
  eq(
    p.map((l) => l.formaPagamento),
    ['dinheiro', 'cartao', 'cartao', 'cartao'],
    'cada lançamento carrega a SUA forma — é o que o caixa soma por forma',
  )
  eq(p[0].vencimento, '2026-07-25', 'entrada vence na data da venda')
  eq(
    p.slice(1).map((l) => l.vencimento),
    ['2026-08-25', '2026-09-25', '2026-10-25'],
    'as parcelas do cartão seguem o vencimento da linha delas',
  )
  eq(
    p.map((l) => l.descricao),
    ['Venda 10 (entrada · Dinheiro)', 'Venda 10 (1/3 · Cartão)', 'Venda 10 (2/3 · Cartão)', 'Venda 10 (3/3 · Cartão)'],
    'com formas diferentes, o nome do lançamento diz qual é',
  )
  eq(p.map((l) => l.parcela), [1, 2, 3, 4], 'parcela é a posição no plano inteiro')
  eq(p.every((l) => l.parcelas === 4), true, 'e todos sabem que o plano tem 4')
}
{
  // Três formas, uma delas também parcelada.
  const p = planoDePagamentos({
    descricao: 'V',
    data: '2026-07-25',
    pagamentos: [
      { forma: 'dinheiro', valor: 300, entrada: true },
      { forma: 'pix', valor: 700 },
      { forma: 'cartao', valor: 1000, parcelas: 2, primeiroVencimento: '2026-09-10' },
    ],
  })
  eq(p.length, 4, 'entrada + pix à vista + 2 no cartão')
  eq(p.map((l) => l.valor), [300, 700, 500, 500], 'valores por forma')
  eq(
    p.map((l) => l.vencimento),
    ['2026-07-25', '2026-07-25', '2026-09-10', '2026-10-10'],
    'forma sem vencimento próprio cai na data da venda',
  )
  eq(p[1].descricao, 'V (Pix)', 'forma à vista de uma só parcela é rotulada só pela forma')
}
{
  // Forma repetida não precisa de rótulo: não há o que desambiguar.
  const p = planoDePagamentos({
    descricao: 'V', data: '2026-07-25',
    pagamentos: [
      { forma: 'pix', valor: 100, entrada: true },
      { forma: 'pix', valor: 200, parcelas: 2, primeiroVencimento: '2026-08-25' },
    ],
  })
  eq(
    p.map((l) => l.descricao),
    ['V (entrada)', 'V (1/2)', 'V (2/2)'],
    'formas iguais: nada de "· Pix" repetido em toda linha',
  )
}
eq(planoDePagamentos({ descricao: 'V', pagamentos: [] }), [], 'sem forma nenhuma não há o que lançar')
eq(planoDePagamentos({ descricao: 'V', pagamentos: [{ forma: 'pix', valor: 0 }] }), [], 'só valor zero também não lança')

console.log('\n--- pagamentosDaCondicao: a condição antiga vira lista ---')
eq(
  pagamentosDaCondicao({ total: 3000, formaPagamento: 'cartao', condicao: 'parcelado', entrada: 600, parcelas: 3, primeiroVencimento: '2026-08-25' }),
  [
    { forma: 'cartao', valor: 600, parcelas: 1, primeiroVencimento: '', entrada: true },
    { forma: 'cartao', valor: 2400, parcelas: 3, primeiroVencimento: '2026-08-25', entrada: false },
  ],
  'entrada + restante parcelado, tudo na mesma forma',
)
eq(
  pagamentosDaCondicao({ total: 500, formaPagamento: 'pix', entrada: 900 }),
  [{ forma: 'pix', valor: 500, parcelas: 1, primeiroVencimento: '', entrada: true }],
  'entrada maior que o total é limitada ao total e não sobra parcela',
)
eq(pagamentosDaCondicao({ total: 0, formaPagamento: 'pix' }), [], 'total zero não vira pagamento')

console.log('\n--- resumoDosPagamentos: o resumo que a venda guarda ---')
{
  const r = resumoDosPagamentos([
    { forma: 'dinheiro', valor: 500, entrada: true },
    { forma: 'cartao', valor: 2500, parcelas: 3, primeiroVencimento: '2026-08-25' },
  ], '2026-07-25')
  eq(r.formaPagamento, 'cartao', 'a forma principal é a de maior valor fora a entrada')
  eq(r.entrada, 500, 'entrada é a soma das linhas de entrada')
  eq(r.parcelas, 3, 'o maior parcelamento manda no resumo')
  eq(r.condicao, 'parcelado', 'ter parcelamento faz a condição ser parcelado')
  eq(r.primeiroVencimento, '2026-08-25', 'o vencimento mais próximo entre as formas financiadas')
}
{
  const r = resumoDosPagamentos([{ forma: 'dinheiro', valor: 800, entrada: true }], '2026-07-25')
  eq(r.formaPagamento, 'dinheiro', 'venda paga só na entrada usa a forma da entrada')
  eq(r.condicao, 'a_vista', 'sem parcelamento, à vista')
  eq(r.primeiroVencimento, '2026-07-25', 'sem financiada, o vencimento é a data da venda')
}
eq(resumoDosPagamentos([], '2026-07-25'), null, 'sem pagamento não há resumo')

console.log('\n--- planoDeParcelas continua idêntico (a forma única não regrediu) ---')
{
  // A condição antiga tem que gerar EXATAMENTE o mesmo plano que a lista nova
  // gera para a mesma cobrança — é o que garante que nada foi quebrado ao
  // reescrever planoDeParcelas por cima de planoDePagamentos.
  const antigo = planoDeParcelas({
    descricao: 'Venda 3', total: 3000, entrada: 600, parcelas: 3,
    data: '2026-07-25', primeiroVencimento: '2026-08-25', formaPagamento: 'cartao',
  })
  const novo = planoDePagamentos({
    descricao: 'Venda 3', data: '2026-07-25',
    pagamentos: pagamentosDaCondicao({
      total: 3000, formaPagamento: 'cartao', condicao: 'parcelado',
      entrada: 600, parcelas: 3, primeiroVencimento: '2026-08-25',
    }),
  })
  eq(antigo, novo, 'os dois caminhos produzem o mesmo plano')
  eq(antigo.every((l) => l.formaPagamento === 'cartao'), true, 'forma única em todas as parcelas')
}

console.log('\n--- mesDe / somarMesesNoMes ---')
eq(mesDe('2026-07-25'), '2026-07', 'extrai o mês de uma data')
eq(somarMesesNoMes('2026-07', -1), '2026-06', 'mês anterior')
eq(somarMesesNoMes('2026-01', -1), '2025-12', 'volta o ano')
eq(somarMesesNoMes('2026-12', 1), '2027-01', 'avança o ano')

console.log('\n--- resumoDoMes ---')
{
  // Cenário: julho tem 2 recebimentos e 1 pagamento realizados, mais contas
  // em aberto. Há também um lançamento de junho e um pago em agosto, que NÃO
  // podem contaminar o resumo de julho.
  const lista = [
    { tipo: 'entrada', status: 'realizado', valor: 1000, dataPagamento: '2026-07-03', vencimento: '2026-07-01', categoria: 'venda' },
    { tipo: 'entrada', status: 'realizado', valor: 500, dataPagamento: '2026-07-20', vencimento: '2026-07-20', categoria: 'servico' },
    { tipo: 'saida', status: 'realizado', valor: 300, dataPagamento: '2026-07-10', vencimento: '2026-07-10', categoria: 'fornecedor' },
    { tipo: 'entrada', status: 'previsto', valor: 800, vencimento: '2026-07-28', categoria: 'venda' },
    { tipo: 'saida', status: 'previsto', valor: 200, vencimento: '2026-07-30', categoria: 'aluguel' },
    // fora de julho
    { tipo: 'entrada', status: 'realizado', valor: 9999, dataPagamento: '2026-06-15', vencimento: '2026-06-15', categoria: 'venda' },
    { tipo: 'saida', status: 'realizado', valor: 7777, dataPagamento: '2026-08-02', vencimento: '2026-08-02', categoria: 'estoque' },
  ]
  const r = resumoDoMes(lista, '2026-07')
  eq(r.entradas.realizado, 1500, 'entradas realizadas somam só as de julho')
  eq(r.entradas.previsto, 800, 'entradas previstas de julho')
  eq(r.saidas.realizado, 300, 'saídas realizadas de julho')
  eq(r.saidas.previsto, 200, 'saídas previstas de julho')
  eq(r.resultado, 1200, 'resultado é o caixa realizado (1500 − 300)')
  eq(r.projetado, 1800, 'projetado inclui o previsto (2300 − 500)')
  eq(r.entradas.quantidade, 2, 'conta os recebimentos realizados')
  eq(r.categorias.saidas, [{ categoria: 'fornecedor', total: 300 }], 'saídas agrupadas por categoria')
  eq(
    r.categorias.entradas,
    [{ categoria: 'venda', total: 1000 }, { categoria: 'servico', total: 500 }],
    'entradas por categoria, da maior para a menor',
  )
}
{
  // Um lançamento vencido em junho mas PAGO em julho conta no caixa de julho,
  // não no de junho — é regime de caixa.
  const lista = [
    { tipo: 'entrada', status: 'realizado', valor: 400, vencimento: '2026-06-28', dataPagamento: '2026-07-05', categoria: 'venda' },
  ]
  eq(resumoDoMes(lista, '2026-07').entradas.realizado, 400, 'pago em julho entra em julho')
  eq(resumoDoMes(lista, '2026-06').entradas.realizado, 0, 'não aparece em junho, apesar de vencer lá')
}
{
  const vazio = resumoDoMes([], '2026-07')
  eq(vazio.resultado, 0, 'mês sem movimento dá resultado zero')
  eq(vazio.categorias.saidas, [], 'sem categorias')
}
{
  // Um previsto já vencido continua no mês do vencimento (é o que falta receber)
  const lista = [{ tipo: 'entrada', status: 'previsto', valor: 100, vencimento: '2026-07-02' }]
  eq(resumoDoMes(lista, '2026-07').entradas.previsto, 100, 'previsto entra pelo vencimento')
  eq(resumoDoMes(lista, '2026-07').categorias.entradas, [], 'previsto não entra na quebra por categoria')
}

console.log('\n--- variacao ---')
eq(variacao(150, 100), 50, 'alta de 50%')
eq(variacao(50, 100), -50, 'queda de 50%')
eq(variacao(100, 100), 0, 'sem variação')
eq(variacao(100, 0), null, 'sem base anterior não há percentual')
eq(variacao(0, 100), -100, 'zerou o mês')
eq(variacao(-50, -100), 50, 'melhora sobre base negativa usa o módulo')

console.log('\n--- ciclo de troca de refil (datas) ---')
{
  // O ciclo é sempre: data em que o serviço foi CONCLUÍDO + intervalo do refil.
  const proxima = (base, meses) => somarMeses(base, meses)

  eq(proxima('2026-07-25', 6), '2027-01-25', 'venda em 25/07, refil de 6 meses → 25/01')
  // Serviço atrasado: a contagem parte do dia em que foi feito, não do marcado.
  eq(proxima('2027-02-10', 6), '2027-08-10', 'troca marcada p/ 25/01 mas feita em 10/02 → 10/08')
  eq(proxima('2026-08-31', 3), '2026-11-30', 'fim de mês não escorrega no ciclo')
  eq(proxima('2026-11-30', 3), '2027-02-28', 'e continua ancorado no fim do mês')

  // Um ciclo completo de dois anos com refil trimestral não acumula desvio.
  let d = '2026-01-31'
  const datas = []
  for (let i = 0; i < 4; i++) { d = somarMeses(d, 3); datas.push(d) }
  eq(datas, ['2026-04-30', '2026-07-30', '2026-10-30', '2027-01-30'], 'ciclos sucessivos são estáveis')
}

console.log(falhas ? `\n${falhas} verificação(ões) falharam.` : '\nTudo certo.')
process.exit(falhas ? 1 : 0)
