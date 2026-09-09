// Unidade de venda do produto.
//
// Mora aqui, e não no repositório, porque os documentos (proposta, pedido)
// precisam da sigla para imprimir "2,5 m" e são JavaScript puro, testável no
// Node — sem Supabase no caminho. O repositório reexporta o que está aqui.

export const UNIDADES = {
  un: { rotulo: 'Unidade', sigla: 'un', fracionavel: false },
  m: { rotulo: 'Metro', sigla: 'm', fracionavel: true },
  cm: { rotulo: 'Centímetro', sigla: 'cm', fracionavel: true },
  m2: { rotulo: 'Metro quadrado', sigla: 'm²', fracionavel: true },
  kg: { rotulo: 'Quilo', sigla: 'kg', fracionavel: true },
  l: { rotulo: 'Litro', sigla: 'L', fracionavel: true },
  cx: { rotulo: 'Caixa', sigla: 'cx', fracionavel: false },
  par: { rotulo: 'Par', sigla: 'par', fracionavel: false },
}

// Produto antigo (e produto salvo com o campo em branco) é peça inteira.
export const unidadeDo = (produto) => UNIDADES[produto?.unidade] ?? UNIDADES.un

export const siglaUnidade = (chave) => (UNIDADES[chave] ?? UNIDADES.un).sigla

// "2,5 m" / "3 un" — a quantidade como ela se lê no papel e na tela.
export function quantidadeComUnidade(quantidade, chave) {
  const n = Number(quantidade || 0)
  const numero = n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
  return `${numero} ${siglaUnidade(chave)}`
}
