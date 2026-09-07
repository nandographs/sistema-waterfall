// Auditoria de clientes repetidos na base inteira.
// Uso: node scripts/auditar-duplicados.mjs
//
// Só LÊ. Não altera nada. Escreve o resultado em
// scripts/saida-teste/auditoria-duplicados.csv
//
// POR QUE AS REGRAS AQUI SÃO MAIS FROUXAS QUE AS DA IMPORTAÇÃO
//
// O importador erra para o lado de NÃO inserir: na dúvida ele pula, porque um
// cliente que faltou entrar é barato de corrigir e um cliente duplicado não é.
// A auditoria erra para o outro lado: ela ACUSA na dúvida, porque aqui ninguém
// grava nada — quem decide é você, olhando a lista. Por isso ela pega coisas
// que o importador deixa passar de propósito, como nome parecido (e não
// idêntico) no mesmo endereço, e telefone repetido entre cadastros.
//
// A saída é ordenada por confiança: o topo é para fundir quase sem olhar, o
// fim exige conferir a ficha.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const RAIZ = path.join(AQUI, '..')

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
const chave = (s) => semAcento(String(s || '')).toUpperCase().replace(/[^A-Z0-9]/g, '')
const digitos = (s) => String(s || '').replace(/\D/g, '')

// Telefone só conta como pista se tiver corpo de número brasileiro. Cadastro
// antigo cheio de "0000-0000" e "99999-9999" acusaria a base inteira.
const LIXO = new Set(['', '00000000', '000000000', '0000000000', '00000000000',
  '99999999', '999999999', '9999999999', '99999999999', '11111111', '123456789'])
function telefonesDe(c) {
  const brutos = [c.telefone, ...(Array.isArray(c.telefones) ? c.telefones.map((t) => t?.numero) : [])]
  const bons = brutos.map(digitos)
    .map((d) => d.length === 13 && d.startsWith('55') ? d.slice(2) : d)   // tira DDI
    .filter((d) => d.length >= 10 && d.length <= 11 && !LIXO.has(d))
    .filter((d) => !/^(\d)\1+$/.test(d))
  return [...new Set(bons)]
}

function bigramas(s) {
  const b = new Set()
  for (let i = 0; i < s.length - 1; i++) b.add(s.slice(i, i + 2))
  return b
}
function dice(a, b) {
  const A = bigramas(a), B = bigramas(b)
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const g of A) if (B.has(g)) inter++
  return (2 * inter) / (A.size + B.size)
}

// União-busca: um cliente acusado por duas regras diferentes tem que sair num
// grupo só, senão a mesma pessoa aparece em dois lugares da lista.
class Uniao {
  constructor() { this.pai = new Map(); this.motivos = new Map() }
  achar(x) {
    if (!this.pai.has(x)) this.pai.set(x, x)
    while (this.pai.get(x) !== x) { this.pai.set(x, this.pai.get(this.pai.get(x))); x = this.pai.get(x) }
    return x
  }
  juntar(a, b, motivo) {
    const ra = this.achar(a), rb = this.achar(b)
    const par = [a, b].sort().join('~')
    if (!this.motivos.has(par)) this.motivos.set(par, motivo)
    if (ra !== rb) this.pai.set(ra, rb)
  }
}

async function principal() {
  const env = {}
  for (const l of fs.readFileSync(path.join(RAIZ, '.env'), 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY,
    { auth: { persistSession: false } })

  const cli = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await sb.from('clientes')
      .select('id,nome,telefone,telefones,cpf_cnpj,endereco,numero_complemento,bairro,cidade,criado_por,criado_em')
      .range(de, de + 999)
    if (error) { console.error('Erro ao ler clientes:', error.message); process.exit(1) }
    cli.push(...data)
    if (data.length < 1000) break
  }
  console.log(`${cli.length} clientes lidos.\n`)

  for (const c of cli) {
    c.k_nome = chave(c.nome)
    c.k_end = chave(c.endereco)
    c.k_cid = chave(c.cidade)
    c.doc = digitos(c.cpf_cnpj)
    c.fones = telefonesDe(c)
  }

  const u = new Uniao()
  const porId = new Map(cli.map((c) => [c.id, c]))
  const conflita = (a, b) => a.doc && b.doc && a.doc !== b.doc

  // Cada regra indexa por uma chave e liga quem cair no mesmo balde.
  const aplicar = (nome, chaveDe, aceita = () => true) => {
    const balde = new Map()
    for (const c of cli) {
      const k = chaveDe(c)
      if (!k) continue
      if (!balde.has(k)) balde.set(k, [])
      balde.get(k).push(c)
    }
    let ligacoes = 0
    for (const grupo of balde.values()) {
      if (grupo.length < 2) continue
      for (let i = 0; i < grupo.length; i++) {
        for (let j = i + 1; j < grupo.length; j++) {
          if (!aceita(grupo[i], grupo[j])) continue
          u.juntar(grupo[i].id, grupo[j].id, nome)
          ligacoes++
        }
      }
    }
    console.log(`  ${String(ligacoes).padStart(5)}  ${nome}`)
  }

  console.log('Pares acusados por regra:')
  aplicar('mesmo CPF', (c) => c.doc.length === 11 ? 'cpf:' + c.doc : '')
  aplicar('mesmo CNPJ e mesmo endereço', (c) => c.doc.length === 14 && c.k_end ? 'cnpj:' + c.doc + '|' + c.k_end : '')
  aplicar('mesmo nome e mesmo endereço', (c) => c.k_nome && c.k_end ? 'ne:' + c.k_nome + '|' + c.k_end : '', (a, b) => !conflita(a, b))
  aplicar('mesmo nome e mesma cidade', (c) => c.k_nome && c.k_cid ? 'nc:' + c.k_nome + '|' + c.k_cid : '', (a, b) => !conflita(a, b))

  // Telefone: forte, mas casal e empresa dividem número. Exige cidade igual.
  {
    const balde = new Map()
    for (const c of cli) for (const f of c.fones) {
      if (!balde.has(f)) balde.set(f, [])
      balde.get(f).push(c)
    }
    let n = 0
    for (const grupo of balde.values()) {
      if (grupo.length < 2) continue
      for (let i = 0; i < grupo.length; i++) for (let j = i + 1; j < grupo.length; j++) {
        const [a, b] = [grupo[i], grupo[j]]
        if (conflita(a, b) || a.k_cid !== b.k_cid) continue
        // Sem nome parecido, telefone igual pode ser só o telefone do filho.
        if (dice(a.k_nome, b.k_nome) < 0.5) continue
        u.juntar(a.id, b.id, 'mesmo telefone e nome parecido')
        n++
      }
    }
    console.log(`  ${String(n).padStart(5)}  mesmo telefone e nome parecido`)
  }

  // Nome PARECIDO no mesmo endereço — é aqui que mora o erro de OCR
  // ("CLOVIS DAMOLIN" x "CLOVIS JOSE DALMOLIN" na mesma rua).
  {
    const balde = new Map()
    for (const c of cli) {
      if (!c.k_end || !c.k_cid) continue
      const k = c.k_end + '|' + c.k_cid
      if (!balde.has(k)) balde.set(k, [])
      balde.get(k).push(c)
    }
    let n = 0
    for (const grupo of balde.values()) {
      if (grupo.length < 2) continue
      for (let i = 0; i < grupo.length; i++) for (let j = i + 1; j < grupo.length; j++) {
        const [a, b] = [grupo[i], grupo[j]]
        if (conflita(a, b)) continue
        if (dice(a.k_nome, b.k_nome) < 0.82) continue
        u.juntar(a.id, b.id, 'nome parecido no mesmo endereço')
        n++
      }
    }
    console.log(`  ${String(n).padStart(5)}  nome parecido no mesmo endereço`)
  }

  // ---- monta os grupos ----
  const grupos = new Map()
  for (const c of cli) {
    const r = u.achar(c.id)
    if (!grupos.has(r)) grupos.set(r, [])
    grupos.get(r).push(c)
  }
  const repetidos = [...grupos.values()].filter((g) => g.length > 1)
    .map((g) => g.sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em))))
    .sort((a, b) => b.length - a.length)

  const linhasExtras = repetidos.reduce((s, g) => s + g.length - 1, 0)
  const imp = (c) => c.criado_por === 'importacao-fichas'

  console.log('\n' + '='.repeat(64))
  console.log(`${repetidos.length} grupos de cliente repetido · ${linhasExtras} linhas a mais do que deveria`)
  console.log('='.repeat(64))

  const so = (g, f) => g.every(f)
  console.log(`  ${String(repetidos.filter((g) => so(g, (c) => !imp(c))).length).padStart(5)}  só entre cadastros antigos`)
  console.log(`  ${String(repetidos.filter((g) => so(g, imp)).length).padStart(5)}  só entre linhas da importação`)
  console.log(`  ${String(repetidos.filter((g) => g.some(imp) && g.some((c) => !imp(c))).length).padStart(5)}  antigo + importado (a importação não pegou)`)

  const motivoDoGrupo = (g) => {
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
      const m = u.motivos.get([g[i].id, g[j].id].sort().join('~'))
      if (m) return m
    }
    return 'ligado indiretamente'
  }

  console.log('\nMaiores grupos:')
  for (const g of repetidos.slice(0, 12)) {
    console.log(`\n  ${g.length}×  ${motivoDoGrupo(g)}`)
    for (const c of g) {
      console.log(`      ${(c.nome || '(sem nome)').padEnd(42)} ${(c.cpf_cnpj || '—').padEnd(20)} ` +
                  `${(c.endereco || '—').slice(0, 28).padEnd(28)} ${imp(c) ? 'importado' : 'antigo'}`)
    }
  }

  const destino = path.join(RAIZ, 'scripts', 'saida-teste', 'auditoria-duplicados.csv')
  fs.mkdirSync(path.dirname(destino), { recursive: true })
  const csv = ['grupo;motivo;id;nome;cpf_cnpj;telefone;endereco;numero;bairro;cidade;origem;criado_em']
  repetidos.forEach((g, i) => {
    const m = motivoDoGrupo(g)
    for (const c of g) {
      csv.push([i + 1, m, c.id, c.nome, c.cpf_cnpj, c.telefone, c.endereco, c.numero_complemento,
        c.bairro, c.cidade, imp(c) ? 'importado' : 'antigo', c.criado_em]
        .map((x) => String(x ?? '').replace(/;/g, ',').replace(/[\r\n]+/g, ' ')).join(';'))
    }
  })
  fs.writeFileSync(destino, '﻿' + csv.join('\n'), 'utf8')
  console.log(`\nLista completa: ${path.relative(RAIZ, destino)}`)
}

principal().catch((e) => { console.error(e.stack || e.message); process.exit(1) })
