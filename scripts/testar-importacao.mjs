// Teste da regra de duplicado da importação das fichas
// (scripts/importar-fichas.mjs). Não toca no banco nem na rede.
// Uso: node scripts/testar-importacao.mjs
//
// Este é o ponto do importador que precisa estar certo. Os outros erros são
// barulhentos — credencial errada não conecta, coluna errada devolve erro do
// PostgREST. Este é silencioso: uma chave frouxa demais funde dois clientes
// diferentes num só, uma chave rígida demais cadastra a mesma pessoa duas
// vezes, e nos dois casos o script termina dizendo "pronto".
//
// O caso que manda no arquivo é o CNPJ: a prefeitura usa UM CNPJ para várias
// escolas, então CNPJ sozinho não pode identificar cliente.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chavesDe, chave, digitos, motivoDaChave, documentosBrigam } from './importar-fichas.mjs'

const AQUI = path.dirname(fileURLToPath(import.meta.url))

let falhas = 0
const check = (cond, msg) => {
  console.log(`${cond ? 'ok ' : 'FALHOU'} ${msg}`)
  if (!cond) falhas++
}

// A mesma varredura que o importador faz: base existente indexada, fichas
// testadas contra ela uma a uma.
function separar(existentes, fichas) {
  const indice = new Map()
  const indexar = (c) => {
    for (const k of chavesDe(c)) {
      if (!indice.has(k)) indice.set(k, [])
      indice.get(k).push(c)
    }
  }
  for (const c of existentes) indexar(c)
  const aceitos = [], pulados = []
  for (const f of fichas) {
    let achado = null
    for (const k of chavesDe(f)) {
      const dono = (indice.get(k) || []).find((c) => !documentosBrigam(c, f))
      if (dono) { achado = { dono, motivo: motivoDaChave(k) }; break }
    }
    if (achado) { pulados.push({ ficha: f, ...achado }); continue }
    aceitos.push(f)
    indexar(f)
  }
  return { aceitos, pulados }
}

// --- normalização -----------------------------------------------------------
check(chave('José da Silva') === chave('JOSE DA SILVA'), 'acento e caixa não separam a mesma pessoa')
check(chave('Rua São Paulo, 123') === chave('RUA SAO PAULO 123'), 'pontuação não separa o mesmo endereço')
check(digitos('111.222.333-44') === '11122233344', 'documento vira só dígitos')

// --- CPF identifica sozinho -------------------------------------------------
{
  const base = [{ nome: 'MARIA SOUZA', cpf_cnpj: '123.456.789-09', endereco: 'RUA A', cidade: 'PATO BRANCO' }]
  const ficha = [{ nome: 'MARIA DE SOUZA', cpf_cnpj: '12345678909', endereco: 'RUA B', cidade: 'VITORINO' }]
  const { pulados } = separar(base, ficha)
  check(pulados.length === 1 && pulados[0].motivo === 'mesmo CPF',
    'mesmo CPF pula, mesmo com nome e endereço diferentes')
}

// --- CNPJ NÃO identifica sozinho -------------------------------------------
// O caso real: 76.995.448/0001-54 é a prefeitura, e cobre três endereços.
{
  const base = [{ nome: 'APM ESCOLA MUNICIPAL PLANALTO', cpf_cnpj: '76.995.448/0001-54',
                  endereco: 'RUA DOS PAVAIS', cidade: 'PATO BRANCO' }]
  const fichas = [
    { nome: 'ESCOLA MUNICIPAL JARDIM PRIMAVERA', cpf_cnpj: '76.995.448/0001-54',
      endereco: 'RUA TAPIR', cidade: 'PATO BRANCO' },
    { nome: 'DEPATRAN', cpf_cnpj: '76.995.448/0001-54',
      endereco: 'AVENIDA TUPI', cidade: 'PATO BRANCO' },
  ]
  const { aceitos } = separar(base, fichas)
  check(aceitos.length === 2, 'mesmo CNPJ em endereços diferentes = clientes diferentes')
}
{
  const base = [{ nome: 'A ARIOTTI E CIA LTDA', cpf_cnpj: '10.255.185/0001-39',
                  endereco: 'TRAV ARNALDO BUSATO', cidade: 'DOIS VIZINHOS' }]
  // Mesma empresa, mesmo endereço, nome destruído pelo OCR.
  const ficha = [{ nome: 'É SIALTDA', cpf_cnpj: '10.255.185/0001-39',
                   endereco: 'TRAV ARNALDO BUSATO', cidade: 'DOIS VIZINHOS' }]
  const { pulados } = separar(base, ficha)
  check(pulados.length === 1 && pulados[0].motivo === 'mesmo CNPJ e mesmo endereço',
    'mesmo CNPJ no mesmo endereço pula, mesmo com o nome ilegível')
}

// --- nome + endereço / nome + cidade ---------------------------------------
{
  const base = [{ nome: 'PEDRO VICHI', cpf_cnpj: '', endereco: 'RUA CLAUDIR OLDONI 91', cidade: 'PATO BRANCO' }]
  const ficha = [{ nome: 'Pedro Vichi', cpf_cnpj: '', endereco: 'Rua Claudir Oldoni, 91', cidade: 'PATO BRANCO' }]
  check(separar(base, ficha).pulados[0].motivo === 'nome + endereço iguais', 'mesmo nome e endereço pula')
}
{
  const base = [{ nome: 'DIRCE SANTINI', cpf_cnpj: '', endereco: '', cidade: 'PATO BRANCO' }]
  const ficha = [{ nome: 'DIRCE SANTINI', cpf_cnpj: '', endereco: 'RUA NOVA', cidade: 'PATO BRANCO' }]
  check(separar(base, ficha).pulados[0].motivo === 'nome + cidade iguais',
    'sem endereço na base, nome + cidade ainda pega')
}
{
  const base = [{ nome: 'JOAO SILVA', cpf_cnpj: '', endereco: 'RUA A', cidade: 'PATO BRANCO' }]
  const ficha = [{ nome: 'JOAO SILVA', cpf_cnpj: '', endereco: 'RUA B', cidade: 'CHOPINZINHO' }]
  check(separar(base, ficha).aceitos.length === 1, 'mesmo nome em cidade diferente é outro cliente')
}

// --- a carga não se duplica sozinha ----------------------------------------
{
  const ficha = { nome: 'ALGUEM', cpf_cnpj: '', endereco: 'RUA X', cidade: 'PATO BRANCO' }
  const { aceitos } = separar([], [ficha, { ...ficha }])
  check(aceitos.length === 1, 'a mesma ficha duas vezes na carga entra uma vez só')
}

// --- base vazia: a carga real entra inteira --------------------------------
const arquivo = path.join(AQUI, 'dados-fichas.json')
if (fs.existsSync(arquivo)) {
  const carga = JSON.parse(fs.readFileSync(arquivo, 'utf8'))
  const { aceitos, pulados } = separar([], carga.clientes)
  check(pulados.length === 0 && aceitos.length === carga.clientes.length,
    `carga real em base vazia: ${aceitos.length} entram, nenhuma repetida entre si`)

  // Rodar de novo com a carga já na base não pode inserir nada.
  const segunda = separar(carga.clientes, carga.clientes)
  check(segunda.aceitos.length === 0, 'importar duas vezes não duplica (idempotente)')
} else {
  console.log('-- scripts/dados-fichas.json ausente; testes da carga real pulados')
}

console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.')
process.exit(falhas ? 1 : 0)
