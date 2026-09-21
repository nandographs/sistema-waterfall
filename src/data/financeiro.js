// Regras de dinheiro do sistema, isoladas de banco e de tela.
//
// Ficam aqui as contas que precisam estar certas ao centavo: soma de itens,
// divisão em parcelas e cálculo de vencimentos. Depende apenas de lib/datas.js
// (que também é JavaScript puro), para poderem ser testadas direto no Node
// (ver scripts/testar-financeiro.mjs).

import { hojeISO, mesDe } from '../lib/datas.js'

// Reexportados: metade do sistema importa `hojeISO`/`mesDe` do repositório, que
// por sua vez importa daqui. A implementação vive em lib/datas.js porque é
// aritmética de calendário, não de dinheiro.
export { hojeISO, mesDe }

// Soma meses a uma data ISO sem o overflow do Date.setMonth: 31/01 + 1 mês vira
// 28/02 (e não 03/03, como o JS faria sozinho).
export function somarMeses(iso, meses) {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const alvo = new Date(y, m - 1 + Number(meses || 0), 1)
  const ultimoDia = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate()
  alvo.setDate(Math.min(d, ultimoDia))
  const p = (n) => String(n).padStart(2, '0')
  return `${alvo.getFullYear()}-${p(alvo.getMonth() + 1)}-${p(alvo.getDate())}`
}

// Divide um valor em N parcelas SEM perder centavos: o resto da divisão é
// distribuído um centavo por vez nas primeiras parcelas, então a soma das
// parcelas bate exatamente com o total.
export function dividirCentavos(totalCentavos, n) {
  const base = Math.floor(totalCentavos / n)
  const sobra = totalCentavos - base * n
  return Array.from({ length: n }, (_, i) => base + (i < sobra ? 1 : 0))
}

// Soma dos itens: cada linha é quantidade × valor unitário − desconto da linha.
export function totaisDaVenda(itens, descontoGeral = 0, frete = 0) {
  const subtotal = (itens || []).reduce((soma, item) => {
    const bruto = Number(item.quantidade || 0) * Number(item.valorUnitario || 0)
    return soma + Math.max(0, bruto - Number(item.desconto || 0))
  }, 0)
  const total = Math.max(0, subtotal - Number(descontoGeral || 0) + Number(frete || 0))
  return { subtotal, total }
}

// Dinheiro na forma como o Brasil escreve. Mora aqui, e não no repositório,
// porque o relatório em PDF precisa dela e não deve arrastar a camada de banco
// junto — este arquivo é JavaScript puro, sem React e sem Supabase.
export function formatBRL(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// ---------------------------------------------------------------- relatório

// O mês vizinho a um mês 'AAAA-MM' (o `mesDe` vem de lib/datas.js, acima).
export const somarMesesNoMes = (mes, n) => somarMeses(`${mes}-01`, n).slice(0, 7)

const somar = (lista) => lista.reduce((s, l) => s + Number(l.valor || 0), 0)

// Agrupa por categoria e ordena do maior para o menor.
function porCategoria(lista) {
  const mapa = new Map()
  for (const l of lista) {
    const chave = l.categoria || 'outros'
    mapa.set(chave, (mapa.get(chave) || 0) + Number(l.valor || 0))
  }
  return [...mapa.entries()]
    .map(([categoria, total]) => ({ categoria, total }))
    .sort((a, b) => b.total - a.total)
}

// Fechamento de um mês ('AAAA-MM').
//
// Dois critérios diferentes, de propósito — misturá-los faria o relatório mentir:
//   REALIZADO  o dinheiro que de fato se moveu no mês (pela data de pagamento).
//   PREVISTO   o que ainda vence dentro do mês e não foi quitado (pelo vencimento).
//
// `resultado` é o do caixa de verdade (realizado); `projetado` é como o mês
// termina se tudo que está previsto se confirmar.
export function resumoDoMes(lista, mes) {
  return resumoDoPeriodo(lista, { de: `${mes}-01`, ate: `${mes}-31` })
}

// O mesmo fechamento, para um intervalo qualquer — é o que permite o relatório
// ser semanal, mensal ou anual sem três funções quase iguais. `resumoDoMes`
// virou um atalho para o mês, e continua sendo o que o Dashboard chama.
//
// O intervalo é INCLUSIVO nas duas pontas e comparado como texto ISO. Por isso
// `${mes}-31` funciona como fim de mês mesmo em fevereiro: nenhuma data real do
// mês é maior que isso na ordem alfabética.
export function resumoDoPeriodo(lista, { de, ate } = {}) {
  const dentro = (iso) => {
    const dia = String(iso || '').slice(0, 10)
    return !!dia && dia >= de && dia <= ate
  }

  // O ajuste de saldo não é movimento do negócio (ver CATEGORIA_AJUSTE).
  const doNegocio = (lista || []).filter((l) => !ehAjuste(l))
  const realizados = doNegocio.filter((l) => l.status === 'realizado' && dentro(l.dataPagamento))
  const previstos = doNegocio.filter((l) => l.status === 'previsto' && dentro(l.vencimento))

  const doTipo = (arr, tipo) => arr.filter((l) => l.tipo === tipo)
  const entradasR = doTipo(realizados, 'entrada')
  const entradasP = doTipo(previstos, 'entrada')
  const saidasR = doTipo(realizados, 'saida')
  const saidasP = doTipo(previstos, 'saida')

  const entradas = { realizado: somar(entradasR), previsto: somar(entradasP), quantidade: entradasR.length }
  const saidas = { realizado: somar(saidasR), previsto: somar(saidasP), quantidade: saidasR.length }

  // Ordena por data para o relatório imprimir na ordem em que aconteceu.
  const porData = (campo) => (a, b) =>
    String(a[campo] || '').localeCompare(String(b[campo] || ''))

  return {
    de,
    ate,
    entradas,
    saidas,
    resultado: entradas.realizado - saidas.realizado,
    projetado: (entradas.realizado + entradas.previsto) - (saidas.realizado + saidas.previsto),
    categorias: {
      entradas: porCategoria(entradasR),
      saidas: porCategoria(saidasR),
    },
    // As linhas que compõem os números acima. A tela não usa; o PDF lista, e é
    // o que separa um relatório de um cartão de totais — sem elas não dá para
    // conferir de onde veio o resultado.
    movimentos: {
      realizados: [...realizados].sort(porData('dataPagamento')),
      previstos: [...previstos].sort(porData('vencimento')),
    },
  }
}

// ---------------------------------------------------------------- ajuste
//
// "Ajuste de saldo" é o lançamento que acerta o caixa com o extrato do banco
// (dinheiro que entrou ou saiu e nunca foi lançado, taxa esquecida…). Ele MEXE
// no saldo, mas não é faturamento nem despesa: fica fora de "entrou", "saiu",
// do resultado e do relatório por categoria — senão um acerto de R$ 25 mil
// apareceria como o maior gasto do mês.
export const CATEGORIA_AJUSTE = 'ajuste'
export const ehAjuste = (l) => l?.categoria === CATEGORIA_AJUSTE

// ---------------------------------------------------------------- painel
//
// Tudo o que a tela do Financeiro mostra sai de UMA regra só, para os números
// sempre fecharem entre si:
//
//   o saldo num dia D é
//     D até hoje   →  o que de fato entrou menos o que saiu até D (pela baixa);
//     D no futuro  →  o saldo de hoje + o que está em aberto e vence até D.
//
// Em aberto e vencido conta como "hoje" na projeção: é dinheiro que ainda vai
// entrar ou sair, não some só porque passou da data.

const sinal = (l) => (l.tipo === 'saida' ? -1 : 1)
const centavosDoLancamento = (l) => Math.round(Number(l.valor || 0) * 100)
const diaDe = (iso) => String(iso || '').slice(0, 10)

// Saldo (em reais) em um dia qualquer, pela regra acima.
export function saldoEm(lista, dia, hoje = hojeISO()) {
  const alvo = diaDe(dia)
  // Até onde vale o dinheiro que de fato se moveu: o próprio dia, ou hoje se
  // o dia ainda não chegou (baixa com data futura não conta antes da hora).
  const limiteReal = alvo < hoje ? alvo : hoje
  let centavos = 0
  for (const l of lista || []) {
    if (l.status === 'realizado') {
      const pago = diaDe(l.dataPagamento)
      if (pago && pago <= limiteReal) centavos += sinal(l) * centavosDoLancamento(l)
    } else if (alvo > hoje && diaDe(l.vencimento) <= alvo) {
      centavos += sinal(l) * centavosDoLancamento(l)
    }
  }
  return centavos / 100
}

// Os dias (ou fins de mês, no ano) em que o gráfico do saldo marca um ponto.
function pontosDoPeriodo({ de, ate }) {
  const pontos = []
  const [ya, ma] = de.split('-').map(Number)
  const [yb, mb] = ate.split('-').map(Number)
  const meses = (yb - ya) * 12 + (mb - ma)
  if (meses >= 2) {
    // Período longo (o ano): um ponto por fim de mês.
    for (let i = 0; i <= meses; i++) {
      const inicio = somarMeses(`${de.slice(0, 7)}-01`, i)
      const [y, m] = inicio.split('-').map(Number)
      const fim = `${inicio.slice(0, 8)}${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
      pontos.push(fim > ate ? ate : fim)
    }
    return pontos
  }
  for (let d = de; d <= ate; d = somarUmDia(d)) pontos.push(d)
  return pontos
}

function somarUmDia(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d + 1)
  const p = (n) => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`
}

// A linha do gráfico de saldo de um período. `previsto` marca os pontos depois
// de hoje — a tela desenha esse trecho tracejado.
export function serieDoSaldo(lista, periodo, hoje = hojeISO()) {
  return pontosDoPeriodo(periodo).map((dia) => ({
    dia,
    saldo: saldoEm(lista, dia, hoje),
    previsto: dia > hoje,
  }))
}

// Os lançamentos que pertencem a um período, do jeito que o extrato mostra:
// o que foi pago, pela data do pagamento; o que está em aberto, pelo vencimento.
//
// Quando o período inclui hoje, o que está em aberto e VENCIDO de antes também
// entra — continua sendo conta do agora, e é o que faz "a receber" e "a pagar"
// do painel fecharem com o saldo previsto.
export function movimentosDoPeriodo(lista, { de, ate }, hoje = hojeISO()) {
  const emCurso = de <= hoje && hoje <= ate
  return (lista || []).filter((l) => {
    if (l.status === 'realizado') {
      const dia = diaDe(l.dataPagamento)
      return !!dia && dia >= de && dia <= ate
    }
    const venc = diaDe(l.vencimento)
    if (venc >= de && venc <= ate) return true
    return emCurso && venc < de
  })
}

// Os números do topo do Financeiro para um período.
//
//   emCaixa      o saldo de hoje (não depende do período)
//   entrou/saiu  o que de fato se moveu no período
//   aReceber/aPagar  o que está em aberto no período (e o vencido, se é o atual)
//   saldoFinal   o saldo no último dia do período — real se já passou,
//                previsto se ainda vai chegar
//
// No período atual vale sempre: emCaixa + aReceber − aPagar = saldoFinal.
export function painelDoPeriodo(lista, periodo, hoje = hojeISO()) {
  const movs = movimentosDoPeriodo(lista, periodo, hoje)
  // Ajuste mexe no caixa (emCaixa, saldoFinal) mas não é entrada nem saída.
  const soma = (tipo, status) => movs
    .filter((l) => l.tipo === tipo && l.status === status && !ehAjuste(l))
    .reduce((s, l) => s + centavosDoLancamento(l), 0) / 100
  const atrasados = movs.filter((l) => l.status === 'previsto' && diaDe(l.vencimento) < hoje)

  return {
    emCaixa: saldoEm(lista, hoje, hoje),
    entrou: soma('entrada', 'realizado'),
    saiu: soma('saida', 'realizado'),
    aReceber: soma('entrada', 'previsto'),
    aPagar: soma('saida', 'previsto'),
    saldoFinal: saldoEm(lista, periodo.ate, hoje),
    finalPrevisto: periodo.ate > hoje,
    // Quanto do "a pagar" é salário ainda não lançado (ver folhaPrevista).
    folhaPrevista: movs.filter((l) => l.previsaoDaFolha)
      .reduce((s, l) => s + centavosDoLancamento(l), 0) / 100,
    ajustes: movs.filter((l) => ehAjuste(l) && l.status === 'realizado')
      .reduce((s, l) => s + sinal(l) * centavosDoLancamento(l), 0) / 100,
    atrasados: atrasados.length,
  }
}

// Fluxo de caixa dos próximos meses, a partir do mês de `hoje`.
//
// Parte do saldo de hoje e soma só o que está EM ABERTO — o que já foi pago já
// está no saldo. O vencido fica no primeiro mês, para não sumir da projeção.
export function fluxoDosMeses(lista, hoje = hojeISO(), quantos = 6) {
  const primeiro = hoje.slice(0, 7)
  const abertos = (lista || []).filter((l) => l.status === 'previsto')
  let acumulado = Math.round(saldoEm(lista, hoje, hoje) * 100)

  return Array.from({ length: quantos }, (_, i) => {
    const mes = somarMesesNoMes(primeiro, i)
    let entra = 0
    let sai = 0
    let folha = 0 // salário ainda não lançado (folhaPrevista), à parte das saídas
    for (const l of abertos) {
      const venc = String(l.vencimento || '').slice(0, 7)
      if (i === 0 ? venc > mes : venc !== mes) continue
      if (l.previsaoDaFolha) folha += centavosDoLancamento(l)
      else if (l.tipo === 'saida') sai += centavosDoLancamento(l)
      else entra += centavosDoLancamento(l)
    }
    acumulado += entra - sai - folha
    return {
      mes,
      entra: entra / 100,
      sai: sai / 100,
      folha: folha / 100,
      resultado: (entra - sai - folha) / 100,
      acumulado: acumulado / 100,
    }
  })
}

// Variação percentual de um mês para o outro. Sem base anterior não existe
// percentual — devolve null, para a tela mostrar "—" em vez de um "+100%" falso.
export function variacao(atual, anterior) {
  const a = Number(anterior || 0)
  if (a === 0) return null
  return ((Number(atual || 0) - a) / Math.abs(a)) * 100
}

// ------------------------------------------------------------- formas de pagamento

// O vocabulário do dinheiro. Mora aqui, e não no repositório, porque o plano de
// parcelas precisa do rótulo para nomear os lançamentos — e o repositório
// importa daqui, nunca o contrário. O repositório reexporta para as telas.
export const FORMAS_PAGAMENTO = {
  dinheiro: 'Dinheiro',
  pix: 'Pix',
  cartao: 'Cartão',
  boleto: 'Boleto',
}

// ---------------------------------------------------------------- pagamentos
//
// Uma venda pode ser paga de VÁRIAS formas ao mesmo tempo: R$ 500 de entrada em
// dinheiro, mais R$ 2.500 em 3x no cartão. Cada uma dessas é um PAGAMENTO:
//
//   { forma, valor, parcelas, primeiroVencimento, entrada }
//
// `entrada: true` é só um pagamento com um papel especial — é o dinheiro da
// hora, então vence na data da venda e não se parcela. Não é um campo separado
// da venda porque não é uma coisa diferente: é a primeira forma de pagamento,
// e tratá-la como tal é o que faz "entrada no dinheiro + resto no cartão"
// funcionar sem nenhum caso especial abaixo desta linha.
//
// A venda continua guardando `formaPagamento`/`condicao`/`entrada`/`parcelas`
// como RESUMO (ver resumoDosPagamentos): é o que o Pedido em DOCX/PDF sabe ler,
// e é o que mantém funcionando tudo que foi escrito antes desta lista existir.

// Descarta linha sem valor e normaliza os tipos. Tudo daqui para baixo assume
// que passou por aqui.
export function normalizarPagamentos(pagamentos) {
  return (Array.isArray(pagamentos) ? pagamentos : [])
    .map((p) => ({
      forma: p.forma || 'pix',
      valor: Number(p.valor || 0),
      // Entrada não parcela: é o que se paga na hora, por definição.
      parcelas: p.entrada ? 1 : Math.max(1, Number(p.parcelas || 1)),
      primeiroVencimento: p.primeiroVencimento || '',
      entrada: !!p.entrada,
      // Taxa da maquininha (%), só no cartão. A chave só existe quando há taxa,
      // para uma forma sem taxa continuar exatamente como era gravada antes.
      ...(taxaDe(p) > 0 ? { taxa: taxaDe(p) } : {}),
      // Cartão parcelado ANTECIPADO: a operadora paga tudo de uma vez. Mesma
      // regra da taxa — a chave só existe quando vale, para o que já estava
      // gravado continuar idêntico.
      ...(antecipado(p) ? { antecipado: true } : {}),
    }))
    .filter((p) => p.valor > 0)
}

// Antecipação só existe no cartão parcelado: à vista já cai de uma vez, e Pix
// ou boleto não têm operadora para antecipar.
export const antecipado = (p) =>
  !!p?.antecipado && p?.forma === 'cartao' && !p?.entrada && Math.max(1, Number(p?.parcelas || 1)) > 1

// A taxa (%) que a operadora cobra sobre um pagamento. Só cartão tem taxa:
// trocar a forma para Pix não pode deixar uma taxa esquecida para trás.
export function taxaDe(p) {
  if (p?.forma !== 'cartao') return 0
  const t = Number(String(p?.taxa ?? '').replace(',', '.'))
  return Number.isFinite(t) ? Math.min(100, Math.max(0, t)) : 0
}


// Quanto as taxas de cartão de um plano custam, em reais — a tela mostra antes
// de salvar, para ninguém descobrir a despesa só no fechamento. Soma parcela a
// parcela, igual ao plano, para os dois números nunca discordarem no centavo.
export function totalDasTaxas(pagamentos) {
  const centavos = normalizarPagamentos(pagamentos).reduce(
    // Antecipado: um repasse só, e a taxa é sobre ele inteiro — igual ao plano.
    (soma, p) => soma + dividirCentavos(Math.round(p.valor * 100), p.antecipado ? 1 : p.parcelas)
      .reduce((s, c) => s + Math.round((c * taxaDe(p)) / 100), 0),
    0,
  )
  return centavos / 100
}

// Quanto falta distribuir entre as formas, EM CENTAVOS. Positivo = falta;
// negativo = passou do total; zero = fecha.
//
// Em centavos e não em reais porque 0,1 + 0,2 não dá 0,3 em ponto flutuante, e
// uma venda que "não fecha por R$ 0,00000000004" seria impossível de salvar.
export function diferencaDosPagamentos(total, pagamentos) {
  const totalCent = Math.round(Number(total || 0) * 100)
  const somaCent = normalizarPagamentos(pagamentos)
    .reduce((soma, p) => soma + Math.round(p.valor * 100), 0)
  return totalCent - somaCent
}

// Uma linha com o valor EM BRANCO quer dizer "o que sobrar do total".
//
// É o que mantém o caso mais comum sem digitação nenhuma: uma forma só, a venda
// inteira — exatamente como era antes desta lista existir. Também é o que faz
// "entrada de 500" preencher o cartão com o resto sozinho.
//
// Com duas linhas em branco não há o que resolver (o restante caberia nas duas),
// então a lista volta como veio e a conferência de soma reclama — que é o certo:
// adivinhar aí seria inventar dinheiro.
//
// UMA FORMA SÓ (sem entrada) é sempre a venda inteira, seja qual for o valor
// que ficou digitado nela. Não existe outra resposta certa — menos travaria a
// venda com "falta distribuir", mais com "passou do total" — e um valor velho
// (digitado antes de mudar os itens, ou o líquido depois da taxa do cartão)
// era exatamente o que impedia de salvar.
export function resolverPagamentos(pagamentos, total) {
  const lista = Array.isArray(pagamentos) ? pagamentos : []
  if (lista.length === 1 && !lista[0]?.entrada) {
    return [{ ...lista[0], valor: Math.round(Number(total || 0) * 100) / 100 }]
  }
  const emBranco = (p) => String(p?.valor ?? '').trim() === ''
  if (lista.filter(emBranco).length !== 1) return lista

  const somaCent = lista
    .filter((p) => !emBranco(p))
    .reduce((soma, p) => soma + Math.round(Number(p.valor || 0) * 100), 0)
  const restanteCent = Math.max(0, Math.round(Number(total || 0) * 100) - somaCent)

  return lista.map((p) => (emBranco(p) ? { ...p, valor: restanteCent / 100 } : p))
}

// A condição de pagamento antiga (uma forma só) vista como lista de pagamentos.
//
// É o que permite existir UM caminho só daqui para baixo: quem não conhece a
// lista — a venda gravada antes desta mudança, o agendamento, a proposta criada
// pelo funil — é convertido aqui e segue pelo mesmo lugar que todo o resto.
export function pagamentosDaCondicao({
  total, formaPagamento, condicao, entrada = 0, parcelas = 1, primeiroVencimento, taxa = 0,
}) {
  const totalCent = Math.round(Number(total || 0) * 100)
  if (totalCent <= 0) return []

  const forma = formaPagamento || 'pix'
  // Entrada maior que o total vira pagamento único: não se deve o que já pagou.
  const entradaCent = Math.min(Math.max(Math.round(Number(entrada || 0) * 100), 0), totalCent)
  const lista = []

  if (entradaCent > 0) {
    lista.push({
      forma, valor: entradaCent / 100, parcelas: 1, primeiroVencimento: '', entrada: true,
      ...(taxaDe({ forma, taxa }) > 0 ? { taxa: taxaDe({ forma, taxa }) } : {}),
    })
  }

  const restanteCent = totalCent - entradaCent
  if (restanteCent > 0) {
    lista.push({
      forma,
      valor: restanteCent / 100,
      parcelas: condicao === 'parcelado' ? Math.max(1, Number(parcelas || 1)) : 1,
      primeiroVencimento: primeiroVencimento || '',
      entrada: false,
      ...(taxaDe({ forma, taxa }) > 0 ? { taxa: taxaDe({ forma, taxa }) } : {}),
    })
  }

  return lista
}

// Monta os lançamentos a receber de uma cobrança paga em uma ou mais formas.
//
// Cada pagamento gera as SUAS parcelas, com a SUA forma e o SEU vencimento —
// é isso que faz o caixa saber que R$ 500 entraram em dinheiro hoje e R$ 2.500
// entram no cartão em três vezes, em vez de somar tudo num borrão só.
//
// `parcela`/`parcelas` no lançamento continuam sendo a posição no plano INTEIRO
// (1..N de N), e não dentro da forma: é por essa ordem que sincronizarLancamentos
// casa o plano novo com o antigo para preservar as baixas já dadas.
export function planoDePagamentos({
  descricao, clienteId, pagamentos, data,
  origem = 'venda', categoria = 'venda',
}) {
  const lista = normalizarPagamentos(pagamentos)
  if (!lista.length) return []

  // O rótulo da forma só entra quando as formas de fato DIFEREM. Numa venda
  // paga só no cartão, "(1/3 · Cartão)" repete em toda parcela o que o cabeçalho
  // já diz — e uma entrada no dinheiro seguida do resto no dinheiro também não
  // precisa ser desambiguada.
  const rotularForma = new Set(lista.map((p) => p.forma)).size > 1

  const linhas = []
  for (const pg of lista) {
    const inicio = pg.primeiroVencimento || data
    // Antecipado vira UM recebimento: o valor inteiro, numa data só. Doze
    // linhas "recebidas" com vencimentos até o ano que vem era o que tornava o
    // caixa impossível de conferir com o extrato.
    if (pg.antecipado) {
      const rotulo = rotularForma ? (FORMAS_PAGAMENTO[pg.forma] ?? pg.forma) : ''
      linhas.push({
        sufixo: `(${[`${pg.parcelas}x antecipado`, rotulo].filter(Boolean).join(' · ')})`,
        centavos: Math.round(pg.valor * 100),
        vencimento: inicio || '',
        forma: pg.forma,
        taxa: taxaDe(pg),
      })
      continue
    }
    dividirCentavos(Math.round(pg.valor * 100), pg.parcelas).forEach((centavos, i) => {
      const marca = pg.entrada ? 'entrada' : (pg.parcelas > 1 ? `${i + 1}/${pg.parcelas}` : '')
      const rotulo = rotularForma ? (FORMAS_PAGAMENTO[pg.forma] ?? pg.forma) : ''
      const partes = [marca, rotulo].filter(Boolean)
      linhas.push({
        sufixo: partes.length ? `(${partes.join(' · ')})` : '',
        centavos,
        // A entrada vence na data da venda: é o dinheiro que já está na mão.
        vencimento: pg.entrada
          ? (pg.primeiroVencimento || data || '')
          : (inicio ? somarMeses(inicio, i) : ''),
        forma: pg.forma,
        taxa: taxaDe(pg),
      })
    })
  }

  // A TAXA DO CARTÃO sai da própria parcela: o que entra no caixa é o LÍQUIDO,
  // o que a operadora de fato repassa. A descrição guarda o bruto e a taxa, para
  // dar para conferir com o extrato da maquininha. O arredondamento é por
  // parcela, igual à operadora, e totalDasTaxas soma do mesmo jeito.
  return linhas.map((linha, i) => {
    const taxaCent = linha.taxa > 0 ? Math.round((linha.centavos * linha.taxa) / 100) : 0
    const nota = taxaCent > 0
      ? `· líquido (${formatBRL(linha.centavos / 100)} − ${String(linha.taxa).replace('.', ',')}% de taxa)`
      : ''
    return {
      tipo: 'entrada',
      status: 'previsto',
      descricao: [descricao, linha.sufixo, nota].filter(Boolean).join(' '),
      categoria,
      valor: (linha.centavos - taxaCent) / 100,
      vencimento: linha.vencimento || '',
      dataPagamento: '',
      formaPagamento: linha.forma,
      parcela: i + 1,
      parcelas: linhas.length,
      origem,
      clienteId: clienteId || '',
    }
  })
}

// O resumo de uma linha só de um plano com várias formas.
//
// Existe porque metade do sistema foi escrita quando a venda tinha UMA forma: a
// coluna `forma_pagamento`, o campo "Forma:" do Pedido em DOCX, o agendamento
// gerado pela venda. Em vez de sair mexendo em tudo isso, a venda continua
// guardando o resumo — derivado da lista, e não digitado à parte, para os dois
// nunca discordarem.
//
// A forma PRINCIPAL é a de maior valor entre as que não são entrada: é a que o
// cliente lembra como "paguei no cartão". Se só houve entrada, é a dela.
export function resumoDosPagamentos(pagamentos, data) {
  const lista = normalizarPagamentos(pagamentos)
  if (!lista.length) return null

  const entradas = lista.filter((p) => p.entrada)
  const financiados = lista.filter((p) => !p.entrada)
  const base = financiados.length ? financiados : entradas
  const principal = [...base].sort((a, b) => b.valor - a.valor)[0]
  const maiorParcelamento = Math.max(1, ...financiados.map((p) => p.parcelas))
  const vencimentos = financiados.map((p) => p.primeiroVencimento).filter(Boolean).sort()

  return {
    formaPagamento: principal.forma,
    condicao: maiorParcelamento > 1 ? 'parcelado' : 'a_vista',
    entrada: entradas.reduce((soma, p) => soma + p.valor, 0),
    parcelas: maiorParcelamento,
    primeiroVencimento: vencimentos[0] || data || '',
  }
}

// A cobrança de uma forma só — o formato antigo, mantido porque o agendamento
// avulso continua sendo assim (um valor, uma forma) e não há motivo para ele
// carregar uma lista de um item.
export function planoDeParcelas({
  descricao, clienteId, total, entrada = 0, parcelas = 1,
  primeiroVencimento, data, formaPagamento, origem = 'venda', categoria = 'venda', taxa = 0,
}) {
  return planoDePagamentos({
    descricao,
    clienteId,
    data,
    origem,
    categoria,
    pagamentos: pagamentosDaCondicao({
      total,
      formaPagamento,
      condicao: Number(parcelas || 1) > 1 ? 'parcelado' : 'a_vista',
      entrada,
      parcelas,
      primeiroVencimento,
      taxa,
    }),
  })
}

// ------------------------------------------------------------- conta salário
//
// A "conta salário" de um funcionário NÃO é uma tabela nem um saldo guardado:
// é uma leitura dos lançamentos que já existem no caixa. Guardar o saldo à
// parte criaria duas versões da verdade que discordariam no primeiro estorno.
//
// A conta é sempre a mesma:
//
//     salário do mês  −  vales  −  o que já foi lançado de salário  =  saldo
//
// Um VALE é uma conta a pagar como qualquer outra (sai do caixa de verdade, no
// dia em que sai), com uma diferença: ele é abatido do salário daquele mês, em
// vez de ser uma despesa nova. É por isso que ele tem categoria própria — sem
// ela, adiantar R$ 300 e depois pagar o salário cheio contaria a despesa duas
// vezes no relatório.

export const CATEGORIA_SALARIO = 'salario'
export const CATEGORIA_VALE = 'vale'

// As saídas que saem do salário de alguém. Serve de teste em um lugar só para
// "esta linha pertence à folha?".
export const CATEGORIAS_DA_FOLHA = [CATEGORIA_SALARIO, CATEGORIA_VALE]
export const daFolha = (categoria) => CATEGORIAS_DA_FOLHA.includes(categoria)

// A folha ('AAAA-MM') a que um lançamento pertence.
//
// A competência é gravada no lançamento, mas cai para o mês do vencimento
// quando está vazia — é o que faz todo lançamento anterior a esta função (e
// todo lançamento em que o usuário não mexeu no campo) já nascer classificado,
// sem migração de dados.
export const competenciaDe = (l) =>
  String(l?.competencia || l?.vencimento || '').slice(0, 7)

// Dinheiro sempre em centavos inteiros antes de virar reais: sem isso um saldo
// de 2000 − 3×166,66 aparece como 0.020000000000436557 na tela.
const emReais = (centavos) => centavos / 100
const centavosDe = (lista) =>
  lista.reduce((soma, l) => soma + Math.round(Number(l.valor || 0) * 100), 0)

// O fechamento da folha de UM funcionário em UMA competência.
//
//   salario   o quanto ele ganha (o cadastro do funcionário, não os lançamentos)
//   vales     adiantamentos já lançados na competência
//   folha     o que já foi lançado como pagamento do salário em si
//   saldo     o que ainda falta lançar para fechar o mês dele
//   pago      do que foi lançado, quanto já saiu do caixa (baixa dada)
//   aPagar    o que está lançado e ainda não foi pago
//
// `saldo` pode ficar NEGATIVO de propósito: adiantar mais do que o salário é um
// erro que a tela precisa poder mostrar, não um número para esconder no zero.
export function contaSalario(funcionario, lista, competencia) {
  const doFuncionario = (lista || []).filter(
    (l) =>
      l.funcionarioId === funcionario?.id &&
      l.tipo === 'saida' &&
      daFolha(l.categoria) &&
      competenciaDe(l) === competencia,
  )

  const vales = doFuncionario.filter((l) => l.categoria === CATEGORIA_VALE)
  const salarios = doFuncionario.filter((l) => l.categoria === CATEGORIA_SALARIO)

  const salarioCent = Math.round(Number(funcionario?.salario || 0) * 100)
  const valesCent = centavosDe(vales)
  const folhaCent = centavosDe(salarios)

  const realizados = doFuncionario.filter((l) => l.status === 'realizado')
  const previstos = doFuncionario.filter((l) => l.status !== 'realizado')

  return {
    funcionarioId: funcionario?.id || '',
    competencia,
    salario: emReais(salarioCent),
    vales: emReais(valesCent),
    quantidadeVales: vales.length,
    folha: emReais(folhaCent),
    lancado: emReais(valesCent + folhaCent),
    saldo: emReais(salarioCent - valesCent - folhaCent),
    pago: emReais(centavosDe(realizados)),
    aPagar: emReais(centavosDe(previstos)),
    // As linhas por trás dos números — a tela lista, e é o que permite conferir
    // de onde veio o saldo sem ter que caçar na aba de contas a pagar.
    lancamentos: [...doFuncionario].sort((a, b) =>
      String(a.vencimento || '').localeCompare(String(b.vencimento || '')),
    ),
  }
}

// A folha inteira de um mês: uma conta por funcionário, mais os totais.
//
// Recebe a lista de funcionários já filtrada (a tela decide se mostra os
// desligados), para não ter duas regras de "quem está na folha" no sistema.
export function folhaDoMes(listaFuncionarios, lista, competencia) {
  const contas = (listaFuncionarios || []).map((f) => ({
    funcionario: f,
    ...contaSalario(f, lista, competencia),
  }))
  const somar = (campo) =>
    emReais(contas.reduce((soma, c) => soma + Math.round(c[campo] * 100), 0))

  return {
    competencia,
    contas,
    total: {
      salario: somar('salario'),
      vales: somar('vales'),
      folha: somar('folha'),
      lancado: somar('lancado'),
      saldo: somar('saldo'),
      pago: somar('pago'),
      aPagar: somar('aPagar'),
    },
  }
}

// O dia em que o salário de uma competência vence: o dia combinado com o
// funcionário, no mês SEGUINTE (setembro se paga em outubro). Dia 31 num mês
// de 30 cai no último dia — "2026-11-31" não é data.
export function vencimentoDoSalario(funcionario, competencia) {
  const mes = somarMesesNoMes(competencia, 1)
  const [y, m] = mes.split('-').map(Number)
  const ultimo = new Date(y, m, 0).getDate()
  const dia = Math.min(ultimo, Math.max(1, Number(funcionario?.diaPagamento || 5)))
  return `${mes}-${String(dia).padStart(2, '0')}`
}

// ------------------------------------------------------------- folha prevista
//
// O salário que AINDA NÃO FOI LANÇADO também é dinheiro que vai sair. Sem ele
// a projeção do caixa sai otimista em uma folha inteira por mês.
//
// Não vira lançamento no banco: é calculado na hora, a partir do cadastro, e
// devolvido no MESMO formato de um lançamento em aberto (marcado com
// `previsaoDaFolha`) — assim o fluxo, o gráfico e o saldo previsto o somam
// sem nenhuma regra especial. O valor é o que falta de cada um (salário −
// vales − salário já lançado, ver contaSalario): lançou o salário de verdade,
// a previsão some na mesma medida, e nada conta duas vezes.
//
// Começa na competência de `hoje`. As anteriores ficam de fora de propósito:
// o sistema não sabe o que foi pago antes de existir, e prever esses meses
// inventaria uma dívida.
export function folhaPrevista(listaFuncionarios, lista, { hoje = hojeISO(), ate } = {}) {
  const ativos = (listaFuncionarios || []).filter((f) => f.ativo !== false && Number(f.salario) > 0)
  const limite = String(ate || hoje).slice(0, 10)
  const linhas = []
  for (let comp = hoje.slice(0, 7); ; comp = somarMesesNoMes(comp, 1)) {
    let algumNoPrazo = false
    for (const f of ativos) {
      const vencimento = vencimentoDoSalario(f, comp)
      if (vencimento > limite) continue
      algumNoPrazo = true
      const falta = Math.round(contaSalario(f, lista, comp).saldo * 100)
      if (falta <= 0) continue
      linhas.push({
        id: `folha-${f.id}-${comp}`,
        tipo: 'saida',
        status: 'previsto',
        categoria: CATEGORIA_SALARIO,
        descricao: `Salário ${comp} — ${f.nome} (previsto)`,
        valor: falta / 100,
        vencimento,
        dataPagamento: '',
        funcionarioId: f.id,
        competencia: comp,
        previsaoDaFolha: true,
      })
    }
    // Para quando nenhuma folha desta competência vence mais dentro do prazo.
    if (!algumNoPrazo) break
  }
  return linhas
}
