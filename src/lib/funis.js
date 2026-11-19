// Regras puras dos funis do CRM (migração 035).
//
// Sem React e sem Supabase, para poder ser testado direto no Node — ver
// scripts/testar-funis.mjs. O repositório chama estas funções passando o que
// tem no cache.

// As onze cores de funil. São as cores de sistema da Apple: foram desenhadas
// para se distinguirem umas das outras e para funcionar nos dois temas — o que
// importa aqui, porque a cor aparece só como uma bolinha ao lado do nome, e
// duas bolinhas parecidas na lista de conversas são dois funis que ninguém
// separa de relance. A chave é a mesma do CHECK em `funis.cor`.
export const PALETA_FUNIS = {
  azul: { nome: 'Azul', hex: '#007aff' },
  verde: { nome: 'Verde', hex: '#34c759' },
  laranja: { nome: 'Laranja', hex: '#ff9500' },
  rosa: { nome: 'Rosa', hex: '#ff2d55' },
  roxo: { nome: 'Roxo', hex: '#af52de' },
  indigo: { nome: 'Índigo', hex: '#5856d6' },
  ciano: { nome: 'Ciano', hex: '#32ade6' },
  menta: { nome: 'Menta', hex: '#00c7be' },
  amarelo: { nome: 'Amarelo', hex: '#ffcc00' },
  vermelho: { nome: 'Vermelho', hex: '#ff3b30' },
  cinza: { nome: 'Cinza', hex: '#8e8e93' },
}

export const hexDaCor = (cor) => (PALETA_FUNIS[cor] ?? PALETA_FUNIS.cinza).hex

// As duas etapas que fecham um negócio. Todo funil tem exatamente uma de cada,
// com estas chaves — o nome pode mudar ("Venda fechada"), a chave não.
export const ETAPAS_FECHADAS = ['ganho', 'perdido']
export const LIMITE_ETAPAS_ABERTAS = 15

export const etapaFechada = (chave) => ETAPAS_FECHADAS.includes(chave)
export const negocioAberto = (oportunidade) => !!oportunidade && !etapaFechada(oportunidade.etapa)

const porOrdemECriacao = (a, b) =>
  Number(a.ordem || 0) - Number(b.ordem || 0) ||
  String(a.criadoEm || '').localeCompare(String(b.criadoEm || ''))

// A ordem dos funis nas abas.
export const ordenarFunis = (funis) => [...funis].sort(porOrdemECriacao)

// O principal: o marcado, ou — por padrão — o primeiro da lista.
export function escolherPrincipal(funis) {
  const ordenados = ordenarFunis(funis)
  return ordenados.find((f) => f.principal) ?? ordenados[0] ?? null
}

// As colunas de um funil: as abertas na ordem escolhida, e Ganho e Perdido
// sempre no fim, nessa ordem — são o ponto de chegada, não uma etapa a mais.
export function ordenarEtapas(etapas) {
  const abertas = etapas.filter((e) => e.tipo === 'aberta').sort(porOrdemECriacao)
  const ganho = etapas.filter((e) => e.tipo === 'ganho')
  const perdido = etapas.filter((e) => e.tipo === 'perdido')
  return [...abertas, ...ganho, ...perdido]
}

// Para onde vai um negócio quando o funil dele é removido e ele é levado para
// outro: aberto → primeira etapa do destino; ganho → Ganho; perdido → Perdido.
// (A mesma regra que `remover_funil` aplica no banco; aqui serve para a tela
// mostrar o que vai acontecer antes de você confirmar.)
export function etapaEquivalente(chave, etapasDoDestino) {
  if (etapaFechada(chave)) return chave
  return ordenarEtapas(etapasDoDestino).find((e) => e.tipo === 'aberta')?.chave ?? null
}

// A cor de um funil novo: a primeira da paleta que ninguém usa; se as onze já
// estiverem em uso, a menos usada.
export function corLivre(funis) {
  const uso = (cor) => funis.filter((f) => f.cor === cor).length
  return Object.keys(PALETA_FUNIS).reduce((melhor, cor) => (uso(cor) < uso(melhor) ? cor : melhor))
}

const maisRecente = (a, b) =>
  String(b.atualizadoEm || b.fechadaEm || b.criadoEm || '')
    .localeCompare(String(a.atualizadoEm || a.fechadaEm || a.criadoEm || ''))

// As etiquetas "Funil · Etapa" de um contato, a partir dos negócios dele.
//
//   * negócio aberto → uma etiqueta por negócio aberto (um por funil, em geral);
//   * nenhum aberto  → só a do ÚLTIMO negócio ("Vendas · Ganho"), que ainda
//     conta onde a história parou;
//   * nunca teve     → nenhuma.
//
// Repetidas (mesmo funil e mesma etapa) viram uma só: dois negócios abertos em
// "Vendas · Em contato" dizem a mesma coisa na lista.
//
// `rotular(oportunidade)` devolve { funilId, funil, etapa, cor } — quem sabe os
// nomes é o repositório, que tem o cache.
export function etiquetasDosNegocios(negocios, rotular) {
  const lista = [...new Map(negocios.filter(Boolean).map((o) => [o.id, o])).values()]
  const abertos = lista.filter(negocioAberto).sort(maisRecente)
  const escolhidos = abertos.length ? abertos : lista.sort(maisRecente).slice(0, 1)

  const vistas = new Set()
  const etiquetas = []
  for (const oportunidade of escolhidos) {
    const rotulo = rotular(oportunidade)
    if (!rotulo) continue
    const chave = `${rotulo.funilId}|${oportunidade.etapa}`
    if (vistas.has(chave)) continue
    vistas.add(chave)
    etiquetas.push({ ...rotulo, chave, oportunidadeId: oportunidade.id, aberta: negocioAberto(oportunidade) })
  }
  return etiquetas
}
