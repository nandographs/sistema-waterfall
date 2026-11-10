// Teste da busca das listas (src/lib/texto.js).
// Não toca no banco nem no navegador. Uso: node scripts/testar-busca.mjs

import { indexarBusca, prepararBusca, pontuarBusca, filtrarPorBusca } from '../src/lib/texto.js'

let falhas = 0
const check = (cond, msg) => {
  console.log(`${cond ? 'ok ' : 'FALHOU'} ${msg}`)
  if (!cond) falhas++
}

const maria = indexarBusca({
  principal: 'Maria da Silva',
  outros: ['João Pereira', 'Chapecó', 'SC'],
  numeros: ['(47) 99123-4567', '(49) 3322-1100'],
})
const casa = (termo, indice = maria) => pontuarBusca(prepararBusca(termo), indice) >= 0

console.log('--- texto ---')
check(casa(''), 'termo vazio casa com tudo')
check(casa('maria'), 'nome')
check(casa('MARIA'), 'sem caixa')
check(casa('maria silva'), 'palavras fora de ordem e com "da" no meio')
check(casa('silva maria'), 'ordem invertida')
check(casa('joao'), 'cônjuge sem acento')
check(casa('chapeco'), 'cidade sem acento')
check(casa('maria chapeco'), 'nome + cidade juntos')
check(casa('silva,'), 'pontuação nas pontas é ignorada')
check(!casa('mariana'), 'não casa palavra maior que a cadastrada')
check(!casa('maria souza'), 'todas as palavras precisam casar')

console.log('\n--- telefone ---')
check(casa('47991234567'), 'só dígitos acha o número com máscara')
check(casa('99123'), 'pedaço do número')
check(casa('(47) 9912'), 'digitado com máscara parcial')
check(casa('47 99123-4567'), 'máscara diferente da cadastrada')
check(casa('5547991234567'), 'com o 55 do WhatsApp na frente')
check(casa('33221100'), 'segundo telefone')
check(casa('maria 9912'), 'nome + pedaço do telefone')
check(!casa('4567 4933'), 'não emenda o fim de um telefone com o começo de outro')
check(!casa('8888'), 'número que nenhum telefone tem não casa')

console.log('\n--- relevância ---')
const ana = indexarBusca({ principal: 'Ana Paula' })
const mariana = indexarBusca({ principal: 'Mariana Ana' })
const julia = indexarBusca({ principal: 'Julia', outros: ['Ana (cônjuge)'] })
const q = prepararBusca('ana')
check(pontuarBusca(q, ana) === 0, 'começa com o termo vale 0')
check(pontuarBusca(q, mariana) === 2, 'outra palavra do nome começa com o termo vale 2')
check(pontuarBusca(q, julia) === 4, 'casou por outro campo vale 4')
// O caso visto na tela: ADRIANE MARIA DA SILVA vinha antes de MARIA CARMEM.
const ms = prepararBusca('maria silva')
const mariaCarmem = indexarBusca({ principal: 'MARIA CARMEM DA SILVA' })
const adriane = indexarBusca({ principal: 'ADRIANE MARIA DA SILVA' })
const mariaSouza = indexarBusca({ principal: 'MARIA SOUZA', outros: ['SILVA (cônjuge)'] })
check(pontuarBusca(ms, mariaCarmem) < pontuarBusca(ms, adriane), 'nome que COMEÇA com Maria vem antes de quem tem Maria no meio')
check(pontuarBusca(ms, adriane) < pontuarBusca(ms, mariaSouza), 'as duas palavras no nome vêm antes de quem casou pelo cônjuge')
const itens = [{ id: 'j', i: julia }, { id: 'm', i: mariana }, { id: 'a', i: ana }]
const ordem = filtrarPorBusca(itens, q, (x) => x.i, { porRelevancia: true }).map((x) => x.id).join('')
check(ordem === 'amj', `ordena por relevância (veio ${ordem})`)
const semOrdem = filtrarPorBusca(itens, q, (x) => x.i).map((x) => x.id).join('')
check(semOrdem === 'jma', 'sem porRelevancia preserva a ordem da lista')

console.log('\n--- produto / financeiro ---')
const produto = indexarBusca({ principal: 'Purificador Acqua', outros: ['PA-200', 'Branco', 'R$ 1.500,00', '1500'] })
check(casa('pa-200', produto), 'código com hífen')
check(casa('purificador branco', produto), 'nome + cor')
check(casa('1500', produto), 'valor sem pontuação')
check(casa('1.500', produto), 'valor formatado')
const venda = indexarBusca({ principal: 'Suyan', outros: ['29/10/2026'] })
check(casa('29/10', venda), 'data parcial')
check(casa('29/10/2026', venda), 'data completa')

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.')
process.exit(falhas ? 1 : 0)
