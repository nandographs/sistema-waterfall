// Camada de dados do sistema.
// Persiste no Supabase (Postgres na nuvem). As telas usam list()/get() de
// forma síncrona, lendo de um cache em memória; carregarDados() popula esse
// cache uma vez, logo após o login (ver App.jsx). create/update/remove são
// assíncronos (fazem requisição de rede) e já atualizam o cache ao terminar.

import { supabase } from '../lib/supabaseClient.js'
import { BUCKET, comprimir, assinarUrl, assinarVarias } from '../lib/imagem.js'
import { somarDias, chaveOrdem } from '../lib/datas.js'
import { usuarioAtual } from '../lib/auth.js'
import { somarMeses, hojeISO, planoDeParcelas, totaisDaVenda } from './financeiro.js'

// Reexportados: as telas importam tudo do repositório.
export { somarMeses, hojeISO, planoDeParcelas, totaisDaVenda }
export { resumoDoMes, variacao, somarMesesNoMes, mesDe } from './financeiro.js'

const TABELAS = [
  'clientes', 'produtos', 'equipamentos', 'agendamentos',
  'vendas', 'venda_itens', 'lancamentos', 'atividades',
]

const cache = {
  clientes: [],
  produtos: [],
  equipamentos: [],
  agendamentos: [],
  vendas: [],
  venda_itens: [],
  lancamentos: [],
  atividades: [],
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

// Atividades crescem num ritmo diferente do resto: clientes e produtos são
// centenas, mas atividades são várias por dia, todo dia. Trazer o histórico
// inteiro a cada login iria ficando mais lento a cada ano.
//
// Então carregamos a janela recente MAIS tudo que estiver pendente, seja de
// quando for — uma tarefa esquecida há oito meses precisa continuar aparecendo,
// que é justamente quando ela mais importa.
const JANELA_ATIVIDADES_DIAS = 365

// Qual arquivo cria cada tabela — para o erro de "tabela não encontrada"
// mandar você para a migração certa em vez de sempre para a primeira.
const MIGRACAO_DA_TABELA = {
  lancamentos: 'sql/001_vendas_financeiro.sql',
  vendas: 'sql/001_vendas_financeiro.sql',
  venda_itens: 'sql/001_vendas_financeiro.sql',
  atividades: 'sql/005_agenda_atividades.sql',
}

function consultar(tabela) {
  const consulta = supabase.from(tabela).select('*')
  if (tabela === 'atividades') {
    const desde = somarDias(hojeISO(), -JANELA_ATIVIDADES_DIAS)
    consulta.or(`data.gte.${desde},status.eq.pendente`)
  }
  return consulta.order('criado_em', { ascending: true })
}

// Busca as tabelas no Supabase e popula o cache em memória.
// Deve ser chamada uma vez após o login, antes de renderizar as telas.
export async function carregarDados() {
  const respostas = await Promise.all(TABELAS.map(consultar))
  respostas.forEach((resposta, i) => {
    if (resposta.error) {
      // Tabela não encontrada. São dois casos com a mesma cara:
      //   42P01   — o Postgres não tem a tabela: a migração não rodou.
      //   PGRST205 — a tabela existe, mas o cache de schema do PostgREST está
      //              velho e a API ainda não a enxerga.
      // O erro cru não ajuda em nada, então apontamos a saída de cada um.
      const naoEncontrada = resposta.error.code === '42P01' || resposta.error.code === 'PGRST205'
      if (naoEncontrada) {
        const migracao = MIGRACAO_DA_TABELA[TABELAS[i]] ?? 'sql/001_vendas_financeiro.sql'
        throw new Error(
          `A tabela "${TABELAS[i]}" não foi encontrada. ` +
          `Se você ainda não rodou a migração, rode ${migracao} no ` +
          'SQL Editor do Supabase. Se já rodou, o cache da API está desatualizado: ' +
          "execute NOTIFY pgrst, 'reload schema'; e recarregue esta página.",
        )
      }
      throw resposta.error
    }
    cache[TABELAS[i]] = resposta.data.map(paraApp)
  })

  // Fotos de perfil (cliente) e de produto ficam no bucket privado; anexamos a
  // URL de exibição em cada item para as telas usarem direto (c.fotoPerfilUrl / p.fotoUrl).
  const urlsClientes = await assinarVarias(cache.clientes.map((c) => c.fotoPerfil))
  cache.clientes = cache.clientes.map((c) => ({ ...c, fotoPerfilUrl: urlsClientes[c.fotoPerfil] || '' }))
  const urlsProdutos = await assinarVarias(cache.produtos.map((p) => p.foto))
  cache.produtos = cache.produtos.map((p) => ({ ...p, fotoUrl: urlsProdutos[p.foto] || '' }))
}

// Descarta do cache em memória o que o banco já apagou por cascata (ex.: os
// itens e lançamentos de uma venda excluída), para as telas não exibirem
// registros órfãos até o próximo carregamento.
function removerDoCache(tabela, condicao) {
  cache[tabela] = cache[tabela].filter((item) => !condicao(item))
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

// Produto: { nome, codigo (SKU/referência, opcional — usado na busca),
//            tipo: 'aparelho' | 'refil', valor,
//            intervaloTrocaMeses (refil), aparelhoCompativelId (refil) }
export const produtos = makeStore('produtos')

// Equipamento do cliente: { clienteId, produtoId, dataInstalacao, dataUltimaTroca }
export const equipamentos = makeStore('equipamentos')

// Venda (documento comercial): { numero, clienteId, data, validadeDias,
//          tipo: 'venda'|'orcamento', canal, status: 'proposta'|'confirmada'|'cancelada',
//          subtotal, desconto, frete, total,
//          formaPagamento, condicao: 'a_vista'|'parcelado', entrada, parcelas, primeiroVencimento,
//          consultor, consultorTelefone, distribuidor, distribuidorTelefone,
//          entregaTipo, entregaEndereco, entregaPrevisao, observacoes,
//          pedidoNumero, pedidoEmitidoEm (rastreabilidade do documento gerado) }
export const vendas = makeStore('vendas')

// Item da venda: { vendaId, produtoId, descricao, quantidade, valorUnitario,
//                  desconto, valorTotal, ordem }
export const vendaItens = makeStore('venda_itens')

// Lançamento (o caixa único): { tipo: 'entrada'|'saida', status: 'previsto'|'realizado',
//          descricao, categoria, valor, vencimento, dataPagamento, formaPagamento,
//          parcela, parcelas, origem: 'venda'|'agendamento'|'manual',
//          clienteId, vendaId, agendamentoId, observacoes }
// Toda cobrança do sistema — venda ou agendamento avulso — vira lançamento aqui.
// Uma venda em 3x gera 3 lançamentos, cada um com seu vencimento.
export const lancamentos = makeStore('lancamentos')

// Atividade (o diário de trabalho): { data, hora, duracaoMin,
//          tipo: 'ligacao'|'whatsapp'|'email'|'visita'|'reuniao'|'tarefa'|'nota',
//          titulo, descricao, status: 'pendente'|'concluida'|'cancelada',
//          resultado: 'sucesso'|'retornar'|'sem_resposta'|'recusado', concluidaEm,
//          clienteId (opcional — tarefa interna não tem cliente), responsavel,
//          origemAtividadeId, agendamentoId, vendaId }
// Uma atividade PENDENTE é uma tarefa; concluída, vira histórico. São a mesma
// coisa em momentos diferentes — ver o comentário da migração 005.
export const atividades = makeStore('atividades')

// Agendamento: { clienteId, data, hora, tipo: 'instalacao'|'troca_refil'|'manutencao'|'visita',
//                status: 'agendado'|'concluido'|'cancelado', observacoes,
//                produtoIds (lista de produtos do serviço; uuid[]),
//                produtoId (1º produto — mantido p/ financeiro e Ordem de Serviço),
//                valor, formaPagamento, parcelas,
//                statusPagamento: 'pago'|'pendente', lancamentoId (1º lançamento vinculado),
//                vendaOrigemId (venda que gerou este agendamento, se houver),
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

export const TIPOS_ATIVIDADE = {
  ligacao: 'Ligação',
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  visita: 'Visita',
  reuniao: 'Reunião',
  tarefa: 'Tarefa',
  nota: 'Anotação',
}

// Como o contato terminou. `retornar` é especial: escolhê-lo obriga a marcar a
// data da volta (ver salvarAtividade) — é a regra que impede um cliente de
// simplesmente sumir da sua cabeça depois de um "me liga semana que vem".
export const RESULTADOS_ATIVIDADE = {
  sucesso: 'Resolvido',
  retornar: 'Retornar depois',
  sem_resposta: 'Sem resposta',
  recusado: 'Sem interesse',
}

// Anotação não é tarefa: ela nasce concluída, porque é o registro de algo que
// já aconteceu, não algo a fazer.
export const TIPOS_SEM_PENDENCIA = ['nota']

export const STATUS_VENDA = {
  proposta: 'Proposta',
  confirmada: 'Confirmada',
  cancelada: 'Cancelada',
}

export const CANAIS_VENDA = {
  loja: 'Loja',
  whatsapp: 'WhatsApp',
  telefone: 'Telefone',
  externo: 'Externo',
}

// Categorias das saídas (contas a pagar). As entradas usam 'venda' ou 'servico'.
export const CATEGORIAS_SAIDA = {
  fornecedor: 'Fornecedor',
  estoque: 'Compra de estoque',
  salario: 'Salários e pró-labore',
  imposto: 'Impostos e taxas',
  aluguel: 'Aluguel',
  veiculo: 'Veículo e combustível',
  marketing: 'Marketing',
  outros: 'Outros',
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

// ---- Caixa: sincronia ----

// Reconcilia os lançamentos de uma origem (venda ou agendamento) com o plano
// recalculado. Casa parcela a parcela para PRESERVAR as baixas já dadas — quem
// já pagou continua pago mesmo se o valor ou a data mudarem depois.
async function sincronizarLancamentos(vinculo, plano) {
  const chave = 'vendaId' in vinculo ? 'vendaId' : 'agendamentoId'
  const alvo = vinculo[chave]

  const atuais = lancamentos
    .list()
    .filter((l) => l[chave] === alvo)
    .sort((a, b) => Number(a.parcela || 0) - Number(b.parcela || 0))

  const total = Math.max(atuais.length, plano.length)
  for (let i = 0; i < total; i++) {
    const existente = atuais[i]
    const novo = plano[i]

    if (existente && novo) {
      const dados = { ...novo }
      if (existente.status === 'realizado') {
        dados.status = 'realizado'
        dados.dataPagamento = existente.dataPagamento
      }
      await lancamentos.update(existente.id, dados)
    } else if (novo) {
      await lancamentos.create({ ...novo, ...vinculo })
    } else {
      await lancamentos.remove(existente.id)
    }
  }

  return lancamentos.list().filter((l) => l[chave] === alvo)
}

// ---- Vendas ----

// Grava a venda, seus itens e o financeiro correspondente.
//
// Só venda CONFIRMADA vira dinheiro no caixa: uma proposta ainda não é receita,
// e cancelar limpa os lançamentos previstos (os já pagos são preservados pela
// sincronização, para não sumir com dinheiro que de fato entrou).
// `opcoes.agendarServicos = false` para quando a tela já cuida do serviço por
// conta própria (ex.: o cadastro rápido do cliente, que registra um aparelho
// que JÁ está instalado e portanto não precisa de visita de instalação).
export async function salvarVenda(form, itensForm, opcoes = {}) {
  const itens = (itensForm || []).filter((item) => item.produtoId || String(item.descricao || '').trim())
  const { subtotal, total } = totaisDaVenda(itens, form.desconto, form.frete)

  const dados = {
    ...form,
    subtotal,
    total,
    desconto: Number(form.desconto || 0),
    frete: Number(form.frete || 0),
    entrada: Number(form.entrada || 0),
    parcelas: Math.max(1, Number(form.parcelas || 1)),
    validadeDias: form.validadeDias === '' ? '' : Number(form.validadeDias),
  }
  delete dados.itens

  const venda = form.id ? await vendas.update(form.id, dados) : await vendas.create(dados)

  // Itens não têm estado próprio (nada de pagamento neles), então regravar é
  // mais simples e seguro do que reconciliar linha a linha.
  for (const antigo of vendaItens.list().filter((i) => i.vendaId === venda.id)) {
    await vendaItens.remove(antigo.id)
  }
  let ordem = 0
  for (const item of itens) {
    const bruto = Number(item.quantidade || 0) * Number(item.valorUnitario || 0)
    await vendaItens.create({
      vendaId: venda.id,
      produtoId: item.produtoId || '',
      descricao: item.descricao || produtos.get(item.produtoId)?.nome || '',
      quantidade: Number(item.quantidade || 1),
      valorUnitario: Number(item.valorUnitario || 0),
      desconto: Number(item.desconto || 0),
      valorTotal: Math.max(0, bruto - Number(item.desconto || 0)),
      ordem: ordem++,
    })
  }

  const plano = venda.status === 'confirmada'
    ? planoDeParcelas({
        descricao: `Venda ${venda.numero || ''}`.trim(),
        clienteId: venda.clienteId,
        total: venda.total,
        entrada: venda.entrada,
        parcelas: venda.condicao === 'parcelado' ? venda.parcelas : 1,
        primeiroVencimento: venda.primeiroVencimento,
        data: venda.data,
        formaPagamento: venda.formaPagamento,
        origem: 'venda',
      })
    : []
  await sincronizarLancamentos({ vendaId: venda.id }, plano)

  if (venda.status === 'confirmada' && opcoes.agendarServicos !== false) {
    await agendarServicosDaVenda(venda)
  }

  return venda
}

// Confirmar uma venda já deixa o serviço na agenda: aparelho vendido vira uma
// instalação; refil vendido sozinho vira uma troca.
//
// O agendamento nasce com valor ZERO de propósito — quem cobra é a venda. Se
// ele tivesse valor, geraria lançamentos próprios e o mesmo dinheiro apareceria
// duas vezes no caixa.
export async function agendarServicosDaVenda(venda) {
  const jaAgendado = agendamentos.list().some((a) => a.vendaOrigemId === venda.id)
  if (jaAgendado) return []

  const itens = itensDaVenda(venda.id)
  const produtosVendidos = itens.map((i) => produtos.get(i.produtoId)).filter(Boolean)
  const aparelhos = produtosVendidos.filter((p) => p.tipo === 'aparelho')
  const refis = produtosVendidos.filter((p) => p.tipo === 'refil')

  // A data de referência é quando o produto chega ao cliente.
  const dataBase = venda.entregaPrevisao || venda.data || hojeISO()
  const criados = []

  // Aparelho na venda: instala tudo numa visita só. Sem aparelho, mas com
  // refil: é uma troca.
  const alvo = aparelhos.length
    ? { tipo: 'instalacao', produtos: [...aparelhos, ...refis] }
    : (refis.length ? { tipo: 'troca_refil', produtos: refis } : null)
  if (!alvo) return []

  criados.push(await agendamentos.create({
    clienteId: venda.clienteId,
    data: dataBase,
    tipo: alvo.tipo,
    status: 'agendado',
    observacoes: `Gerado pela venda ${venda.numero || ''}`.trim(),
    produtoIds: alvo.produtos.map((p) => p.id),
    produtoId: alvo.produtos[0].id,
    valor: 0,
    formaPagamento: venda.formaPagamento || 'pix',
    parcelas: 1,
    statusPagamento: 'pendente',
    vendaOrigemId: venda.id,
  }))

  // Vender o aparelho já deixa a primeira troca de refil na agenda, contada a
  // partir da entrega — sem esperar a instalação ser concluída. Se a instalação
  // atrasar, é só remarcar; concluí-la não duplica, porque já existe uma aberta.
  for (const aparelho of aparelhos) {
    const troca = await agendarTrocaDeRefil({
      clienteId: venda.clienteId,
      refil: refilDoAparelho(aparelho),
      dataBase,
      observacoes: `1ª troca de refil do ${aparelho.nome}.`,
    })
    if (troca) criados.push(troca)
  }

  return criados
}

export function itensDaVenda(vendaId) {
  return vendaItens
    .list()
    .filter((i) => i.vendaId === vendaId)
    .sort((a, b) => Number(a.ordem || 0) - Number(b.ordem || 0))
}

export function lancamentosDaVenda(vendaId) {
  return lancamentos
    .list()
    .filter((l) => l.vendaId === vendaId)
    .sort((a, b) => Number(a.parcela || 0) - Number(b.parcela || 0))
}

// Exclui a venda inteira. No banco os itens e os lançamentos caem por cascata
// (ver a migração); aqui limpamos o cache em memória para as telas acompanharem.
export async function excluirVenda(vendaId) {
  await vendas.remove(vendaId)
  removerDoCache('venda_itens', (i) => i.vendaId === vendaId)
  removerDoCache('lancamentos', (l) => l.vendaId === vendaId)
}

// ---- Lançamentos (caixa) ----

// Marca um lançamento como recebido/pago. Reflete no agendamento de origem para
// o rótulo "Pago / A receber" da tela de agendamentos continuar coerente.
export async function darBaixa(lancamentoId, dataPagamento) {
  const lancamento = await lancamentos.update(lancamentoId, {
    status: 'realizado',
    dataPagamento: dataPagamento || hojeISO(),
  })
  await refletirPagamentoNoAgendamento(lancamento)
  return lancamento
}

// Desfaz a baixa (voltou a ser previsto).
export async function estornarLancamento(lancamentoId) {
  const lancamento = await lancamentos.update(lancamentoId, {
    status: 'previsto',
    dataPagamento: '',
  })
  await refletirPagamentoNoAgendamento(lancamento)
  return lancamento
}

async function refletirPagamentoNoAgendamento(lancamento) {
  if (!lancamento?.agendamentoId || !agendamentos.get(lancamento.agendamentoId)) return
  const doAgendamento = lancamentos.list().filter((l) => l.agendamentoId === lancamento.agendamentoId)
  const tudoPago = doAgendamento.length > 0 && doAgendamento.every((l) => l.status === 'realizado')
  await agendamentos.update(lancamento.agendamentoId, {
    statusPagamento: tudoPago ? 'pago' : 'pendente',
  })
}

// Lançamento avulso (conta a pagar, despesa, entrada manual).
export async function salvarLancamento(form) {
  const dados = {
    ...form,
    valor: Number(form.valor || 0),
    parcela: Number(form.parcela || 1),
    parcelas: Number(form.parcelas || 1),
    origem: form.origem || 'manual',
  }
  return form.id ? lancamentos.update(form.id, dados) : lancamentos.create(dados)
}

export async function excluirLancamento(id) {
  await lancamentos.remove(id)
}

// Salva um agendamento e mantém o financeiro vinculado em sincronia.
// Um agendamento com valor > 0 gera lançamentos a receber; cancelar ou zerar o
// valor os remove.
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

// `dataConclusao` permite registrar um serviço feito em outro dia; sem ela,
// vale hoje. É essa data — e não a data em que o serviço estava marcado — que
// inicia a contagem do próximo refil.
export async function mudarStatusAgendamento(id, status, dataConclusao) {
  const extra = status === 'concluido' ? { concluidoEm: dataConclusao || hojeISO() } : {}
  let ag = await agendamentos.update(id, { status, ...extra })
  ag = await sincronizarFinanceiro(ag)
  if (status === 'concluido') await aplicarEfeitosConclusao(ag)
  return ag
}

// Um agendamento com valor vira lançamentos a receber (um por parcela).
// Cancelar ou zerar o valor os remove; baixas já dadas são preservadas pela
// sincronização.
async function sincronizarFinanceiro(ag) {
  const contabiliza = Number(ag.valor) > 0 && ag.status !== 'cancelado'

  const plano = contabiliza
    ? planoDeParcelas({
        descricao: TIPOS_AGENDAMENTO[ag.tipo] ?? 'Serviço',
        clienteId: ag.clienteId,
        total: ag.valor,
        parcelas: ag.parcelas,
        primeiroVencimento: ag.data,
        data: ag.data,
        formaPagamento: ag.formaPagamento,
        origem: 'agendamento',
        categoria: 'servico',
      })
    : []

  // O agendamento tem um único interruptor "Pago / A receber"; quando marcado
  // como pago, todas as parcelas já nascem baixadas.
  if (contabiliza && ag.statusPagamento === 'pago') {
    for (const linha of plano) {
      linha.status = 'realizado'
      linha.dataPagamento = ag.data || hojeISO()
    }
  }

  const gerados = await sincronizarLancamentos({ agendamentoId: ag.id }, plano)
  const primeiro = gerados[0]?.id || ''
  if ((ag.lancamentoId || '') !== primeiro) {
    return agendamentos.update(ag.id, { lancamentoId: primeiro })
  }
  return ag
}

// Concluir uma instalação cria o equipamento do cliente; concluir uma troca de
// refil atualiza a data da última troca. Nos dois casos, a PRÓXIMA troca já sai
// agendada — é o ciclo que faz o cliente nunca ficar sem refil.
//
// A contagem parte de `concluidoEm` (quando o serviço aconteceu de verdade) e
// não da data em que ele estava marcado: a vida do filtro começa quando ele é
// instalado, não quando foi agendado.
async function aplicarEfeitosConclusao(ag) {
  const base = ag.concluidoEm || ag.data
  const ids = ag.produtoIds?.length ? ag.produtoIds : (ag.produtoId ? [ag.produtoId] : [])

  for (const pid of ids) {
    const produto = produtos.get(pid)
    if (!produto) continue

    if (produto.tipo === 'aparelho') {
      const jaTem = equipamentos
        .list()
        .find((e) => e.clienteId === ag.clienteId && e.produtoId === produto.id)
      if (!jaTem) {
        await equipamentos.create({
          clienteId: ag.clienteId,
          produtoId: produto.id,
          dataInstalacao: base,
          dataUltimaTroca: '',
        })
      }
      const refil = refilDoAparelho(produto)
      await realinharTrocaComAInstalacao(ag, refil, base)
      await agendarTrocaDeRefil({ clienteId: ag.clienteId, refil, dataBase: base })
    } else if (produto.tipo === 'refil') {
      const eq = equipamentos
        .list()
        .find((e) => e.clienteId === ag.clienteId && e.produtoId === produto.aparelhoCompativelId)
      if (eq) await equipamentos.update(eq.id, { dataUltimaTroca: base })
      // A próxima troca é agendada mesmo sem equipamento cadastrado: o que
      // determina o ciclo é o refil e a data em que ele foi trocado.
      await agendarTrocaDeRefil({ clienteId: ag.clienteId, refil: produto, dataBase: base })
    }
  }
}

// A primeira troca é agendada já na venda, contando a partir da data prevista
// de entrega. Se a instalação acabou acontecendo em outro dia, essa data ficou
// desatualizada — o filtro começou a viver depois.
//
// Só reajusta se a data ainda for exatamente a calculada na venda, ou seja, se
// ninguém a moveu à mão. Uma troca que você adiantou continua onde você pôs.
async function realinharTrocaComAInstalacao(agendamentoInstalacao, refil, dataConclusao) {
  if (!refil?.intervaloTrocaMeses || !agendamentoInstalacao.data) return
  if (agendamentoInstalacao.data === dataConclusao) return

  const meses = Number(refil.intervaloTrocaMeses)
  const comoFoiCalculada = somarMeses(agendamentoInstalacao.data, meses)

  const aberta = agendamentos.list().find((a) =>
    a.clienteId === agendamentoInstalacao.clienteId &&
    a.status === 'agendado' &&
    a.tipo === 'troca_refil' &&
    (a.produtoIds || []).includes(refil.id),
  )
  if (!aberta || aberta.data !== comoFoiCalculada) return

  await agendamentos.update(aberta.id, { data: somarMeses(dataConclusao, meses) })
}

// O refil cadastrado como compatível com um aparelho.
export function refilDoAparelho(aparelho) {
  if (!aparelho || aparelho.tipo !== 'aparelho') return null
  return produtos.list().find((p) => p.tipo === 'refil' && p.aparelhoCompativelId === aparelho.id) ?? null
}

// Agenda a próxima troca de um refil: `dataBase` + o intervalo cadastrado.
//
// Não duplica: se o cliente já tem uma troca EM ABERTO daquele refil, nada é
// criado — assim o agendamento que você adiantou ou remarcou à mão continua
// valendo. Um agendamento cancelado não conta como aberto, então cancelar
// encerra o ciclo (é exatamente o que se espera de um cancelamento).
export async function agendarTrocaDeRefil({ clienteId, refil, dataBase, observacoes }) {
  if (!clienteId || !refil?.intervaloTrocaMeses || !dataBase) return null

  const jaEmAberto = agendamentos.list().some((a) =>
    a.clienteId === clienteId &&
    a.status === 'agendado' &&
    a.tipo === 'troca_refil' &&
    (a.produtoIds || []).includes(refil.id),
  )
  if (jaEmAberto) return null

  return agendamentos.create({
    clienteId,
    data: somarMeses(dataBase, Number(refil.intervaloTrocaMeses)),
    tipo: 'troca_refil',
    status: 'agendado',
    observacoes: observacoes || 'Troca programada automaticamente.',
    produtoIds: [refil.id],
    produtoId: refil.id,
    // Sem valor de propósito: o serviço ainda não foi feito, e lançar dinheiro
    // aqui encheria o "A receber" de receita que ninguém deve ainda. O valor é
    // preenchido quando a troca for realizada.
    valor: 0,
    formaPagamento: 'pix',
    parcelas: 1,
    statusPagamento: 'pendente',
  })
}

// Mantida para quem chama a partir de um equipamento (ex.: cadastro rápido de
// venda na ficha do cliente).
export async function agendarProximaTroca(equipamento) {
  return agendarTrocaDeRefil({
    clienteId: equipamento?.clienteId,
    refil: refilDoEquipamento(equipamento),
    dataBase: equipamento?.dataUltimaTroca || equipamento?.dataInstalacao,
  })
}

// Exclui uma ordem de serviço (agendamento). Só é permitido para as canceladas.
// Os lançamentos vinculados são removidos junto (uma OS cancelada normalmente
// já não tem nenhum, pois o cancelamento os tirou do caixa).
export async function excluirAgendamento(id) {
  const ag = agendamentos.get(id)
  if (!ag) return
  if (ag.status !== 'cancelado') {
    throw new Error('Só é possível excluir ordens de serviço canceladas.')
  }
  for (const l of lancamentos.list().filter((l) => l.agendamentoId === id)) {
    await lancamentos.remove(l.id)
  }
  await agendamentos.remove(id)
}

// Move um serviço para outro dia. Passa pela sincronização do financeiro
// porque o vencimento das parcelas é calculado a partir da data do agendamento
// — remarcar sem isso deixaria a cobrança vencendo no dia antigo.
export async function remarcarAgendamento(id, data, hora) {
  const ag = agendamentos.get(id)
  if (!ag) return null
  const atualizado = await agendamentos.update(id, { data, hora: hora || '' })
  return sincronizarFinanceiro(atualizado)
}

// ---- Atividades: o diário de trabalho ----

const precisaDeRetorno = (a) => a.status === 'concluida' && a.resultado === 'retornar'

function tituloPadrao(form) {
  const rotulo = TIPOS_ATIVIDADE[form.tipo] ?? 'Atividade'
  const cliente = clientes.get(form.clienteId)
  return cliente ? `${rotulo} — ${cliente.nome}` : rotulo
}

// Cria (ou remarca) a atividade de retorno ligada a uma que acabou de ser
// concluída. Reeditar a mesma atividade não pode gerar um segundo retorno, por
// isso um desdobramento ainda em aberto é ATUALIZADO em vez de duplicado.
async function marcarRetorno(origem, retorno) {
  const cliente = clientes.get(origem.clienteId)
  const dados = {
    data: retorno.data,
    hora: retorno.hora || '',
    tipo: retorno.tipo || (origem.tipo === 'nota' ? 'ligacao' : origem.tipo),
    titulo: retorno.titulo || `Retornar — ${cliente?.nome || origem.titulo || 'contato'}`,
    descricao: retorno.descricao || '',
    status: 'pendente',
    clienteId: origem.clienteId || '',
    responsavel: origem.responsavel || usuarioAtual(),
    criadoPor: usuarioAtual(),
    origemAtividadeId: origem.id,
  }

  const emAberto = atividades
    .list()
    .find((a) => a.origemAtividadeId === origem.id && a.status === 'pendente')

  return emAberto ? atividades.update(emAberto.id, dados) : atividades.create(dados)
}

// Grava uma atividade. `retorno` ({ data, hora, titulo }) é o próximo passo.
//
// A REGRA DO PRÓXIMO PASSO: concluir com resultado "retornar depois" SEM data de
// retorno é recusado aqui, na camada de dados, e não só no formulário — assim a
// regra vale para todas as telas que criam atividade (agenda, dashboard, ficha
// do cliente) sem precisar ser repetida em cada uma.
export async function salvarAtividade(form, retorno) {
  const concluida = form.status === 'concluida'
  const dados = {
    ...form,
    tipo: form.tipo || 'ligacao',
    status: form.status || 'pendente',
    titulo: String(form.titulo || '').trim() || tituloPadrao(form),
    hora: form.hora || '',
    duracaoMin: form.duracaoMin === '' || form.duracaoMin == null ? '' : Number(form.duracaoMin),
    // Resultado e data de conclusão só existem em atividade concluída; reabrir
    // uma tarefa tem que limpar os dois, senão fica um rastro que mente.
    resultado: concluida ? (form.resultado || '') : '',
    concluidaEm: concluida ? (form.concluidaEm || hojeISO()) : '',
    responsavel: form.responsavel || usuarioAtual(),
    criadoPor: form.criadoPor || usuarioAtual(),
  }

  if (precisaDeRetorno(dados) && !retorno?.data) {
    throw new Error(
      'Marque a data do retorno: uma atividade que termina em "retornar depois" ' +
      'precisa deixar o próximo passo agendado.',
    )
  }

  const atividade = form.id ? await atividades.update(form.id, dados) : await atividades.create(dados)

  if (precisaDeRetorno(atividade) && retorno?.data) {
    await marcarRetorno(atividade, retorno)
  }

  return atividade
}

// Conclui uma atividade registrando o desfecho. `retorno` segue a mesma regra
// de salvarAtividade.
export async function concluirAtividade(id, { resultado, descricao, retorno } = {}) {
  const atual = atividades.get(id)
  if (!atual) return null
  return salvarAtividade(
    {
      ...atual,
      status: 'concluida',
      resultado: resultado || atual.resultado || 'sucesso',
      descricao: descricao ?? atual.descricao,
      concluidaEm: hojeISO(),
    },
    retorno,
  )
}

export async function remarcarAtividade(id, data, hora) {
  return atividades.update(id, { data, hora: hora || '' })
}

export async function cancelarAtividade(id) {
  return atividades.update(id, { status: 'cancelada', resultado: '', concluidaEm: '' })
}

export async function reabrirAtividade(id) {
  return atividades.update(id, { status: 'pendente', resultado: '', concluidaEm: '' })
}

export async function excluirAtividade(id) {
  await atividades.remove(id)
}

// ---- A corrente: de onde veio, no que deu ----

export function origemDe(registro) {
  const id = registro?.origemAtividadeId
  return id ? atividades.get(id) : null
}

// A trilha até a raiz, da mais antiga para a mais recente. O limite e o
// controle de repetidos são proteção contra ciclo: um vínculo circular no banco
// não pode travar a tela num laço infinito.
export function trilhaDeOrigem(registro, limite = 10) {
  const trilha = []
  const vistos = new Set()
  let atual = origemDe(registro)
  while (atual && !vistos.has(atual.id) && trilha.length < limite) {
    vistos.add(atual.id)
    trilha.unshift(atual)
    atual = origemDe(atual)
  }
  return trilha
}

// O que nasceu de uma atividade: outras atividades, serviços e vendas.
export function desdobramentosDe(atividadeId) {
  if (!atividadeId) return { atividades: [], agendamentos: [], vendas: [] }
  return {
    atividades: atividades.list().filter((a) => a.origemAtividadeId === atividadeId),
    agendamentos: agendamentos.list().filter((a) => a.origemAtividadeId === atividadeId),
    vendas: vendas.list().filter((v) => v.origemAtividadeId === atividadeId),
  }
}

// ---- Agenda: a visão unificada ----

// Um "evento" é o formato comum entre coisas de origens diferentes que dividem
// o mesmo calendário. A tela desenha eventos e não precisa saber se por trás
// está uma atividade, um serviço em campo ou uma conta a vencer.
export const FONTES_AGENDA = {
  atividade: 'Atividades',
  agendamento: 'Serviços',
  vencimento: 'Vencimentos',
}

export const FONTES_PADRAO = ['atividade', 'agendamento']

function eventoDaAtividade(a) {
  return {
    id: `atividade:${a.id}`,
    fonte: 'atividade',
    registro: a,
    data: a.data,
    hora: a.hora || '',
    tipo: a.tipo,
    titulo: a.titulo || TIPOS_ATIVIDADE[a.tipo] || 'Atividade',
    detalhe: clientes.get(a.clienteId)?.nome || '',
    clienteId: a.clienteId || '',
    responsavel: a.responsavel || '',
    pendente: a.status === 'pendente',
    concluido: a.status === 'concluida',
    cancelado: a.status === 'cancelada',
  }
}

function eventoDoAgendamento(ag) {
  return {
    id: `agendamento:${ag.id}`,
    fonte: 'agendamento',
    registro: ag,
    data: ag.data,
    hora: ag.hora || '',
    tipo: ag.tipo,
    titulo: TIPOS_AGENDAMENTO[ag.tipo] ?? ag.tipo,
    detalhe: clientes.get(ag.clienteId)?.nome ?? '(cliente removido)',
    clienteId: ag.clienteId || '',
    responsavel: '',
    pendente: ag.status === 'agendado',
    concluido: ag.status === 'concluido',
    cancelado: ag.status === 'cancelado',
  }
}

function eventoDoLancamento(l) {
  const entrada = l.tipo === 'entrada'
  return {
    id: `vencimento:${l.id}`,
    fonte: 'vencimento',
    registro: l,
    data: l.vencimento,
    hora: '',
    tipo: l.tipo,
    titulo: l.descricao || (entrada ? 'A receber' : 'A pagar'),
    detalhe: clientes.get(l.clienteId)?.nome || '',
    clienteId: l.clienteId || '',
    responsavel: '',
    valor: Number(l.valor || 0),
    pendente: l.status === 'previsto',
    concluido: l.status === 'realizado',
    cancelado: false,
  }
}

const ordenarEventos = (lista) => lista.sort((a, b) => chaveOrdem(a).localeCompare(chaveOrdem(b)))

// Eventos de um intervalo de datas (ISO, inclusivo nas duas pontas).
// Vencimentos ficam fora por padrão: são dinheiro, não compromisso, e
// poluiriam a agenda de trabalho de quem só quer saber o que fazer no dia.
export function eventosNoPeriodo(de, ate, fontes = FONTES_PADRAO) {
  const dentro = (iso) => !!iso && iso >= de && iso <= ate
  const eventos = []

  if (fontes.includes('atividade')) {
    for (const a of atividades.list()) if (dentro(a.data)) eventos.push(eventoDaAtividade(a))
  }
  if (fontes.includes('agendamento')) {
    for (const ag of agendamentos.list()) if (dentro(ag.data)) eventos.push(eventoDoAgendamento(ag))
  }
  if (fontes.includes('vencimento')) {
    for (const l of lancamentos.list()) if (dentro(l.vencimento)) eventos.push(eventoDoLancamento(l))
  }

  return ordenarEventos(eventos)
}

export function eventosDoDia(dia, fontes = FONTES_PADRAO) {
  return eventosNoPeriodo(dia, dia, fontes)
}

// Agrupados por data — o formato que a grade do calendário consome.
export function eventosPorDia(de, ate, fontes = FONTES_PADRAO) {
  const mapa = new Map()
  for (const evento of eventosNoPeriodo(de, ate, fontes)) {
    if (!mapa.has(evento.data)) mapa.set(evento.data, [])
    mapa.get(evento.data).push(evento)
  }
  return mapa
}

// Pendências que ficaram para trás.
//
// Elas aparecem no topo do dia de HOJE, e não no dia em que foram marcadas —
// senão uma tarefa esquecida sai do campo de visão para sempre. É assim que uma
// agenda costuma falhar, e é o que este bloco existe para evitar.
export function pendenciasAtrasadas(ate = hojeISO(), fontes = FONTES_PADRAO) {
  const eventos = []
  if (fontes.includes('atividade')) {
    for (const a of atividades.list()) {
      if (a.status === 'pendente' && a.data && a.data < ate) eventos.push(eventoDaAtividade(a))
    }
  }
  if (fontes.includes('agendamento')) {
    for (const ag of agendamentos.list()) {
      if (ag.status === 'agendado' && ag.data && ag.data < ate) eventos.push(eventoDoAgendamento(ag))
    }
  }
  return ordenarEventos(eventos)
}

// A próxima coisa marcada para um cliente — inclusive se estiver atrasada, que
// continua sendo o próximo passo, só que tarde. Um cliente sem próximo passo é
// um cliente que você vai esquecer; a ficha destaca essa ausência.
export function proximoPasso(clienteId) {
  if (!clienteId) return null
  const eventos = [
    ...atividades
      .list()
      .filter((a) => a.clienteId === clienteId && a.status === 'pendente' && a.data)
      .map(eventoDaAtividade),
    ...agendamentos
      .list()
      .filter((a) => a.clienteId === clienteId && a.status === 'agendado' && a.data)
      .map(eventoDoAgendamento),
  ]
  const proximo = ordenarEventos(eventos)[0]
  return proximo ? { ...proximo, atrasado: proximo.data < hojeISO() } : null
}

// Tudo o que já aconteceu com um cliente, do mais recente para o mais antigo:
// contatos, serviços, vendas e pagamentos. É aqui que "o cliente falou tal
// coisa" fica consultável — antes de ligar você lê os últimos itens e sabe
// exatamente onde a conversa parou.
export function linhaDoTempoDoCliente(clienteId) {
  const itens = []

  for (const a of atividades.list().filter((x) => x.clienteId === clienteId)) {
    itens.push({
      id: `atividade:${a.id}`,
      quando: a.data,
      categoria: 'atividade',
      titulo: a.titulo || TIPOS_ATIVIDADE[a.tipo] || 'Atividade',
      detalhe: a.descricao || '',
      registro: a,
    })
  }

  for (const ag of agendamentos.list().filter((x) => x.clienteId === clienteId)) {
    itens.push({
      id: `agendamento:${ag.id}`,
      quando: ag.concluidoEm || ag.data,
      categoria: 'agendamento',
      titulo: TIPOS_AGENDAMENTO[ag.tipo] ?? ag.tipo,
      detalhe: ag.observacoes || '',
      registro: ag,
    })
  }

  for (const v of vendas.list().filter((x) => x.clienteId === clienteId)) {
    itens.push({
      id: `venda:${v.id}`,
      quando: v.data,
      categoria: 'venda',
      titulo: `Venda ${v.numero || ''}`.trim(),
      detalhe: itensDaVenda(v.id).map((i) => i.descricao).filter(Boolean).join(', '),
      registro: v,
    })
  }

  for (const l of lancamentos.list().filter((x) => x.clienteId === clienteId && x.status === 'realizado')) {
    itens.push({
      id: `lancamento:${l.id}`,
      quando: l.dataPagamento,
      categoria: 'pagamento',
      titulo: l.descricao || 'Pagamento',
      detalhe: '',
      registro: l,
    })
  }

  return itens
    .filter((i) => i.quando)
    .sort((a, b) => String(b.quando).localeCompare(String(a.quando)))
}

// Fechamento do dia: o relatório sai do que já foi registrado, sem digitação.
//
// Dois critérios diferentes, de propósito:
//   O QUE EU FIZ    -> pela data de CONCLUSÃO (uma tarefa atrasada que você
//                      resolveu hoje conta no dia de hoje, que é a leitura
//                      honesta do seu dia).
//   O QUE ESTAVA NA -> pela data MARCADA (o que a agenda prometia para o dia).
//   AGENDA
export function resumoDoDia(dia) {
  const em = (iso) => String(iso || '').slice(0, 10) === dia
  const todas = atividades.list()

  const concluidas = todas.filter((a) => a.status === 'concluida' && em(a.concluidaEm))
  const pendentes = todas.filter((a) => a.status === 'pendente' && em(a.data))
  const contatos = concluidas.filter((a) => !['tarefa', 'nota'].includes(a.tipo))

  const porResultado = Object.keys(RESULTADOS_ATIVIDADE).map((chave) => ({
    resultado: chave,
    quantidade: concluidas.filter((a) => a.resultado === chave).length,
  })).filter((r) => r.quantidade > 0)

  const porTipo = Object.keys(TIPOS_ATIVIDADE).map((chave) => ({
    tipo: chave,
    quantidade: concluidas.filter((a) => a.tipo === chave).length,
  })).filter((t) => t.quantidade > 0)

  const servicos = agendamentos.list().filter((a) => a.status === 'concluido' && em(a.concluidoEm || a.data))
  const servicosPendentes = agendamentos.list().filter((a) => a.status === 'agendado' && em(a.data))
  const vendasFechadas = vendas.list().filter((v) => v.status === 'confirmada' && em(v.data))
  const recebidos = lancamentos
    .list()
    .filter((l) => l.tipo === 'entrada' && l.status === 'realizado' && em(l.dataPagamento))
  const pagos = lancamentos
    .list()
    .filter((l) => l.tipo === 'saida' && l.status === 'realizado' && em(l.dataPagamento))

  // Os retornos que você deixou marcados a partir do que fez hoje: a medida de
  // quantos clientes saíram do dia com um próximo passo definido.
  const idsConcluidas = new Set(concluidas.map((a) => a.id))
  const retornosMarcados = todas.filter(
    (a) => a.status === 'pendente' && a.origemAtividadeId && idsConcluidas.has(a.origemAtividadeId),
  )

  const somar = (lista) => lista.reduce((s, l) => s + Number(l.valor || 0), 0)

  return {
    dia,
    concluidas,
    pendentes,
    contatos,
    porResultado,
    porTipo,
    servicos,
    servicosPendentes,
    // Tudo que ainda está em aberto NESTE dia, das duas fontes — o mesmo
    // critério do botão "Fechar o dia", para os dois números não se
    // contradizerem na mesma tela.
    emAberto: pendentes.length + servicosPendentes.length,
    vendasFechadas,
    totalVendido: vendasFechadas.reduce((s, v) => s + Number(v.total || 0), 0),
    recebidos,
    totalRecebido: somar(recebidos),
    pagos,
    totalPago: somar(pagos),
    retornosMarcados,
    vazio:
      concluidas.length === 0 && pendentes.length === 0 && servicosPendentes.length === 0 &&
      servicos.length === 0 && vendasFechadas.length === 0 &&
      recebidos.length === 0 && pagos.length === 0,
  }
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

// O refil que serve um equipamento: o próprio produto, se já for um refil, ou
// o refil cadastrado como compatível com aquele aparelho.
export function refilDoEquipamento(equipamento) {
  const produto = produtos.get(equipamento?.produtoId)
  if (!produto) return null
  if (produto.tipo === 'refil') return produto
  return produtos.list().find((p) => p.tipo === 'refil' && p.aparelhoCompativelId === produto.id) ?? null
}

// Data prevista da próxima troca de refil de um equipamento do cliente
export function proximaTroca(equipamento) {
  const base = equipamento?.dataUltimaTroca || equipamento?.dataInstalacao
  const refil = refilDoEquipamento(equipamento)
  if (!base || !refil?.intervaloTrocaMeses) return null
  return somarMeses(base, Number(refil.intervaloTrocaMeses))
}
