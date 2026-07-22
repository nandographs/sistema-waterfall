// Camada de dados do sistema.
// Persiste no Supabase (Postgres na nuvem). As telas usam list()/get() de
// forma síncrona, lendo de um cache em memória; carregarDados() popula esse
// cache uma vez, logo após o login (ver App.jsx). create/update/remove são
// assíncronos (fazem requisição de rede) e já atualizam o cache ao terminar.

import { supabase } from '../lib/supabaseClient.js'
import { BUCKET, comprimir, assinarUrl, assinarVarias } from '../lib/imagem.js'

const TABELAS = ['clientes', 'produtos', 'equipamentos', 'vendas', 'agendamentos']

const cache = {
  clientes: [],
  produtos: [],
  equipamentos: [],
  vendas: [],
  agendamentos: [],
}

function camelParaSnake(s) {
  return s.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase())
}

function snakeParaCamel(s) {
  return s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase())
}

// Objeto do app -> linha do banco. Strings vazias viram null (colunas de
// data/uuid/numero não aceitam ''); id e criadoEm nunca são enviados.
function paraColuna(dados) {
  const linha = {}
  for (const [chave, valor] of Object.entries(dados)) {
    if (chave === 'id' || chave === 'criadoEm') continue
    linha[camelParaSnake(chave)] = valor === '' ? null : valor
  }
  return linha
}

// Linha do banco -> objeto do app. null vira '' para os campos se comportarem
// como no localStorage (inputs controlados, comparações com truthy, etc.)
function paraApp(linha) {
  const item = {}
  for (const [chave, valor] of Object.entries(linha)) {
    item[snakeParaCamel(chave)] = valor === null ? '' : valor
  }
  return item
}

// Busca as 5 tabelas no Supabase e popula o cache em memória.
// Deve ser chamada uma vez após o login, antes de renderizar as telas.
export async function carregarDados() {
  const respostas = await Promise.all(
    TABELAS.map((tabela) => supabase.from(tabela).select('*').order('criado_em', { ascending: true })),
  )
  respostas.forEach((resposta, i) => {
    if (resposta.error) throw resposta.error
    cache[TABELAS[i]] = resposta.data.map(paraApp)
  })

  // Fotos de perfil (cliente) e de produto ficam no bucket privado; anexamos a
  // URL de exibição em cada item para as telas usarem direto (c.fotoPerfilUrl / p.fotoUrl).
  const urlsClientes = await assinarVarias(cache.clientes.map((c) => c.fotoPerfil))
  cache.clientes = cache.clientes.map((c) => ({ ...c, fotoPerfilUrl: urlsClientes[c.fotoPerfil] || '' }))
  const urlsProdutos = await assinarVarias(cache.produtos.map((p) => p.foto))
  cache.produtos = cache.produtos.map((p) => ({ ...p, fotoUrl: urlsProdutos[p.foto] || '' }))
}

function makeStore(tabela) {
  return {
    list: () => cache[tabela],
    get: (id) => cache[tabela].find((i) => i.id === id) ?? null,
    create: async (dados) => {
      const { data, error } = await supabase.from(tabela).insert(paraColuna(dados)).select().single()
      if (error) throw error
      const item = paraApp(data)
      cache[tabela] = [...cache[tabela], item]
      return item
    },
    update: async (id, dados) => {
      const { data, error } = await supabase.from(tabela).update(paraColuna(dados)).eq('id', id).select().single()
      if (error) throw error
      // Mescla sobre o item atual para preservar campos calculados que não vêm
      // do banco (ex.: fotoPerfilUrl / fotoUrl, gerados no carregamento).
      const item = { ...cache[tabela].find((i) => i.id === id), ...paraApp(data) }
      cache[tabela] = cache[tabela].map((i) => (i.id === id ? item : i))
      return item
    },
    remove: async (id) => {
      const { error } = await supabase.from(tabela).delete().eq('id', id)
      if (error) throw error
      cache[tabela] = cache[tabela].filter((i) => i.id !== id)
    },
  }
}

// Cliente: { nome, telefone, email, cpfCnpj, endereco, numeroComplemento,
//            bairro, cidade, uf, cep, observacoes,
//            criadoPor (nome de usuário de quem cadastrou; ver lib/auth.js) }
export const clientes = makeStore('clientes')

// Produto: { nome, tipo: 'aparelho' | 'refil', valor,
//            intervaloTrocaMeses (refil), aparelhoCompativelId (refil) }
export const produtos = makeStore('produtos')

// Equipamento do cliente: { clienteId, produtoId, dataInstalacao, dataUltimaTroca }
export const equipamentos = makeStore('equipamentos')

// Venda (registro financeiro): { clienteId, produtoId, valor,
//          formaPagamento: 'dinheiro'|'pix'|'cartao'|'boleto', parcelas,
//          status: 'pago'|'pendente', data, agendamentoId (origem, se veio de um agendamento) }
export const vendas = makeStore('vendas')

// Agendamento: { clienteId, data, tipo: 'instalacao'|'troca_refil'|'manutencao'|'visita',
//                status: 'agendado'|'concluido'|'cancelado', observacoes,
//                produtoIds (lista de produtos do serviço; uuid[]),
//                produtoId (1º produto — mantido p/ financeiro e Ordem de Serviço),
//                valor, formaPagamento, parcelas,
//                statusPagamento: 'pago'|'pendente', vendaId (registro financeiro vinculado),
//                osNumero, osEmitidaEm (rastreabilidade da Ordem de Serviço gerada) }
export const agendamentos = makeStore('agendamentos')

// ---- Helpers de domínio ----

export const FORMAS_PAGAMENTO = {
  dinheiro: 'Dinheiro',
  pix: 'Pix',
  cartao: 'Cartão',
  boleto: 'Boleto',
}

export const TIPOS_AGENDAMENTO = {
  instalacao: 'Instalação',
  troca_refil: 'Troca de refil',
  manutencao: 'Manutenção',
  visita: 'Visita',
}

export function formatBRL(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function formatData(iso) {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

// Monta a linha de endereço completa do cliente para exibição
export function enderecoCompleto(cliente) {
  const partes = []
  if (cliente.endereco) {
    partes.push(cliente.numeroComplemento ? `${cliente.endereco}, ${cliente.numeroComplemento}` : cliente.endereco)
  }
  if (cliente.bairro) partes.push(cliente.bairro)
  const cidadeUf = [cliente.cidade, cliente.uf].filter(Boolean).join(' - ')
  if (cidadeUf) partes.push(cidadeUf)
  if (cliente.cep) partes.push(`CEP ${cliente.cep}`)
  return partes.join(' — ')
}

// Salva um agendamento e mantém o registro financeiro (venda) vinculado em sincronia.
// Um agendamento com valor > 0 gera exatamente uma venda; cancelar ou zerar o valor a remove.
export async function salvarAgendamento(form) {
  // produtoIds é a fonte de verdade (lista); produtoId espelha o 1º, para o
  // financeiro (venda) e a Ordem de Serviço, que trabalham com um produto só.
  const produtoIds = Array.isArray(form.produtoIds)
    ? form.produtoIds.filter(Boolean)
    : (form.produtoId ? [form.produtoId] : [])
  const dados = {
    ...form,
    produtoIds,
    produtoId: produtoIds[0] || '',
    valor: Number(form.valor || 0),
    parcelas: Number(form.parcelas || 1),
  }
  const ag = form.id ? await agendamentos.update(form.id, dados) : await agendamentos.create(dados)
  return sincronizarFinanceiro(ag)
}

export async function mudarStatusAgendamento(id, status) {
  let ag = await agendamentos.update(id, { status })
  ag = await sincronizarFinanceiro(ag)
  if (status === 'concluido') await aplicarEfeitosConclusao(ag)
  return ag
}

async function sincronizarFinanceiro(ag) {
  const contabiliza = Number(ag.valor) > 0 && ag.status !== 'cancelado'
  if (contabiliza) {
    const dadosVenda = {
      clienteId: ag.clienteId,
      produtoId: ag.produtoId || '',
      valor: Number(ag.valor),
      formaPagamento: ag.formaPagamento || 'pix',
      parcelas: Number(ag.parcelas || 1),
      status: ag.statusPagamento || 'pendente',
      data: ag.data,
      agendamentoId: ag.id,
    }
    if (ag.vendaId && vendas.get(ag.vendaId)) {
      await vendas.update(ag.vendaId, dadosVenda)
      return ag
    }
    const venda = await vendas.create(dadosVenda)
    return agendamentos.update(ag.id, { vendaId: venda.id })
  }
  if (ag.vendaId) {
    await vendas.remove(ag.vendaId)
    return agendamentos.update(ag.id, { vendaId: '' })
  }
  return ag
}

// Concluir uma instalação cria o equipamento do cliente; concluir uma troca
// de refil atualiza a data da última troca do equipamento correspondente.
async function aplicarEfeitosConclusao(ag) {
  const ids = ag.produtoIds?.length ? ag.produtoIds : (ag.produtoId ? [ag.produtoId] : [])
  for (const pid of ids) {
    const produto = produtos.get(pid)
    if (!produto) continue
    if (produto.tipo === 'aparelho') {
      const jaExiste = equipamentos
        .list()
        .some((e) => e.clienteId === ag.clienteId && e.produtoId === produto.id)
      if (!jaExiste) {
        await equipamentos.create({
          clienteId: ag.clienteId,
          produtoId: produto.id,
          dataInstalacao: ag.data,
          dataUltimaTroca: '',
        })
      }
    } else if (produto.tipo === 'refil') {
      const eq = equipamentos
        .list()
        .find((e) => e.clienteId === ag.clienteId && e.produtoId === produto.aparelhoCompativelId)
      if (eq) await equipamentos.update(eq.id, { dataUltimaTroca: ag.data })
    }
  }
}

// Marca uma venda como paga (e reflete no agendamento de origem, se houver)
export async function marcarVendaPaga(vendaId) {
  const venda = await vendas.update(vendaId, { status: 'pago' })
  if (venda?.agendamentoId && agendamentos.get(venda.agendamentoId)) {
    await agendamentos.update(venda.agendamentoId, { statusPagamento: 'pago' })
  }
}

// Exclui uma venda (registro financeiro). Se ela veio de um agendamento, apenas
// desvincula: o agendamento continua no histórico, mas deixa de contar dinheiro.
// O equipamento eventualmente gerado pela venda não é tocado aqui (a tela decide).
export async function excluirVenda(vendaId) {
  const venda = vendas.get(vendaId)
  if (!venda) return
  // Desvincula o agendamento ANTES de apagar a venda: se houver referência
  // (FK) do agendamento para a venda, apagar primeiro violaria a restrição.
  if (venda.agendamentoId && agendamentos.get(venda.agendamentoId)) {
    await agendamentos.update(venda.agendamentoId, { vendaId: '' })
  }
  await vendas.remove(vendaId)
}

// Exclui uma ordem de serviço (agendamento). Só é permitido para as canceladas.
// Por segurança, remove antes qualquer venda ainda vinculada (uma OS cancelada
// normalmente já não tem venda, pois o cancelamento a removeu do financeiro).
export async function excluirAgendamento(id) {
  const ag = agendamentos.get(id)
  if (!ag) return
  if (ag.status !== 'cancelado') {
    throw new Error('Só é possível excluir ordens de serviço canceladas.')
  }
  if (ag.vendaId && vendas.get(ag.vendaId)) {
    await vendas.remove(ag.vendaId)
  }
  await agendamentos.remove(id)
}

// ---- Fotos únicas (perfil do cliente e imagem do produto) ----
// Guardadas no mesmo bucket privado, em caminhos fixos por id (upsert: cada
// novo envio sobrescreve o anterior). A coluna guarda o caminho; a URL de
// exibição é anexada ao item no cache.

async function subirImagemUnica(caminho, arquivo) {
  const comprimida = await comprimir(arquivo, { maxWidthOrHeight: 800 })
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(caminho, comprimida, { contentType: 'image/jpeg', upsert: true })
  if (error) throw error
  return assinarUrl(caminho)
}

export async function definirFotoPerfil(clienteId, arquivo) {
  const caminho = `perfil/${clienteId}.jpg`
  const url = await subirImagemUnica(caminho, arquivo)
  await clientes.update(clienteId, { fotoPerfil: caminho })
  cache.clientes = cache.clientes.map((c) => (c.id === clienteId ? { ...c, fotoPerfilUrl: url } : c))
  return url
}

export async function removerFotoPerfil(clienteId) {
  await supabase.storage.from(BUCKET).remove([`perfil/${clienteId}.jpg`])
  await clientes.update(clienteId, { fotoPerfil: '' })
  cache.clientes = cache.clientes.map((c) => (c.id === clienteId ? { ...c, fotoPerfilUrl: '' } : c))
}

export async function definirFotoProduto(produtoId, arquivo) {
  const caminho = `produto/${produtoId}.jpg`
  const url = await subirImagemUnica(caminho, arquivo)
  await produtos.update(produtoId, { foto: caminho })
  cache.produtos = cache.produtos.map((p) => (p.id === produtoId ? { ...p, fotoUrl: url } : p))
  return url
}

export async function removerFotoProduto(produtoId) {
  await supabase.storage.from(BUCKET).remove([`produto/${produtoId}.jpg`])
  await produtos.update(produtoId, { foto: '' })
  cache.produtos = cache.produtos.map((p) => (p.id === produtoId ? { ...p, fotoUrl: '' } : p))
}

// Data prevista da próxima troca de refil de um equipamento do cliente
export function proximaTroca(equipamento) {
  const produto = produtos.get(equipamento.produtoId)
  const base = equipamento.dataUltimaTroca || equipamento.dataInstalacao
  const refil = produto?.tipo === 'refil'
    ? produto
    : produtos.list().find((p) => p.tipo === 'refil' && p.aparelhoCompativelId === produto?.id)
  if (!base || !refil?.intervaloTrocaMeses) return null
  const dt = new Date(base + 'T12:00:00')
  dt.setMonth(dt.getMonth() + Number(refil.intervaloTrocaMeses))
  return dt.toISOString().slice(0, 10)
}
