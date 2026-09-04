// Garante que os GÊMEOS de telefone não divergiram.
//
// `src/lib/telefone.js` (app) e `supabase/functions/_compartilhado/telefone.ts`
// (Edge Functions) são cópias deliberadas: o bundler das Edge Functions só
// empacota o que está dentro de supabase/functions/, então o servidor não pode
// importar o arquivo do aplicativo. O cabeçalho dos dois pede "ao mexer em um,
// mexa no outro" — mas até aqui nada verificava isso.
//
// O risco é silencioso e caro: se o servidor deixar de reconhecer um número que
// o app reconhece, a conversa do cliente entra como contato desconhecido e abre
// um lead ao lado da ficha que já existe. Ninguém vê um erro; só aparece um
// cadastro duplicado semanas depois.
//
// Este teste transpila o .ts e compara o COMPORTAMENTO dos dois lados nos casos
// que importam. Usa o esbuild que já vem com o Vite — sem dependência nova.
//
// Uso: node scripts/testar-gemeos-telefone.mjs

import { buildSync } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import * as App from '../src/lib/telefone.js'

let falhas = 0
const check = (cond, msg) => {
  console.log(`${cond ? 'ok ' : 'FALHOU'} ${msg}`)
  if (!cond) falhas++
}

// ---- transpila o lado do servidor para poder EXECUTÁ-LO aqui ----
const pasta = mkdtempSync(join(tmpdir(), 'waterfall-gemeos-'))
const saida = join(pasta, 'telefone-servidor.mjs')

buildSync({
  entryPoints: ['supabase/functions/_compartilhado/telefone.ts'],
  outfile: saida,
  format: 'esm',
  target: 'es2022',
  bundle: false,
})

const Servidor = await import(pathToFileURL(saida).href)

console.log('--- as duas cópias exportam as mesmas funções ---')
{
  // Só as funções que existem dos DOIS lados precisam bater. O servidor tem
  // extras (numeroParaJid é usado só por lá) e o app também (formatarE164 é de
  // exibição) — o que não pode é uma função existir nos dois e se comportar
  // diferente.
  const compartilhadas = [
    'soDigitos', 'jidParaNumero', 'ehGrupo', 'ehStatus', 'paraE164',
    'variantesBR', 'mesmoNumero', 'numeroParaJid',
    'normalizarTelefones', 'telefonesDoCliente', 'clienteTemNumero',
  ]
  for (const nome of compartilhadas) {
    check(
      typeof App[nome] === 'function' && typeof Servidor[nome] === 'function',
      `${nome}() existe nos dois lados`,
    )
  }
}

console.log('\n--- e concordam no comportamento ---')

// Compara os dois lados no mesmo caso. É o coração do arquivo: não basta o
// resultado estar certo de um lado.
function ambos(descricao, chamada, esperado) {
  const doApp = chamada(App)
  const doServidor = chamada(Servidor)
  const iguais = JSON.stringify(doApp) === JSON.stringify(doServidor)
  const certos = JSON.stringify(doApp) === JSON.stringify(esperado)
  check(
    iguais && certos,
    `${descricao}${iguais ? '' : ` — DIVERGIRAM: app=${JSON.stringify(doApp)}, servidor=${JSON.stringify(doServidor)}`}` +
    `${certos ? '' : ` — esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(doApp)}`}`,
  )
}

// O caso que motiva o arquivo inteiro: o nono dígito.
ambos('E.164 a partir do cadastro com máscara', (m) => m.paraE164('(47) 99123-4567'), '5547991234567')
ambos('cadastro sem o nono dígito casa com o WhatsApp', (m) => m.mesmoNumero('(47) 9123-4567', '5547991234567'), true)
ambos('fixo não ganha um nono dígito inventado', (m) => m.variantesBR('554733334444'), ['554733334444'])
ambos('JID vira número', (m) => m.jidParaNumero('5547991234567:63@s.whatsapp.net'), '5547991234567')
ambos('grupo não é telefone', (m) => m.jidParaNumero('123@g.us'), '')

// A lista de telefones (migração 016) — é o que o webhook passou a usar para
// reconhecer o cliente venha a mensagem do celular dele, do fixo ou do da esposa.
const comLista = { telefones: [{ numero: '(47) 3333-4444' }, { numero: '(47) 99123-4567' }] }
const anterior016 = { telefone: '(47) 99123-4567' }

ambos('acha pelo SEGUNDO telefone', (m) => m.clienteTemNumero(comLista, '5547991234567'), true)
ambos('acha pelo fixo', (m) => m.clienteTemNumero(comLista, '554733334444'), true)
ambos('acha sem o nono dígito', (m) => m.clienteTemNumero(comLista, '554791234567'), true)
ambos('não casa com outra pessoa', (m) => m.clienteTemNumero(comLista, '5511988887777'), false)
ambos('cadastro anterior à 016 cai na coluna `telefone`', (m) => m.clienteTemNumero(anterior016, '5547991234567'), true)
ambos('cliente sem telefone não casa com nada', (m) => m.clienteTemNumero({}, '5547991234567'), false)
ambos('lista ausente vira lista vazia', (m) => m.telefonesDoCliente(null), [])
ambos(
  'linha sem número é descartada',
  (m) => m.normalizarTelefones([{ numero: ' (47) 3333-4444 ', rotulo: ' Casa ' }, { numero: '' }]),
  [{ numero: '(47) 3333-4444', rotulo: 'Casa' }],
)

rmSync(pasta, { recursive: true, force: true })

console.log(`\n${falhas === 0 ? 'TUDO OK' : `${falhas} FALHA(S)`}`)
process.exit(falhas === 0 ? 0 : 1)
