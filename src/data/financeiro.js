// Regras de dinheiro do sistema, isoladas de banco e de tela.
//
// Ficam aqui as contas que precisam estar certas ao centavo: soma de itens,
// divisão em parcelas e cálculo de vencimentos. Sem dependências, para poderem
// ser testadas direto no Node (ver scripts/testar-financeiro.mjs).

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

export const hojeISO = () => new Date().toISOString().slice(0, 10)

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

// ---------------------------------------------------------------- relatório

// Mês de uma data ISO ('2026-07-25' -> '2026-07') e o mês vizinho.
export const mesDe = (iso) => String(iso || '').slice(0, 7)
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
  const noMes = (iso) => String(iso || '').startsWith(mes)

  const realizados = (lista || []).filter((l) => l.status === 'realizado' && noMes(l.dataPagamento))
  const previstos = (lista || []).filter((l) => l.status === 'previsto' && noMes(l.vencimento))

  const doTipo = (arr, tipo) => arr.filter((l) => l.tipo === tipo)
  const entradasR = doTipo(realizados, 'entrada')
  const entradasP = doTipo(previstos, 'entrada')
  const saidasR = doTipo(realizados, 'saida')
  const saidasP = doTipo(previstos, 'saida')

  const entradas = { realizado: somar(entradasR), previsto: somar(entradasP), quantidade: entradasR.length }
  const saidas = { realizado: somar(saidasR), previsto: somar(saidasP), quantidade: saidasR.length }

  return {
    mes,
    entradas,
    saidas,
    resultado: entradas.realizado - saidas.realizado,
    projetado: (entradas.realizado + entradas.previsto) - (saidas.realizado + saidas.previsto),
    categorias: {
      entradas: porCategoria(entradasR),
      saidas: porCategoria(saidasR),
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

// Monta a lista de lançamentos a receber de uma cobrança.
// Entrada (se houver) vence na data da venda; as demais parcelas vencem de mês
// em mês a partir do primeiro vencimento. Valor zero não gera lançamento.
export function planoDeParcelas({
  descricao, clienteId, total, entrada = 0, parcelas = 1,
  primeiroVencimento, data, formaPagamento, origem = 'venda', categoria = 'venda',
}) {
  const totalCent = Math.round(Number(total || 0) * 100)
  if (totalCent <= 0) return []

  const entradaCent = Math.min(Math.max(Math.round(Number(entrada || 0) * 100), 0), totalCent)
  const linhas = []

  if (entradaCent > 0) {
    linhas.push({ sufixo: '(entrada)', centavos: entradaCent, vencimento: data || primeiroVencimento })
  }

  const restanteCent = totalCent - entradaCent
  if (restanteCent > 0) {
    const n = Math.max(1, Number(parcelas || 1))
    const inicio = primeiroVencimento || data
    dividirCentavos(restanteCent, n).forEach((centavos, i) => {
      linhas.push({
        sufixo: n > 1 ? `(${i + 1}/${n})` : '',
        centavos,
        vencimento: inicio ? somarMeses(inicio, i) : '',
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
    formaPagamento: formaPagamento || 'pix',
    parcela: i + 1,
    parcelas: linhas.length,
    origem,
    clienteId: clienteId || '',
  }))
}
