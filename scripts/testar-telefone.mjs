// Teste do casamento de números de telefone (src/lib/telefone.js).
// Não toca no banco nem na rede. Uso: node scripts/testar-telefone.mjs
//
// Estes testes existem pelo mesmo motivo dos de data: o erro aqui é SILENCIOSO.
// Um número que não casa não dá erro nenhum — a conversa do cliente só aparece
// como "número desconhecido", o histórico se parte em dois e você descobre
// semanas depois, quando procura o que foi combinado e não acha.
//
// O caso que manda no arquivo é o nono dígito: cadastro antigo sem ele,
// WhatsApp respondendo com ele.

import {
  soDigitos, jidParaNumero, ehGrupo, ehStatus,
  paraE164, partesBR, variantesBR, mesmoNumero, formatarE164, numeroParaJid,
  normalizarTelefones, telefonesDoCliente, telefonePrincipal, comTelefonePrincipal, clienteTemNumero,
} from '../src/lib/telefone.js'

let falhas = 0
const check = (cond, msg) => {
  console.log(`${cond ? 'ok ' : 'FALHOU'} ${msg}`)
  if (!cond) falhas++
}
const eq = (a, b, msg) => check(
  JSON.stringify(a) === JSON.stringify(b),
  `${msg}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` — esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`}`,
)

console.log('--- o nono dígito (a razão de este arquivo existir) ---')
check(
  mesmoNumero('(47) 9123-4567', '5547991234567'),
  'cadastro SEM o nono dígito casa com o WhatsApp COM ele',
)
check(
  mesmoNumero('(47) 99123-4567', '554791234567'),
  'cadastro COM o nono dígito casa com o número antigo SEM ele',
)
check(
  !mesmoNumero('(47) 99123-4567', '5547991234568'),
  'números diferentes de verdade continuam diferentes',
)
check(
  !mesmoNumero('(47) 99123-4567', '5511991234567'),
  'mesmo assinante em outro DDD não casa',
)

// O caso REAL que quebrou a primeira versão do webhook, em 01/09/2026: o
// cadastro tem o número local com máscara, o WhatsApp entregou o E.164 sem o
// nono dígito, e a comparação era feita sem converter o lado do cadastro. Fica
// aqui como teste para não voltar.
check(
  mesmoNumero('(47) 99233-0354', '554792330354'),
  'CASO REAL: cadastro local com máscara casa com E.164 sem o nono dígito',
)

console.log('\n--- paraE164 ---')
eq(paraE164('(47) 99123-4567'), '5547991234567', 'máscara completa vira E.164')
eq(paraE164('47991234567'), '5547991234567', 'só dígitos, com DDD')
eq(paraE164('5547991234567'), '5547991234567', 'já em E.164 permanece')
eq(paraE164('+55 (47) 99123-4567'), '5547991234567', 'com + e máscara')
eq(paraE164('047 99123-4567'), '5547991234567', 'zero de operadora é descartado')
eq(paraE164('(47) 3345-6789'), '554733456789', 'fixo com 8 dígitos')
eq(paraE164('991234567'), '', 'sem DDD não dá para afirmar nada')
eq(paraE164('123'), '', 'lixo devolve vazio')
eq(paraE164(''), '', 'vazio devolve vazio')
eq(paraE164(null), '', 'null devolve vazio')
eq(paraE164('10991234567'), '', 'DDD inválido (10, menor que 11) é recusado')
// Nota sobre o que NÃO dá para decidir: "(07) 99123-4567". Tirando o zero de
// operadora sobram 10 dígitos — 7991234567 —, que é um número perfeitamente
// válido de DDD 79. Os dois lados são plausíveis, e a função escolhe o número
// válido em vez de recusar. É ambiguidade de quem digitou, não erro da
// conversão — e é por isso que o DDD só é conferido quando não houve zero
// para descartar.
eq(paraE164('(07) 99123-4567'), '557991234567', 'zero + DDD de um dígito vira o número plausível')

console.log('\n--- partesBR ---')
eq(partesBR('5547991234567'), { ddi: '55', ddd: '47', assinante: '991234567' }, 'quebra celular')
eq(partesBR('554733456789'), { ddi: '55', ddd: '47', assinante: '33456789' }, 'quebra fixo')
eq(partesBR('12025550123'), null, 'número de outro país devolve null')

console.log('\n--- variantesBR ---')
eq(
  variantesBR('5547991234567').sort(),
  ['554791234567', '5547991234567'],
  'celular com 9 gera as duas formas',
)
eq(
  variantesBR('554791234567').sort(),
  ['554791234567', '5547991234567'],
  'celular antigo (começa em 9) gera as duas formas',
)
eq(
  variantesBR('554733456789'),
  ['554733456789'],
  'FIXO NÃO GANHA NONO DÍGITO — inventaria um número que não existe',
)

console.log('\n--- JID do WhatsApp ---')
eq(jidParaNumero('5547991234567@s.whatsapp.net'), '5547991234567', 'extrai o número do JID')
eq(jidParaNumero('5547991234567:12@s.whatsapp.net'), '5547991234567', 'ignora o sufixo de dispositivo')
eq(jidParaNumero('120363000000000000@g.us'), '', 'grupo não é telefone')
eq(jidParaNumero('status@broadcast'), '', 'status não é telefone')
check(ehGrupo('120363000000000000@g.us'), 'reconhece grupo')
check(ehStatus('status@broadcast'), 'reconhece status')
check(!ehGrupo('5547991234567@s.whatsapp.net'), 'conversa normal não é grupo')
eq(numeroParaJid('(47) 99123-4567'), '5547991234567@s.whatsapp.net', 'monta o JID para envio')
eq(numeroParaJid('123'), '', 'número inválido não vira JID')

console.log('\n--- formatarE164 ---')
eq(formatarE164('5547991234567'), '(47) 99123-4567', 'celular volta com máscara')
eq(formatarE164('554733456789'), '(47) 3345-6789', 'fixo volta com máscara')
eq(formatarE164('12025550123'), '+12025550123', 'estrangeiro volta com +')
eq(formatarE164(''), '', 'vazio devolve vazio')

console.log('\n--- ida e volta ---')
{
  const cadastro = '(47) 99123-4567'
  eq(formatarE164(paraE164(cadastro)), cadastro, 'cadastro -> E.164 -> cadastro')
}

console.log('\n--- soDigitos ---')
eq(soDigitos('(47) 99123-4567'), '47991234567', 'remove tudo que não é dígito')
eq(soDigitos(undefined), '', 'undefined vira vazio')


console.log('\n--- lista de telefones do cliente ---')
{
  const lista = normalizarTelefones([
    { numero: '  (47) 99123-4567 ', rotulo: ' WhatsApp ' },
    { numero: '', rotulo: 'Casa' },
    { numero: '(47) 3333-4444' },
    null,
  ])
  eq(lista.length, 2, 'linha sem número não é um telefone')
  eq(lista[0], { numero: '(47) 99123-4567', rotulo: 'WhatsApp' }, 'apara os espaços das duas pontas')
  eq(lista[1], { numero: '(47) 3333-4444', rotulo: '' }, 'telefone sem rótulo continua valendo')
}
eq(normalizarTelefones(null), [], 'lista ausente vira lista vazia')

console.log('\n--- telefonesDoCliente: lista nova e cadastro antigo ---')
eq(
  telefonesDoCliente({ telefones: [{ numero: '(47) 99123-4567', rotulo: 'Celular' }], telefone: '(11) 1111-1111' }),
  [{ numero: '(47) 99123-4567', rotulo: 'Celular' }],
  'tendo lista, a lista manda',
)
eq(
  telefonesDoCliente({ telefone: '(47) 99123-4567' }),
  [{ numero: '(47) 99123-4567', rotulo: '' }],
  'cadastro anterior à migração 016 vira uma lista de um',
)
eq(telefonesDoCliente({ telefones: [], telefone: '' }), [], 'cliente sem telefone nenhum')
eq(telefonesDoCliente(null), [], 'sem cliente, lista vazia')
eq(telefonePrincipal({ telefones: [{ numero: 'A' }, { numero: 'B' }] }), 'A', 'o principal é o primeiro')
eq(telefonePrincipal({}), '', 'sem telefone, principal vazio')

console.log('\n--- comTelefonePrincipal: a coluna telefone é derivada ---')
{
  const gravar = comTelefonePrincipal({
    nome: 'Maria',
    telefone: '(11) 0000-0000',
    telefones: [{ numero: '(47) 99123-4567', rotulo: 'WhatsApp' }, { numero: '', rotulo: 'Casa' }],
  })
  eq(gravar.telefone, '(47) 99123-4567', 'a coluna passa a valer o primeiro da lista')
  eq(gravar.telefones.length, 1, 'a linha vazia não vai para o banco')
  eq(gravar.nome, 'Maria', 'o resto do cadastro passa intacto')
}
{
  const semLista = comTelefonePrincipal({ telefone: '(47) 99123-4567', telefones: [] })
  eq(semLista.telefone, '(47) 99123-4567', 'sem lista, a coluna antiga não é apagada')
}

console.log('\n--- clienteTemNumero: casa com o que o WhatsApp devolve ---')
{
  const cliente = { telefones: [{ numero: '(47) 3333-4444' }, { numero: '(47) 99123-4567' }] }
  check(clienteTemNumero(cliente, '5547991234567'), 'acha o SEGUNDO telefone pelo E.164')
  check(clienteTemNumero(cliente, '554733334444'), 'acha o fixo também')
  // O nono dígito: cadastrado com 9, o WhatsApp responde sem (ou o contrário).
  check(clienteTemNumero(cliente, '554791234567'), 'casa mesmo sem o nono dígito')
  check(!clienteTemNumero(cliente, '5511988887777'), 'número de outra pessoa não casa')
  check(!clienteTemNumero({}, '5547991234567'), 'cliente sem telefone não casa com nada')
}

console.log(`\n${falhas === 0 ? 'TUDO OK' : `${falhas} FALHA(S)`}`)
process.exit(falhas === 0 ? 0 : 1)
