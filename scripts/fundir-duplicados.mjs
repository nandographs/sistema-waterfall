// Funde os clientes repetidos encontrados por scripts/auditar-duplicados.mjs.
// Uso: node scripts/fundir-duplicados.mjs            (simulação, não grava)
//      node scripts/fundir-duplicados.mjs --gravar
//
// COMO A FUSÃO FUNCIONA
//
// De cada grupo sai UM sobrevivente: o cadastro mais completo (mais campos
// preenchidos); empatou, o mais antigo, para preservar o histórico de quem
// chegou primeiro. Os outros são absorvidos e apagados.
//
// Antes de apagar, duas coisas acontecem, nesta ordem:
//
//   1. o sobrevivente recebe o que só existia nos absorvidos — campo vazio dele
//      preenchido pelo primeiro absorvido que tiver o dado, telefones somados,
//      e as observações dos absorvidos anexadas (é lá que mora o histórico de
//      produtos das fichas, que não pode sumir);
//
//   2. TUDO que aponta para o absorvido é repontado para o sobrevivente —
//      vendas, agendamentos, equipamentos, lançamentos, atividades,
//      oportunidades, fotos, conversas.
//
// O passo 2 é o que torna isso seguro. As chaves estrangeiras são
// `on delete set null`: apagar um cliente NÃO apaga a venda dele, mas deixa a
// venda sem dono — silenciosamente. Repontar antes é o que impede isso.
//
// SEMPRE grava um backup JSON de tudo que vai ser apagado, antes de apagar.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const RAIZ = path.join(AQUI, '..')
const GRAVAR = process.argv.includes('--gravar')

// Tudo que referencia clientes(id). A coluna é sempre cliente_id.
const FILHAS = ['equipamentos', 'agendamentos', 'oportunidades', 'vendas',
                'lancamentos', 'atividades', 'fotos', 'conversas']

const CAMPOS = ['nome', 'telefone', 'email', 'cpf_cnpj', 'nascimento',
  'conjuge_nome', 'conjuge_telefone', 'conjuge_cpf', 'conjuge_nascimento',
  'endereco', 'numero_complemento', 'bairro', 'cidade', 'uf', 'cep', 'foto_perfil']

const digitos = (s) => String(s || '').replace(/\D/g, '')
const preenchido = (v) => v !== null && v !== undefined && String(v).trim() !== ''

function lerEnv() {
  const env = {}
  for (const l of fs.readFileSync(path.join(RAIZ, '.env'), 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return env
}

function lerGrupos() {
  const arq = path.join(RAIZ, 'scripts', 'saida-teste', 'auditoria-duplicados.csv')
  if (!fs.existsSync(arq)) {
    console.error('Rode antes: node scripts/auditar-duplicados.mjs')
    process.exit(1)
  }
  const linhas = fs.readFileSync(arq, 'utf8').replace(/^﻿/, '').split('\n').slice(1).filter(Boolean)
  const g = new Map()
  for (const l of linhas) {
    const c = l.split(';')
    if (!g.has(c[0])) g.set(c[0], { motivo: c[1], ids: [] })
    g.get(c[0]).ids.push(c[2])
  }
  return [...g.values()]
}

const completude = (c) => CAMPOS.filter((k) => preenchido(c[k])).length +
  (Array.isArray(c.telefones) ? c.telefones.length : 0) +
  (preenchido(c.observacoes) ? 1 : 0)

async function principal() {
  const env = lerEnv()
  const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } })
  if (!env.SUPABASE_SERVICE_ROLE_KEY) { console.error('Falta SUPABASE_SERVICE_ROLE_KEY no .env'); process.exit(1) }

  const grupos = lerGrupos()
  const todosIds = grupos.flatMap((g) => g.ids)
  console.log(`${grupos.length} grupos, ${todosIds.length} cadastros envolvidos.`)
  console.log(GRAVAR ? 'MODO GRAVAÇÃO.\n' : 'MODO SIMULAÇÃO — nada será alterado.\n')

  // Carrega os cadastros inteiros
  const porId = new Map()
  for (let i = 0; i < todosIds.length; i += 200) {
    const { data, error } = await sb.from('clientes').select('*').in('id', todosIds.slice(i, i + 200))
    if (error) { console.error('Erro ao ler clientes:', error.message); process.exit(1) }
    for (const c of data) porId.set(c.id, c)
  }

  // Quantos registros filhos cada cadastro carrega
  const filhosDe = new Map(todosIds.map((id) => [id, {}]))
  const tabelasVivas = []
  for (const t of FILHAS) {
    const { data, error } = await sb.from(t).select('id,cliente_id').in('cliente_id', todosIds)
    if (error) { console.log(`  (${t}: ${error.message} — ignorada)`); continue }
    tabelasVivas.push(t)
    for (const r of data) {
      const f = filhosDe.get(r.cliente_id)
      f[t] = (f[t] || 0) + 1
    }
  }

  const planos = []
  for (const g of grupos) {
    const membros = g.ids.map((id) => porId.get(id)).filter(Boolean)
    if (membros.length < 2) continue
    const ord = [...membros].sort((a, b) =>
      completude(b) - completude(a) ||
      String(a.criado_em).localeCompare(String(b.criado_em)))
    const vivo = ord[0]
    const mortos = ord.slice(1)

    // O que o sobrevivente ganha dos absorvidos
    const patch = {}
    for (const k of CAMPOS) {
      if (preenchido(vivo[k])) continue
      const doador = mortos.find((m) => preenchido(m[k]))
      if (doador) patch[k] = doador[k]
    }
    const fones = Array.isArray(vivo.telefones) ? [...vivo.telefones] : []
    for (const m of mortos) {
      for (const t of (Array.isArray(m.telefones) ? m.telefones : [])) {
        if (t?.numero && !fones.some((x) => digitos(x.numero) === digitos(t.numero))) fones.push(t)
      }
    }
    if (fones.length !== (vivo.telefones?.length || 0)) patch.telefones = fones
    if (!preenchido(patch.telefone) && !preenchido(vivo.telefone) && fones.length) patch.telefone = fones[0].numero

    // Observações: nunca sobrescreve, sempre anexa o que era só do absorvido.
    const extras = mortos.map((m) => m.observacoes).filter(preenchido)
      .filter((o) => !String(vivo.observacoes || '').includes(o))
    if (extras.length) {
      patch.observacoes = [vivo.observacoes, ...extras.map((o) => '--- cadastro fundido ---\n' + o)]
        .filter(preenchido).join('\n')
    }

    planos.push({ motivo: g.motivo, vivo, mortos, patch })
  }

  const totalMortos = planos.reduce((s, p) => s + p.mortos.length, 0)
  const filhosARepontar = {}
  for (const p of planos) for (const m of p.mortos) {
    for (const [t, n] of Object.entries(filhosDe.get(m.id) || {})) filhosARepontar[t] = (filhosARepontar[t] || 0) + n
  }

  console.log(`${planos.length} grupos a fundir · ${totalMortos} cadastros absorvidos`)
  console.log(`Sobram ${porId.size - totalMortos} clientes no lugar dos ${porId.size} de agora.\n`)
  console.log('Registros que mudam de dono (seriam órfãos se apagássemos direto):')
  const totalFilhos = Object.values(filhosARepontar).reduce((a, b) => a + b, 0)
  if (totalFilhos === 0) console.log('  nenhum — os absorvidos não têm nada pendurado.')
  for (const [t, n] of Object.entries(filhosARepontar).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(5)}  ${t}`)
  }

  // Backup — sempre, mesmo na simulação.
  const backup = path.join(RAIZ, 'scripts', 'saida-teste', 'backup-antes-da-fusao.json')
  fs.mkdirSync(path.dirname(backup), { recursive: true })
  fs.writeFileSync(backup, JSON.stringify({
    quando: new Date().toISOString(),
    grupos: planos.map((p) => ({
      motivo: p.motivo,
      sobrevivente: p.vivo,
      absorvidos: p.mortos,
      patch: p.patch,
      filhos: p.mortos.map((m) => ({ id: m.id, ...filhosDe.get(m.id) })),
    })),
  }, null, 1), 'utf8')
  console.log(`\nBackup do estado atual: ${path.relative(RAIZ, backup)}`)

  if (!GRAVAR) {
    console.log('\nAmostra do que seria feito:')
    for (const p of planos.slice(0, 5)) {
      console.log(`\n  fica:  ${p.vivo.nome}  [${p.vivo.cpf_cnpj || 'sem doc'}]`)
      for (const m of p.mortos) console.log(`  some:  ${m.nome}  [${m.cpf_cnpj || 'sem doc'}]`)
      const ganhos = Object.keys(p.patch)
      if (ganhos.length) console.log(`  o que fica ganha: ${ganhos.join(', ')}`)
    }
    console.log('\nNada foi alterado. Rode com --gravar para aplicar.')
    return
  }

  // ---- aplicar ----
  let repontados = 0, apagados = 0
  for (const p of planos) {
    const mortosIds = p.mortos.map((m) => m.id)

    // 1. Reponta os filhos ANTES de apagar. Se algo falhar aqui, nada foi
    //    apagado ainda e o pior caso é um filho apontando para o sobrevivente
    //    com o duplicado ainda de pé — inconsistente, mas sem perda.
    for (const t of tabelasVivas) {
      const { error, count } = await sb.from(t)
        .update({ cliente_id: p.vivo.id }, { count: 'exact' })
        .in('cliente_id', mortosIds)
      if (error) { console.error(`\nFalha ao repontar ${t}: ${error.message}`); process.exit(1) }
      repontados += count || 0
    }

    // 2. Completa o sobrevivente
    if (Object.keys(p.patch).length) {
      const { error } = await sb.from('clientes').update(p.patch).eq('id', p.vivo.id)
      if (error) { console.error(`\nFalha ao completar ${p.vivo.nome}: ${error.message}`); process.exit(1) }
    }

    // 3. Só então apaga
    const { error } = await sb.from('clientes').delete().in('id', mortosIds)
    if (error) { console.error(`\nFalha ao apagar duplicados: ${error.message}`); process.exit(1) }
    apagados += mortosIds.length
    process.stdout.write(`\r  fundidos: ${apagados}/${totalMortos}`)
  }
  process.stdout.write('\r' + ' '.repeat(40) + '\r')
  console.log(`${apagados} cadastros absorvidos, ${repontados} registros repontados.`)
  console.log('Rode a auditoria de novo para conferir.')
}

principal().catch((e) => { console.error(e.stack || e.message); process.exit(1) })
