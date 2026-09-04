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

  const realizados = (lista || []).filter((l) => l.status === 'realizado' && dentro(l.dataPagamento))
  const previstos = (lista || []).filter((l) => l.status === 'previsto' && dentro(l.vencimento))

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
    }))
    .filter((p) => p.valor > 0)
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
export function resolverPagamentos(pagamentos, total) {
  const lista = Array.isArray(pagamentos) ? pagamentos : []
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
  total, formaPagamento, condicao, entrada = 0, parcelas = 1, primeiroVencimento,
}) {
  const totalCent = Math.round(Number(total || 0) * 100)
  if (totalCent <= 0) return []

  const forma = formaPagamento || 'pix'
  // Entrada maior que o total vira pagamento único: não se deve o que já pagou.
  const entradaCent = Math.min(Math.max(Math.round(Number(entrada || 0) * 100), 0), totalCent)
  const lista = []

  if (entradaCent > 0) {
    lista.push({ forma, valor: entradaCent / 100, parcelas: 1, primeiroVencimento: '', entrada: true })
  }

  const restanteCent = totalCent - entradaCent
  if (restanteCent > 0) {
    lista.push({
      forma,
      valor: restanteCent / 100,
      parcelas: condicao === 'parcelado' ? Math.max(1, Number(parcelas || 1)) : 1,
      primeiroVencimento: primeiroVencimento || '',
      entrada: false,
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
      })
    })
  }

  return linhas.map((linha, i) => ({
    tipo: 'entrada',
    status: 'previsto',
    descricao: [descricao, linha.sufixo].filter(Boolean).join(' '),
    categoria,
    valor: linha.centavos / 100,
    vencimento: linha.vencimento || '',
    dataPagamento: '',
    formaPagamento: linha.forma,
    parcela: i + 1,
    parcelas: linhas.length,
    origem,
    clienteId: clienteId || '',
  }))
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
  primeiroVencimento, data, formaPagamento, origem = 'venda', categoria = 'venda',
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
    }),
  })
}
