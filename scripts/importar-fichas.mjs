// Importa os clientes e produtos das fichas de papel (scripts/dados-fichas.json)
// pela API do Supabase, em lotes. É a alternativa ao sql/018: mesma carga, mesmas
// regras de duplicado, sem o SQL Editor.
//
// POR QUE ESTE ARQUIVO EXISTE
//
// O 018 faz tudo numa transação só. O passo caro é achar quem já está na base:
// ele compara cada uma das 1.986 fichas com cada cliente do banco aplicando
// normalização de texto nos dois lados — sem índice, isso é produto cartesiano e
// estoura o statement timeout do SQL Editor.
//
// Aqui a comparação sai do banco. O script baixa os clientes existentes UMA vez,
// monta os índices em memória (Map, custo O(1) por consulta) e só manda para a
// rede o que é insert de verdade, em lotes. O trabalho é o mesmo; o que muda é
// que nada disso acontece dentro de uma transação com relógio correndo.
//
// COMO USAR
//
//   node scripts/importar-fichas.mjs            # simulação: não grava nada
//   node scripts/importar-fichas.mjs --gravar   # grava
//
// A simulação é o padrão de propósito: ela imprime o relatório de duplicados
// completo, que é o que você quer ver ANTES de escrever 1.986 linhas na base.
//
// CREDENCIAL (no .env, este script nunca a imprime)
//
//   SUPABASE_SERVICE_ROLE_KEY=...    <- recomendado
//
// A chave de serviço passa por cima do RLS, que é o que uma carga administrativa
// precisa. Ela é secreta: só no .env (que já está no .gitignore), nunca no
// código nem no navegador.
//
// Sem ela, o script cai para a anon key + login, e aí precisa de:
//
//   SUPABASE_EMAIL=...
//   SUPABASE_SENHA=...

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const RAIZ = path.join(AQUI, '..')
const GRAVAR = process.argv.includes('--gravar')
const LOTE = 200

// ---------------------------------------------------------------------------
// .env — o projeto não usa dotenv, então lê na mão. Só chave=valor, sem drama.
// ---------------------------------------------------------------------------
function lerEnv() {
  const env = { ...process.env }
  const arquivo = path.join(RAIZ, '.env')
  if (!fs.existsSync(arquivo)) return env
  for (const linha of fs.readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
    if (!m) continue
    if (env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return env
}

// ---------------------------------------------------------------------------
// Normalização — TEM que ser a mesma dos dois lados da comparação, senão
// "José da Silva" e "JOSE DA SILVA" entram como duas pessoas.
// ---------------------------------------------------------------------------
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
const chave = (s) => semAcento(String(s || '')).toUpperCase().replace(/[^A-Z0-9]/g, '')
const digitos = (s) => String(s || '').replace(/\D/g, '')

// As chaves de identidade de um cliente, da mais forte para a mais fraca.
//
// CPF (11 dígitos) é uma pessoa: vale sozinho.
// CNPJ (14) não é. A prefeitura usa um CNPJ só para a Escola Municipal
// Planalto, a Escola Jardim Primavera e o DEPATRAN — três endereços, três
// clientes. Por isso o CNPJ só identifica junto com o endereço.
function chavesDe(c) {
  const ks = []
  const doc = digitos(c.cpf_cnpj)
  const n = chave(c.nome)
  const end = chave(c.endereco)
  if (doc.length === 11) ks.push('cpf:' + doc)
  else if (doc.length === 14) ks.push('cnpj:' + doc + '|' + (end || n))
  if (end) ks.push('nomend:' + n + '|' + end)
  ks.push('nomcid:' + n + '|' + chave(c.cidade))
  return ks
}

const motivoDaChave = (k) => k.startsWith('cpf:') ? 'mesmo CPF'
  : k.startsWith('cnpj:') ? 'mesmo CNPJ e mesmo endereço'
  : k.startsWith('nomend:') ? 'nome + endereço iguais'
  : 'nome + cidade iguais'

// Veto: dois cadastros que trazem documento, e documentos DIFERENTES, não são o
// mesmo cliente — por mais que nome e cidade batam. É o caso das duas filiais da
// MCFARMA em Pato Branco: mesmo nome, CNPJs 0003-81 e 0007-05, ruas diferentes.
// Sem este veto a segunda filial seria pulada como repetida.
function documentosBrigam(a, b) {
  const da = digitos(a.cpf_cnpj), db = digitos(b.cpf_cnpj)
  return da !== '' && db !== '' && da !== db
}

// ---------------------------------------------------------------------------
async function principal() {
  const env = lerEnv()
  const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL
  if (!url) erro('VITE_SUPABASE_URL não está no .env.')

  const servico = env.SUPABASE_SERVICE_ROLE_KEY
  const anon = env.VITE_SUPABASE_ANON_KEY
  if (!servico && !anon) erro('Nem SUPABASE_SERVICE_ROLE_KEY nem VITE_SUPABASE_ANON_KEY no .env.')

  const supabase = createClient(url, servico || anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  if (servico) {
    console.log('Conectado com a chave de serviço (RLS não se aplica).')
  } else {
    if (!env.SUPABASE_EMAIL || !env.SUPABASE_SENHA) {
      erro('Sem SUPABASE_SERVICE_ROLE_KEY, é preciso SUPABASE_EMAIL e SUPABASE_SENHA no .env\n' +
           '(a anon key sozinha não grava: o RLS da migração 007 exige usuário autenticado).')
    }
    const { error } = await supabase.auth.signInWithPassword({
      email: env.SUPABASE_EMAIL, password: env.SUPABASE_SENHA,
    })
    if (error) erro('Login falhou: ' + error.message)
    console.log('Conectado como ' + env.SUPABASE_EMAIL + '.')
  }

  const carga = JSON.parse(fs.readFileSync(path.join(AQUI, 'dados-fichas.json'), 'utf8'))
  console.log(`Carga: ${carga.clientes.length} clientes e ${carga.produtos.length} produtos.`)
  console.log(GRAVAR ? 'MODO GRAVAÇÃO.\n' : 'MODO SIMULAÇÃO — nada será gravado. Use --gravar para valer.\n')

  await importarProdutos(supabase, carga.produtos)
  const pulados = await importarClientes(supabase, carga.clientes)
  relatorio(pulados, carga.clientes.length)
}

// ---------------------------------------------------------------------------
async function importarProdutos(supabase, produtos) {
  const existentes = await baixarTudo(supabase, 'produtos', 'id,nome')
  const jaTem = new Set(existentes.map((p) => chave(p.nome)))
  const novos = produtos.filter((p) => !jaTem.has(chave(p.nome)))

  console.log(`Produtos: ${existentes.length} no catálogo, ${novos.length} a inserir, ` +
              `${produtos.length - novos.length} já existiam.`)
  if (novos.length && GRAVAR) {
    await inserirEmLotes(supabase, 'produtos', novos)
    console.log(`  ${novos.length} produtos inseridos.`)
  }
  console.log('')
}

// ---------------------------------------------------------------------------
async function importarClientes(supabase, clientes) {
  const existentes = await baixarTudo(supabase, 'clientes', 'id,nome,cpf_cnpj,endereco,cidade')
  console.log(`Clientes: ${existentes.length} já na base.`)

  // Um índice por chave de identidade. Cada chave guarda uma LISTA: duas filiais
  // com o mesmo nome na mesma cidade dividem a chave "nome + cidade", e é o veto
  // do documento que decide entre elas — para isso é preciso ver todas.
  //
  // Quem já está na base entra aqui primeiro; depois cada ficha aceita entra
  // também, o que impede a própria carga de inserir a mesma pessoa duas vezes.
  const indice = new Map()
  const indexar = (c) => {
    for (const k of chavesDe(c)) {
      if (!indice.has(k)) indice.set(k, [])
      indice.get(k).push(c)
    }
  }
  for (const c of existentes) indexar(c)

  const aceitos = []
  const pulados = []
  for (const ficha of clientes) {
    let achado = null
    for (const k of chavesDe(ficha)) {
      const dono = (indice.get(k) || []).find((c) => !documentosBrigam(c, ficha))
      if (dono) { achado = { dono, motivo: motivoDaChave(k) }; break }
    }
    if (achado) {
      pulados.push({
        nome_na_ficha: ficha.nome,
        ja_cadastrado_como: achado.dono.nome,
        cidade: ficha.cidade || '',
        documento: ficha.cpf_cnpj || '',
        motivo: achado.motivo,
      })
      continue
    }
    aceitos.push(ficha)
    indexar(ficha)
  }

  console.log(`  ${aceitos.length} a inserir, ${pulados.length} pulados por já existirem.`)

  if (aceitos.length && GRAVAR) {
    const linhas = aceitos.map((c) => ({ ...c, criado_por: 'importacao-fichas' }))
    await inserirEmLotes(supabase, 'clientes', linhas)
    console.log(`  ${aceitos.length} clientes inseridos.`)
  }
  console.log('')
  return pulados
}

// ---------------------------------------------------------------------------
// O PostgREST devolve no máximo 1.000 linhas por requisição. Sem paginar, a
// base "existente" viria truncada e o script duplicaria tudo do milésimo em
// diante — que é justamente o erro que ele existe para evitar.
async function baixarTudo(supabase, tabela, colunas) {
  const linhas = []
  const passo = 1000
  for (let de = 0; ; de += passo) {
    const { data, error } = await supabase.from(tabela).select(colunas).range(de, de + passo - 1)
    if (error) erro(`Falha ao ler ${tabela}: ${error.message}`)
    linhas.push(...data)
    if (data.length < passo) break
  }
  return linhas
}

async function inserirEmLotes(supabase, tabela, linhas) {
  for (let i = 0; i < linhas.length; i += LOTE) {
    const lote = linhas.slice(i, i + LOTE)
    const { error } = await supabase.from(tabela).insert(lote)
    if (error) erro(`Falha ao inserir em ${tabela} (lote ${i / LOTE + 1}): ${error.message}`)
    process.stdout.write(`\r  ${tabela}: ${Math.min(i + LOTE, linhas.length)}/${linhas.length}`)
  }
  process.stdout.write('\r' + ' '.repeat(40) + '\r')
}

// ---------------------------------------------------------------------------
function relatorio(pulados, total) {
  const destino = path.join(RAIZ, 'scripts', 'saida-teste', 'duplicados-fichas.csv')
  fs.mkdirSync(path.dirname(destino), { recursive: true })
  const csv = ['nome na ficha;ja cadastrado como;cidade;documento;motivo']
    .concat(pulados.map((p) => [
      p.nome_na_ficha, p.ja_cadastrado_como, p.cidade, p.documento, p.motivo,
    ].map((c) => String(c).replace(/;/g, ',')).join(';')))
    .join('\n')
  fs.writeFileSync(destino, '﻿' + csv, 'utf8')

  console.log('='.repeat(64))
  console.log(`${total} fichas · ${total - pulados.length} inseridas · ${pulados.length} puladas`)
  console.log('='.repeat(64))

  if (pulados.length) {
    const porMotivo = {}
    for (const p of pulados) porMotivo[p.motivo] = (porMotivo[p.motivo] || 0) + 1
    for (const [m, n] of Object.entries(porMotivo).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(5)}  ${m}`)
    }
    console.log('\nPrimeiros 20 duplicados:')
    for (const p of pulados.slice(0, 20)) {
      console.log(`  "${p.nome_na_ficha}" ≡ "${p.ja_cadastrado_como}"  (${p.motivo})`)
    }
    console.log(`\nLista completa: ${path.relative(RAIZ, destino)}`)
  }
  if (!GRAVAR) console.log('\nNada foi gravado. Rode com --gravar quando o relatório estiver de acordo.')
}

function erro(msg) {
  console.error('\nErro: ' + msg)
  process.exit(1)
}

// Exportado para o teste (scripts/testar-importacao.mjs) poder exercitar a
// regra de duplicado sem banco e sem rede — que é a parte que precisa estar
// certa, e a única que não dá para conferir olhando o resultado depois.
export { chavesDe, chave, digitos, motivoDaChave, documentosBrigam }

// Só roda quando chamado direto, não quando importado pelo teste.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principal().catch((e) => erro(e.stack || e.message))
}
