// Teste das regras dos funis (src/lib/funis.js).
// Não toca no banco nem na rede. Uso: node scripts/testar-funis.mjs
//
// O que importa aqui é a etiqueta da conversa: ela é a resposta de relance a
// "em que ponto está este cliente?". Uma etiqueta errada não dá erro nenhum —
// só manda o atendente oferecer de novo o que o cliente já comprou.

import {
  ordenarEtapas, escolherPrincipal, etapaEquivalente, corLivre,
  etiquetasDosNegocios, negocioAberto, PALETA_FUNIS,
} from '../src/lib/funis.js'

let falhas = 0
const check = (cond, msg) => {
  console.log(`${cond ? 'ok ' : 'FALHOU'} ${msg}`)
  if (!cond) falhas++
}
const eq = (a, b, msg) => check(
  JSON.stringify(a) === JSON.stringify(b),
  `${msg}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` — esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`}`,
)

const FUNIS = {
  vendas: { id: 'vendas', nome: 'Vendas', cor: 'azul' },
  pos: { id: 'pos', nome: 'Pós-venda', cor: 'verde' },
}
const NOMES = { contato: 'Em contato', proposta: 'Proposta enviada', ganho: 'Ganho', perdido: 'Perdido', novo: 'Novo' }
const rotular = (o) => ({ funilId: o.funilId, funil: FUNIS[o.funilId].nome, etapa: NOMES[o.etapa], cor: FUNIS[o.funilId].cor })
const texto = (etiquetas) => etiquetas.map((e) => `${e.funil} · ${e.etapa}`)

console.log('--- etiquetas da conversa ---')
eq(texto(etiquetasDosNegocios([], rotular)), [], 'nunca teve negócio: nenhuma etiqueta')

eq(
  texto(etiquetasDosNegocios([
    { id: 1, funilId: 'vendas', etapa: 'ganho', criadoEm: '2026-01-01', atualizadoEm: '2026-02-01' },
    { id: 2, funilId: 'vendas', etapa: 'proposta', criadoEm: '2026-03-01', atualizadoEm: '2026-03-02' },
  ], rotular)),
  ['Vendas · Proposta enviada'],
  'tem negócio aberto: a etiqueta é a do aberto, não a do fechado',
)

eq(
  texto(etiquetasDosNegocios([
    { id: 1, funilId: 'vendas', etapa: 'perdido', criadoEm: '2026-01-01', atualizadoEm: '2026-01-05' },
    { id: 2, funilId: 'vendas', etapa: 'ganho', criadoEm: '2026-03-01', atualizadoEm: '2026-03-10' },
  ], rotular)),
  ['Vendas · Ganho'],
  'nenhum aberto: só a do último negócio',
)

eq(
  texto(etiquetasDosNegocios([
    { id: 1, funilId: 'vendas', etapa: 'proposta', atualizadoEm: '2026-03-01' },
    { id: 2, funilId: 'pos', etapa: 'novo', atualizadoEm: '2026-03-05' },
  ], rotular)).sort(),
  ['Pós-venda · Novo', 'Vendas · Proposta enviada'],
  'abertos em funis diferentes: uma etiqueta para cada',
)

eq(
  etiquetasDosNegocios([
    { id: 1, funilId: 'vendas', etapa: 'contato' },
    { id: 2, funilId: 'vendas', etapa: 'contato' },
  ], rotular).length,
  1,
  'mesmo funil e mesma etapa: vira uma só',
)

eq(
  etiquetasDosNegocios([
    { id: 1, funilId: 'vendas', etapa: 'contato' },
    { id: 1, funilId: 'vendas', etapa: 'contato' },
  ], rotular).length,
  1,
  'o mesmo negócio vindo por dois caminhos (cliente e conversa) conta uma vez',
)

console.log('--- etapas ---')
eq(
  ordenarEtapas([
    { chave: 'perdido', tipo: 'perdido', ordem: 1001 },
    { chave: 'b', tipo: 'aberta', ordem: 2 },
    { chave: 'ganho', tipo: 'ganho', ordem: 1000 },
    { chave: 'a', tipo: 'aberta', ordem: 1 },
  ]).map((e) => e.chave),
  ['a', 'b', 'ganho', 'perdido'],
  'abertas na ordem escolhida; Ganho e Perdido sempre no fim',
)

const destino = [
  { chave: 'ganho', tipo: 'ganho', ordem: 1000 },
  { chave: 'x2', tipo: 'aberta', ordem: 5 },
  { chave: 'x1', tipo: 'aberta', ordem: 3 },
  { chave: 'perdido', tipo: 'perdido', ordem: 1001 },
]
eq(etapaEquivalente('proposta', destino), 'x1', 'levar para outro funil: aberto vai para a primeira etapa')
eq(etapaEquivalente('ganho', destino), 'ganho', 'ganho continua ganho')
eq(etapaEquivalente('perdido', destino), 'perdido', 'perdido continua perdido')
check(negocioAberto({ etapa: 'e3f9a' }) && !negocioAberto({ etapa: 'ganho' }), 'etapa criada na tela conta como aberta')

console.log('--- funis ---')
eq(escolherPrincipal([{ id: 'b', ordem: 2 }, { id: 'a', ordem: 1 }]).id, 'a', 'sem principal marcado: vale o primeiro da lista')
eq(escolherPrincipal([{ id: 'a', ordem: 1 }, { id: 'b', ordem: 2, principal: true }]).id, 'b', 'o marcado vale mais que a ordem')
eq(corLivre([{ cor: 'azul' }, { cor: 'verde' }]), 'laranja', 'funil novo pega uma cor que ninguém usa')
const todas = Object.keys(PALETA_FUNIS).map((cor) => ({ cor }))
eq(corLivre([...todas, { cor: 'azul' }]), 'verde', 'paleta esgotada: a cor menos usada')
eq(Object.keys(PALETA_FUNIS).length, 11, 'onze cores na paleta')

if (falhas) {
  console.error(`\n${falhas} falha(s).`)
  process.exit(1)
}
console.log('\nTudo certo.')
