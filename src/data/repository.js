// Camada de dados do sistema.
// Persiste no Supabase (Postgres na nuvem). As telas usam list()/get() de
// forma síncrona, lendo de um cache em memória; carregarDados() popula esse
// cache uma vez, logo após o login (ver App.jsx). create/update/remove são
// assíncronos (fazem requisição de rede) e já atualizam o cache ao terminar.

import { supabase } from '../lib/supabaseClient.js'
import { BUCKET, BUCKET_WHATSAPP, comprimir, assinarUrl, assinarVarias } from '../lib/imagem.js'
import { somarDias, chaveOrdem } from '../lib/datas.js'
import { formatarE164, mesmoNumero } from '../lib/telefone.js'
import { usuarioAtual } from '../lib/auth.js'
import {
  somarMeses, hojeISO, planoDeParcelas, totaisDaVenda,
  normalizarPagamentos, pagamentosDaCondicao, planoDePagamentos,
  resumoDosPagamentos, diferencaDosPagamentos,
} from './financeiro.js'

// Reexportados: as telas importam tudo do repositório.
export { somarMeses, hojeISO, planoDeParcelas, totaisDaVenda }
export { resumoDoMes, variacao, somarMesesNoMes, mesDe } from './financeiro.js'
export {
  FORMAS_PAGAMENTO, normalizarPagamentos, pagamentosDaCondicao, resolverPagamentos,
  diferencaDosPagamentos, resumoDosPagamentos,
} from './financeiro.js'

const TABELAS = [
  'clientes', 'produtos', 'equipamentos', 'agendamentos',
  'oportunidades', 'vendas', 'venda_itens', 'lancamentos', 'atividades',
  'conversas',
]

const cache = {
  clientes: [],
  produtos: [],
  equipamentos: [],
  agendamentos: [],
  oportunidades: [],
  vendas: [],
  venda_itens: [],
  lancamentos: [],
  atividades: [],
  conversas: [],
}

// As MENSAGENS ficam fora do cache principal, guardadas por conversa e trazidas
// sob demanda. É a mesma razão da janela de 365 dias das atividades, levada um
// passo adiante: conversa de WhatsApp cresce sem limite, e carregar o histórico
// inteiro de todo mundo a cada login ficaria mais lento a cada mês.
const mensagensPorConversa = new Map()

function camelParaSnake(s) {
  return s.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase())
}

function snakeParaCamel(s) {
  return s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase())
}

// Campos que o app ANEXA ao item depois de carregar e que NÃO existem como
// coluna: as URLs assinadas das imagens, geradas em carregarDados() a partir do
// caminho no bucket (`fotoPerfil` -> `fotoPerfilUrl`, `foto` -> `fotoUrl`,
// `avatarPath` -> `avatarUrl`).
//
// Precisam sair aqui porque as telas devolvem o item INTEIRO para update() — a
// ficha do cliente faz exatamente isso ao editar os dados. Sem esta lista o
// PostgREST recebia `foto_perfil_url`, não achava a coluna e recusava a
// gravação inteira: o cadastro simplesmente não salvava.
const CAMPOS_SO_DO_APP = ['fotoPerfilUrl', 'fotoUrl', 'avatarUrl']

// Objeto do app -> linha do banco. Strings vazias viram null (colunas de
// data/uuid/numero não aceitam ''); id, criadoEm e os campos calculados acima
// nunca são enviados.
function paraColuna(dados) {
  const linha = {}
  for (const [chave, valor] of Object.entries(dados)) {
    if (chave === 'id' || chave === 'criadoEm' || CAMPOS_SO_DO_APP.includes(chave)) continue
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
  oportunidades: 'sql/009_crm_oportunidades.sql',
  conversas: 'sql/010_whatsapp.sql',
  mensagens: 'sql/010_whatsapp.sql',
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

  // A foto de perfil do WhatsApp do contato (migração 012). Mesmo tratamento
  // das de cima, com uma diferença: outro bucket, porque é mídia que veio de
  // fora. Uma requisição só para todas as conversas.
  await assinarAvataresDasConversas()
}

async function assinarAvataresDasConversas() {
  const urls = await assinarVarias(cache.conversas.map((c) => c.avatarPath), BUCKET_WHATSAPP)
  cache.conversas = cache.conversas.map((c) => ({ ...c, avatarUrl: urls[c.avatarPath] || '' }))
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

// Oportunidade (a negociação — o cartão do funil): { clienteId, titulo,
//          etapa: 'novo'|'contato'|'proposta'|'negociacao'|'ganho'|'perdido',
//          valorEstimado, produtoId, canal, responsavel, dataPrevista, observacoes,
//          ordem (posição na coluna), motivoPerda, fechadaEm,
//          vendaId (a venda que fechou o negócio),
//          origemAtividadeId (a ligação de onde ela nasceu) }
// É o elo que faltava entre a atividade e a venda: o período em que o negócio
// já existe mas ainda não tem pedido montado — ver a migração 009.
export const oportunidades = makeStore('oportunidades')

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

// FORMAS_PAGAMENTO mora em financeiro.js (o plano de parcelas precisa do rótulo
// para nomear os lançamentos) e é reexportado lá em cima, junto com o resto.

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

// Etapas do funil. Vocabulário fechado, como TIPOS_ATIVIDADE e STATUS_VENDA:
// com um funil só, uma tabela de configuração editável cobraria o preço de uma
// tela inteira sem entregar nada. Se um dia houver mais de um funil, a coluna
// `etapa` já é texto e a migração é direta.
export const ETAPAS_FUNIL = {
  novo: 'Novo',
  contato: 'Em contato',
  proposta: 'Proposta',
  negociacao: 'Negociação',
  ganho: 'Ganho',
  perdido: 'Perdido',
}

// `ganho` e `perdido` são terminais: saem do fluxo do quadro e viram histórico.
export const ETAPAS_ABERTAS = ['novo', 'contato', 'proposta', 'negociacao']
export const ETAPAS_FECHADAS = ['ganho', 'perdido']

export const CANAIS_OPORTUNIDADE = {
  indicacao: 'Indicação',
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  loja: 'Loja',
  telefone: 'Telefone',
  site: 'Site',
  outro: 'Outro',
}

// Perder sem motivo não ensina nada — e é justamente o registro que, somado ao
// longo de um ano, diz se o problema é preço, prazo ou atendimento.
export const MOTIVOS_PERDA = {
  preco: 'Preço',
  sem_retorno: 'Sumiu / não respondeu',
  concorrente: 'Comprou de outro',
  sem_interesse: 'Não tinha interesse',
  fora_area: 'Fora da área de atendimento',
  outro: 'Outro',
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
    } else if (existente.status === 'realizado') {
      // Dinheiro que ENTROU não desaparece do caixa. A parcela sobrando perde o
      // vínculo com a origem e vira um lançamento manual: continua no histórico
      // e no relatório do mês, mas deixa de ser recalculada.
      //
      // Sem isso, cancelar uma venda paga ou desligar o financeiro de um serviço
      // já recebido apagaria receita real do relatório.
      await lancamentos.update(existente.id, { [chave]: '', origem: 'manual' })
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
// A migração 015 é feita à mão, no SQL Editor. Se ela ainda não rodou, o
// PostgREST recusa a gravação com um "Could not find the 'pagamentos' column"
// que não diz o que fazer. Aqui ele vira a instrução.
function explicarColunaPagamentos(erro) {
  const texto = `${erro?.message || ''} ${erro?.details || ''}`
  if (erro?.code === 'PGRST204' && texto.includes('pagamentos')) {
    throw new Error(
      'A coluna "pagamentos" ainda não existe no banco. Rode sql/015_pagamentos_da_venda.sql ' +
      'no SQL Editor do Supabase. Se já rodou, o cache da API está desatualizado: ' +
      "execute NOTIFY pgrst, 'reload schema'; e recarregue esta página.",
    )
  }
  throw erro
}

export async function salvarVenda(form, itensForm, opcoes = {}) {
  const itens = (itensForm || []).filter((item) => item.produtoId || String(item.descricao || '').trim())
  const { subtotal, total } = totaisDaVenda(itens, form.desconto, form.frete)

  // AS FORMAS DE PAGAMENTO (migração 015).
  //
  // Quem manda a lista (o formulário de venda) segue com ela. Quem não manda —
  // a proposta criada pelo funil, uma venda gravada antes da migração — tem a
  // condição antiga convertida em lista aqui. Daqui para baixo existe um
  // caminho só, e nenhum "se tem lista, senão…" espalhado pelo resto.
  const informados = normalizarPagamentos(form.pagamentos)
  const pagamentos = informados.length
    ? informados
    : pagamentosDaCondicao({
        total,
        formaPagamento: form.formaPagamento,
        condicao: form.condicao,
        entrada: form.entrada,
        parcelas: form.parcelas,
        primeiroVencimento: form.primeiroVencimento,
      })

  // Um plano que não fecha com o total gera contas a receber que somam menos
  // (ou mais) que a venda — e aí o cliente aparece devendo o que não deve, ou o
  // relatório do mês conta dinheiro que não existe. É erro de dinheiro: para
  // aqui, em vez de gravar torto e descobrir no fechamento.
  const diferenca = diferencaDosPagamentos(total, pagamentos)
  if (pagamentos.length && diferenca !== 0) {
    const falta = Math.abs(diferenca) / 100
    throw new Error(
      diferenca > 0
        ? `As formas de pagamento somam ${formatBRL(total - falta)}, ${formatBRL(falta)} a menos que o total da venda (${formatBRL(total)}). Distribua o restante antes de salvar.`
        : `As formas de pagamento somam ${formatBRL(total + falta)}, ${formatBRL(falta)} a mais que o total da venda (${formatBRL(total)}).`,
    )
  }

  // O resumo (forma principal, condição, entrada, parcelas) é DERIVADO da lista,
  // nunca digitado à parte — é o que impede a coluna `forma_pagamento` de
  // discordar das formas de fato registradas. Sem pagamento nenhum (orçamento
  // zerado), os campos antigos passam como estão.
  const resumo = resumoDosPagamentos(pagamentos, form.data)

  const dados = {
    ...form,
    subtotal,
    total,
    desconto: Number(form.desconto || 0),
    frete: Number(form.frete || 0),
    validadeDias: form.validadeDias === '' ? '' : Number(form.validadeDias),
    pagamentos,
    ...(resumo ?? {
      entrada: Number(form.entrada || 0),
      parcelas: Math.max(1, Number(form.parcelas || 1)),
    }),
  }
  delete dados.itens

  const venda = form.id
    ? await vendas.update(form.id, dados).catch(explicarColunaPagamentos)
    : await vendas.create(dados).catch(explicarColunaPagamentos)

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

  // Cada forma de pagamento gera as SUAS parcelas, com a forma dela — é assim
  // que o caixa sabe que R$ 500 entraram em dinheiro hoje e R$ 2.500 entram no
  // cartão em três vezes. Usa a lista local, e não `venda.pagamentos`, para o
  // financeiro sair certo mesmo se o banco ainda não tiver a coluna nova.
  const plano = venda.status === 'confirmada' && venda.lancarFinanceiro !== false
    ? planoDePagamentos({
        descricao: `Venda ${venda.numero || ''}`.trim(),
        clienteId: venda.clienteId,
        pagamentos,
        data: venda.data,
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

// ---- WhatsApp ----
//
// Duas exceções conscientes ao padrão do repositório, e o motivo de cada uma:
//
//   1. VOLUME. `conversas` são poucas e entram na carga inicial como qualquer
//      tabela. `mensagens` não: `carregarMensagens()` busca sob demanda e
//      guarda por conversa.
//
//   2. CHEGADA ASSÍNCRONA. Uma mensagem nova entra pela Edge Function
//      `wa-webhook`, não por uma ação da tela. `assinarWhatsapp()` escuta o
//      Realtime do Postgres e atualiza o cache sozinho. É a única parte do
//      sistema em que o dado muda sem ninguém ter clicado em nada — por isso
//      ela fica contida aqui dentro, e não espalhada pelas telas.
//
// O envio NÃO fala com a Evolution: chama a Edge Function `wa-enviar`, que
// guarda a chave. Ver a seção 3.1 do CRM_WHATSAPP.md.

export const conversas = makeStore('conversas')

const ordenarPorRecente = (a, b) =>
  String(b.ultimaEm || '').localeCompare(String(a.ultimaEm || ''))

// A caixa de entrada: conversas da mais recente para a mais antiga.
export function conversasRecentes({ incluirArquivadas = false } = {}) {
  return conversas
    .list()
    .filter((c) => (incluirArquivadas ? true : !c.arquivada))
    .sort(ordenarPorRecente)
}

export function conversaDoCliente(clienteId) {
  if (!clienteId) return null
  return conversas.list().filter((c) => c.clienteId === clienteId).sort(ordenarPorRecente)[0] ?? null
}

// A conversa de um telefone solto — o lead do funil, que ainda não tem cadastro
// e por isso não tem `clienteId` para procurar.
export function conversaDoNumero(telefone) {
  if (!telefone) return null
  return conversas.list().find((c) => mesmoNumero(c.numero, telefone)) ?? null
}

// ---- Qual foto aparece ----
//
// O ÚNICO lugar do sistema que responde "que imagem eu mostro desta pessoa?".
// Existe porque a resposta agora tem duas fontes, e espalhar a regra por cinco
// telas é como elas passam a discordar entre si.
//
// A ORDEM, e o motivo dela:
//
//   1. A foto do CADASTRO ganha. Foi você quem tirou, na ficha, de propósito —
//      normalmente é o rosto do cliente ou o resultado de um trabalho. A do
//      WhatsApp é a que a pessoa escolheu para o mundo, e às vezes é uma
//      paisagem, o cachorro dela ou nada.
//
//   2. Depois, a do WHATSAPP. É o que preenche o vazio: cliente sem foto na
//      ficha e, principalmente, o LEAD — o número que escreveu ontem e ainda
//      não é ninguém no cadastro. É aí que essa foto muda mais o dia a dia:
//      dá rosto a quem, até então, era só um número na coluna do funil.
//
//   3. Nada. A tela decide o que fazer (iniciais, ícone) — não é assunto daqui.
export function fotoDoContato({ clienteId, conversaId, telefone } = {}) {
  const cliente = clienteId ? clientes.get(clienteId) : null
  if (cliente?.fotoPerfilUrl) return cliente.fotoPerfilUrl

  const conversa =
    (conversaId ? conversas.get(conversaId) : null) ??
    conversaDoCliente(clienteId) ??
    conversaDoNumero(telefone || cliente?.telefone)

  return conversa?.avatarUrl || ''
}

// Pede à Edge Function que confira as fotos que faltam ou envelheceram.
//
// SILENCIOSA POR PROJETO: é enfeite. Se a Evolution estiver fora do ar, a tela
// continua com as iniciais e ninguém recebe um erro que não pode resolver. O
// retorno diz se algo mudou, para a tela só se redesenhar quando valeu a pena.
export async function atualizarAvatares({ conversaIds, forcar = false } = {}) {
  try {
    const { data, error } = await supabase.functions.invoke('wa-avatar', {
      body: { conversaIds, forcar },
    })
    if (error || !data?.atualizadas) return 0

    // As conversas mudaram no banco; o cache precisa das linhas novas e de URLs
    // assinadas para os caminhos novos.
    const { data: linhas } = await supabase.from('conversas').select('*')
    if (linhas) {
      const anteriores = new Map(cache.conversas.map((c) => [c.id, c]))
      cache.conversas = linhas.map((linha) => {
        const item = paraApp(linha)
        return { ...anteriores.get(item.id), ...item }
      })
      await assinarAvataresDasConversas()
    }
    return data.atualizadas
  } catch {
    return 0
  }
}

// Quantas mensagens novas há de um cliente — o número do contador no cartão do
// CRM. Cliente sem conversa devolve 0, e não null: a tela não precisa saber se
// esse cliente já conversou algum dia.
export function naoLidasDoCliente(clienteId) {
  if (!clienteId) return 0
  return conversas
    .list()
    .filter((c) => c.clienteId === clienteId)
    .reduce((soma, c) => soma + Number(c.naoLidas || 0), 0)
}

export function mensagensDaConversa(conversaId) {
  return mensagensPorConversa.get(conversaId) ?? []
}

export function naoLidasDaConversa(conversaId) {
  return Number(conversas.get(conversaId)?.naoLidas || 0)
}

// Busca o histórico de uma conversa. `limite` corta pelas mais recentes — quem
// abre uma conversa quer ver o fim dela, não o começo de dois anos atrás.
export async function carregarMensagens(conversaId, limite = 200) {
  if (!conversaId) return []
  const { data, error } = await supabase
    .from('mensagens')
    .select('*')
    .eq('conversa_id', conversaId)
    .order('ocorrido_em', { ascending: false })
    .limit(limite)
  if (error) throw error

  const lista = data.map(paraApp).reverse()
  mensagensPorConversa.set(conversaId, lista)
  return lista
}

// Marca a conversa como lida. Abrir é ler: o contador zera aqui e some do
// cartão do CRM no mesmo instante, porque os dois olham para a mesma linha.
export async function marcarConversaLida(conversaId) {
  const conversa = conversas.get(conversaId)
  if (!conversa || Number(conversa.naoLidas || 0) === 0) return conversa
  return conversas.update(conversaId, { naoLidas: 0 })
}

// Número que chegou sem cadastro: liga a conversa a um cliente existente.
export async function vincularConversaACliente(conversaId, clienteId) {
  return conversas.update(conversaId, { clienteId })
}

// ---- Anotações da conversa ----
//
// São `atividades` com `tipo = 'nota'` — não uma tabela nova. O motivo está na
// migração 014: a anotação já existia no sistema e já aparecia na ficha do
// cliente; o que faltava era ela saber de qual conversa e de qual negociação
// estava falando.
//
// A consequência é o que torna isto útil no balcão: a nota escrita aqui é o
// MESMO registro que o cartão do CRM mostra. Não há cópia para sair de sincronia
// — é uma linha só, lida de três lugares.

// A negociação a que uma conversa pertence, para pendurar a nota nela.
// Prioriza a aberta: o cartão que está sendo trabalhado é o que outro atendente
// vai abrir. Sem nenhuma aberta, vale a mais recente — melhor a nota aparecer
// num cartão fechado do que em lugar nenhum.
function oportunidadeDaConversa(conversaId, clienteId) {
  const daConversa = oportunidades.list().filter((o) => o.conversaId === conversaId)
  const doCliente = clienteId ? oportunidades.list().filter((o) => o.clienteId === clienteId) : []
  const candidatas = [...new Set([...daConversa, ...doCliente])]
  return (
    candidatas.find((o) => ETAPAS_ABERTAS.includes(o.etapa)) ??
    candidatas.sort((a, b) => String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')))[0] ??
    null
  )
}

export function notasDaConversa(conversaId) {
  if (!conversaId) return []
  return atividades
    .list()
    .filter((a) => a.tipo === 'nota' && a.conversaId === conversaId)
    .sort((a, b) => String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')))
}

// As notas de um cartão do funil — a mesma coisa, olhada pelo outro lado.
export function notasDaOportunidade(oportunidadeId) {
  if (!oportunidadeId) return []
  return atividades
    .list()
    .filter((a) => a.tipo === 'nota' && a.oportunidadeId === oportunidadeId)
    .sort((a, b) => String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')))
}

export async function anotarNaConversa(conversa, texto) {
  const limpo = String(texto || '').trim()
  if (!limpo || !conversa?.id) return null

  const cartao = oportunidadeDaConversa(conversa.id, conversa.clienteId)

  return atividades.create({
    tipo: 'nota',
    descricao: limpo,
    // Nota nasce concluída: é registro do que já aconteceu, não tarefa a fazer.
    // É a mesma regra do TIPOS_SEM_PENDENCIA — repeti-la aqui é o que impede a
    // anotação de aparecer como pendência atrasada na agenda de alguém.
    status: 'concluida',
    data: hojeISO(),
    concluidaEm: hojeISO(),
    conversaId: conversa.id,
    clienteId: conversa.clienteId || null,
    oportunidadeId: cartao?.id || null,
    criadoPor: usuarioAtual(),
    responsavel: usuarioAtual(),
  })
}

export async function apagarNota(notaId) {
  return atividades.remove(notaId)
}

// Garante que a conversa com um CLIENTE apareça no funil.
//
// O webhook abre cartão para quem NÃO é cliente (o lead). Quem já é cliente
// ficava de fora de propósito: não se abre negociação a cada "bom dia" de quem
// já está na base, senão o funil vira a caixa de entrada com outro nome.
//
// O que muda aqui é a INTENÇÃO. Sair da ficha do cliente e escrever para ele é
// um ato deliberado — você foi atrás da pessoa. Isso é começo de negociação, e
// merece cartão.
//
// A trava é `ETAPAS_ABERTAS`: se já existe negociação em andamento com essa
// pessoa, a conversa pertence a ela, e um cartão novo só dividiria a história
// em dois lugares.
export async function garantirOportunidadeDoCliente(clienteId, conversaId) {
  if (!clienteId) return null

  const emAberto = oportunidades
    .list()
    .find((o) => o.clienteId === clienteId && ETAPAS_ABERTAS.includes(o.etapa))
  if (emAberto) {
    // Cartão que existia antes da conversa passa a conhecê-la — é o que faz o
    // botão de conversar do cartão cair no fio certo.
    if (!emAberto.conversaId && conversaId) {
      return oportunidades.update(emAberto.id, { conversaId })
    }
    return emAberto
  }

  const cliente = clientes.get(clienteId)
  return salvarOportunidade({
    clienteId,
    conversaId: conversaId || null,
    titulo: cliente?.nome ? `${cliente.nome} (WhatsApp)` : 'Contato pelo WhatsApp',
    etapa: 'novo',
    canal: 'whatsapp',
  })
}

// Tira (ou devolve) a conversa da caixa de entrada.
//
// Arquivar NÃO apaga nada: o fio e as mensagens continuam no banco, e a conversa
// volta a aparecer se a pessoa escrever de novo — porque o webhook atualiza
// `ultima_em` e quem lista escolhe se quer ver as arquivadas. É o "resolvido",
// não o "sumiu".
export async function arquivarConversa(conversaId, arquivada = true) {
  return conversas.update(conversaId, { arquivada })
}

// Cria o cliente a partir do contato e amarra tudo que já existe dele.
//
// São três coisas numa só, e é justamente por isso que mora aqui e não na tela:
// deixar a tela orquestrar isso é como um dos três passos acaba esquecido.
//
//   1. cria o cliente;
//   2. liga a conversa a ele — o histórico do WhatsApp passa a aparecer na
//      ficha, e não some numa conversa órfã;
//   3. adota o cartão que o lead já tinha no funil, em vez de criar outro. A
//      negociação continua na etapa em que estava, com o histórico dela. Sem
//      este passo você teria dois cartões da mesma pessoa: o lead antigo e o
//      cliente novo.
export async function cadastrarClienteDaConversa(conversaId, dadosDoCliente) {
  const cliente = await clientes.create({ ...dadosDoCliente, criadoPor: usuarioAtual() })

  await conversas.update(conversaId, { clienteId: cliente.id })

  // `contatoNome`/`contatoTelefone` eram a identidade provisória do lead. Agora
  // que existe cadastro, quem responde por isso é o cliente — deixá-los para
  // trás faria o cartão mostrar o nome velho se o cliente mudar de nome depois.
  const cartoes = oportunidades.list().filter((o) => o.conversaId === conversaId && !o.clienteId)
  for (const cartao of cartoes) {
    await oportunidades.update(cartao.id, {
      clienteId: cliente.id,
      contatoNome: '',
      contatoTelefone: '',
    })
  }

  return cliente
}

// Envia pelo WhatsApp. Quem fala com a Evolution é a Edge Function; daqui só
// sai o texto e o destino, com o JWT da sessão que o Supabase já anexa.
export async function enviarMensagemWhatsapp({ conversaId, clienteId, numero, texto, oportunidadeId }) {
  const { data, error } = await supabase.functions.invoke('wa-enviar', {
    body: {
      conversaId: conversaId || undefined,
      clienteId: clienteId || undefined,
      numero: numero || undefined,
      texto,
      oportunidadeId: oportunidadeId || undefined,
      enviadoPor: usuarioAtual(),
    },
  })

  // A função devolve o motivo real da recusa (número inexistente no WhatsApp,
  // instância caída). Repassar isso é o que evita o "erro ao enviar" genérico
  // que não ajuda ninguém.
  if (error) {
    let detalhe = ''
    try {
      const corpo = await error.context?.json?.()
      detalhe = corpo?.detalhe || corpo?.erro || ''
    } catch { /* resposta sem corpo JSON */ }
    throw new Error(detalhe || error.message || 'não foi possível enviar')
  }

  // Recarrega a conversa afetada para a tela mostrar a mensagem que acabou de
  // sair, sem esperar o eco do Realtime.
  if (data?.conversaId) {
    await recarregarConversa(data.conversaId)
    await carregarMensagens(data.conversaId)
  }
  return data
}

export async function statusWhatsapp() {
  const { data, error } = await supabase.functions.invoke('wa-status')
  if (error) throw new Error(error.message || 'não foi possível falar com o WhatsApp')
  return data
}

async function recarregarConversa(conversaId) {
  const { data, error } = await supabase.from('conversas').select('*').eq('id', conversaId).maybeSingle()
  if (error || !data) return null
  const item = paraApp(data)

  // `avatarUrl` não vem do banco: é assinada no carregamento. Sem reassinar
  // aqui, toda conversa recarregada — e o Realtime recarrega a cada mensagem —
  // perderia a foto e voltaria para as iniciais.
  const anterior = cache.conversas.find((c) => c.id === conversaId)
  item.avatarUrl = item.avatarPath === anterior?.avatarPath
    ? (anterior?.avatarUrl || '')
    : await assinarUrl(item.avatarPath, BUCKET_WHATSAPP).catch(() => '')

  const existe = cache.conversas.some((c) => c.id === conversaId)
  cache.conversas = existe
    ? cache.conversas.map((c) => (c.id === conversaId ? item : c))
    : [...cache.conversas, item]
  return item
}

// Assina as mudanças que chegam sozinhas. Devolve a função de cancelar, para a
// tela desligar no unmount.
export function assinarWhatsapp(aoMudar) {
  // Nome único por assinatura: mais de uma tela escuta ao mesmo tempo (o CRM
  // pelo contador, a caixa de entrada pela conversa), e dois canais com o mesmo
  // tópico se atropelam no Supabase.
  const canal = supabase
    .channel(`whatsapp-${crypto.randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'mensagens' }, async (evento) => {
      const linha = evento.new ?? evento.old
      const conversaId = linha?.conversa_id
      if (!conversaId) return
      // Só recarrega a conversa que já está aberta na tela: puxar o histórico
      // de todas a cada mensagem seria trabalho jogado fora.
      if (mensagensPorConversa.has(conversaId)) await carregarMensagens(conversaId)
      await recarregarConversa(conversaId)
      aoMudar?.()
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'conversas' }, async (evento) => {
      const id = evento.new?.id ?? evento.old?.id
      if (evento.eventType === 'DELETE') {
        cache.conversas = cache.conversas.filter((c) => c.id !== id)
      } else if (id) {
        await recarregarConversa(id)
      }
      aoMudar?.()
    })
    .subscribe()

  return () => supabase.removeChannel(canal)
}

// ---- Funil (oportunidades) ----

// Espaço entre cartões vizinhos. Cartão novo entra no fim da coluna com
// `ultima + PASSO_ORDEM`; mover calcula a média entre os vizinhos. Assim um
// arrasto grava UMA linha, e não a coluna inteira renumerada.
const PASSO_ORDEM = 1000

const porOrdem = (a, b) => Number(a.ordem || 0) - Number(b.ordem || 0)

// Os cartões de uma etapa, na ordem em que aparecem na coluna.
export function oportunidadesDaEtapa(etapa) {
  return oportunidades.list().filter((o) => o.etapa === etapa).sort(porOrdem)
}

// O quadro inteiro. As etapas fechadas mostram só o passado recente: manter
// "ganho" e "perdido" inteiros faria a coluna crescer para sempre e esconder o
// que ainda dá para trabalhar.
export function oportunidadesPorEtapa(diasDeFechadas = 30) {
  const limite = somarDias(hojeISO(), -diasDeFechadas)
  const quadro = {}
  for (const etapa of Object.keys(ETAPAS_FUNIL)) {
    const cartoes = oportunidadesDaEtapa(etapa)
    quadro[etapa] = ETAPAS_FECHADAS.includes(etapa)
      ? cartoes.filter((o) => !o.fechadaEm || o.fechadaEm >= limite)
      : cartoes
  }
  return quadro
}

export function oportunidadesDoCliente(clienteId) {
  if (!clienteId) return []
  return oportunidades
    .list()
    .filter((o) => o.clienteId === clienteId)
    .sort((a, b) => String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')))
}

// Contagem e dinheiro em jogo por etapa, para o cabeçalho das colunas.
export function resumoDoFunil() {
  const quadro = oportunidadesPorEtapa()
  const resumo = {}
  for (const [etapa, cartoes] of Object.entries(quadro)) {
    resumo[etapa] = {
      quantidade: cartoes.length,
      valor: cartoes.reduce((soma, o) => soma + Number(o.valorEstimado || 0), 0),
    }
  }
  return resumo
}

// Negociações abertas paradas há mais de `dias` — o número que importa no
// dashboard. Uma oportunidade esquecida não avisa que foi esquecida.
export function oportunidadesParadas(dias = 7) {
  const limite = somarDias(hojeISO(), -dias)
  return oportunidades
    .list()
    .filter((o) => ETAPAS_ABERTAS.includes(o.etapa))
    .filter((o) => String(o.atualizadoEm || o.criadoEm || '').slice(0, 10) < limite)
    .sort((a, b) => String(a.atualizadoEm || '').localeCompare(String(b.atualizadoEm || '')))
}

function tituloPadraoDaOportunidade(dados) {
  const produto = dados.produtoId ? produtos.get(dados.produtoId) : null
  if (produto) return produto.nome
  const cliente = dados.clienteId ? clientes.get(dados.clienteId) : null
  return cliente ? `Negociação — ${cliente.nome}` : 'Nova negociação'
}

export async function salvarOportunidade(form) {
  const etapa = form.etapa || 'novo'
  const dados = {
    ...form,
    etapa,
    titulo: String(form.titulo || '').trim() || tituloPadraoDaOportunidade(form),
    valorEstimado: Number(form.valorEstimado || 0),
    responsavel: form.responsavel || usuarioAtual(),
    criadoPor: form.criadoPor || usuarioAtual(),
  }

  // Cartão novo entra no fim da coluna: quem acabou de chegar não fura a fila
  // do que já estava sendo trabalhado.
  if (!form.id) {
    const coluna = oportunidadesDaEtapa(etapa)
    const ultima = coluna[coluna.length - 1]
    dados.ordem = ultima ? Number(ultima.ordem || 0) + PASSO_ORDEM : PASSO_ORDEM
  }

  return form.id ? oportunidades.update(form.id, dados) : oportunidades.create(dados)
}

// Move o cartão para `etapa`, na posição `indice` daquela coluna.
//
// A nova ordem é a média entre os vizinhos de destino. Com numeric(20,10) dá
// para dividir o intervalo dezenas de vezes antes de faltar precisão, e uma
// coluna reordenada à mão tantas vezes assim é hipótese de laboratório.
export async function moverOportunidade(id, etapa, indice) {
  const cartao = oportunidades.get(id)
  if (!cartao) return null

  const coluna = oportunidadesDaEtapa(etapa).filter((o) => o.id !== id)
  const posicao = Math.max(0, Math.min(indice ?? coluna.length, coluna.length))
  const anterior = coluna[posicao - 1]
  const proximo = coluna[posicao]

  let ordem
  if (!anterior && !proximo) ordem = PASSO_ORDEM
  else if (!anterior) ordem = Number(proximo.ordem || PASSO_ORDEM) / 2
  else if (!proximo) ordem = Number(anterior.ordem || 0) + PASSO_ORDEM
  else ordem = (Number(anterior.ordem || 0) + Number(proximo.ordem || 0)) / 2

  return oportunidades.update(id, { etapa, ordem })
}

// O canal da negociação e o canal da venda são vocabulários diferentes (a venda
// só conhece quatro). Traduz em vez de deixar o CHECK do banco recusar a venda.
function canalDaVenda(canal) {
  if (['loja', 'whatsapp', 'telefone'].includes(canal)) return canal
  return canal ? 'externo' : ''
}

// Abre a venda a partir da negociação, já com cliente, produto e valor.
//
// Nasce como PROPOSTA de propósito: proposta não vira dinheiro no caixa (ver
// salvarVenda), então ganhar o funil nunca lança receita sozinho. Quem confirma
// a venda — e com isso gera parcelas e agenda a instalação — continua sendo
// você, na tela de Vendas.
export async function criarVendaDaOportunidade(oportunidade) {
  const produto = oportunidade.produtoId ? produtos.get(oportunidade.produtoId) : null
  const valor = Number(oportunidade.valorEstimado || 0) || Number(produto?.valor || 0)

  const itens = produto
    ? [{
        produtoId: produto.id,
        descricao: produto.nome,
        quantidade: 1,
        valorUnitario: valor,
        desconto: 0,
      }]
    : []

  return salvarVenda(
    {
      clienteId: oportunidade.clienteId,
      data: hojeISO(),
      tipo: 'venda',
      canal: canalDaVenda(oportunidade.canal),
      status: 'proposta',
      validadeDias: 15,
      formaPagamento: 'pix',
      condicao: 'a_vista',
      parcelas: 1,
      desconto: 0,
      frete: 0,
      entrada: 0,
      observacoes: oportunidade.observacoes || '',
      oportunidadeId: oportunidade.id,
      origemAtividadeId: oportunidade.origemAtividadeId || '',
    },
    itens,
  )
}

// Fecha a negociação como ganha. `criarVenda` abre a proposta correspondente e
// guarda o vínculo nos dois sentidos.
export async function ganharOportunidade(id, { criarVenda = false } = {}) {
  const cartao = oportunidades.get(id)
  if (!cartao) return null

  let venda = null
  if (criarVenda && !cartao.vendaId) venda = await criarVendaDaOportunidade(cartao)

  return oportunidades.update(id, {
    etapa: 'ganho',
    fechadaEm: hojeISO(),
    motivoPerda: '',
    vendaId: venda?.id || cartao.vendaId || '',
  })
}

// Fecha como perdida. O motivo é obrigatório pela mesma razão que o resultado
// "retornar" exige data de volta: o registro só serve se disser alguma coisa.
export async function perderOportunidade(id, { motivo, observacoes } = {}) {
  if (!motivo) {
    throw new Error(
      'Escolha o motivo da perda: negociação perdida sem motivo não vira ' +
      'aprendizado nenhum no fim do mês.',
    )
  }
  const cartao = oportunidades.get(id)
  if (!cartao) return null

  return oportunidades.update(id, {
    etapa: 'perdido',
    fechadaEm: hojeISO(),
    motivoPerda: motivo,
    observacoes: observacoes ?? cartao.observacoes,
  })
}

// Volta uma negociação fechada para o fluxo. A venda já criada continua
// vinculada — ela existe de fato, e apagar o rastro seria mentir.
export async function reabrirOportunidade(id, etapa = 'negociacao') {
  return oportunidades.update(id, { etapa, fechadaEm: '', motivoPerda: '' })
}

export async function excluirOportunidade(id) {
  await oportunidades.remove(id)
}

// ---- Leads ----
//
// Um LEAD é uma oportunidade sem cliente: alguém escreveu no WhatsApp, o número
// não está no cadastro, e o sistema abriu a negociação sozinho (ver a Edge
// Function `wa-webhook` e a migração 011).
//
// A escolha de fundo: não criar cliente automático. `clientes` alimenta venda,
// financeiro, agenda e os documentos — enchê-lo de engano e propaganda estraga
// tudo isso. O cadastro nasce quando VOCÊ decide que aquela pessoa é cliente.

export const ehLead = (oportunidade) => !!oportunidade && !oportunidade.clienteId

// Quem é a pessoa do cartão, seja ela cliente ou lead.
export function contatoDaOportunidade(oportunidade) {
  if (!oportunidade) return null
  const cliente = oportunidade.clienteId ? clientes.get(oportunidade.clienteId) : null
  if (cliente) {
    return { nome: cliente.nome, telefone: cliente.telefone, cliente, lead: false }
  }
  return {
    nome: oportunidade.contatoNome || 'Contato sem nome',
    telefone: formatarE164(oportunidade.contatoTelefone) || oportunidade.contatoTelefone || '',
    cliente: null,
    lead: true,
  }
}

// A conversa de WhatsApp de uma oportunidade — pelo vínculo direto (lead) ou
// pelo cliente (negociação normal).
export function conversaDaOportunidade(oportunidade) {
  if (!oportunidade) return null
  if (oportunidade.conversaId) return conversas.get(oportunidade.conversaId) ?? null
  return conversaDoCliente(oportunidade.clienteId)
}

export function naoLidasDaOportunidade(oportunidade) {
  if (!oportunidade) return 0
  if (oportunidade.clienteId) return naoLidasDoCliente(oportunidade.clienteId)
  return naoLidasDaConversa(oportunidade.conversaId)
}

// Promove o lead a cliente: cria o cadastro, e liga a ele a negociação e a
// conversa. É o momento em que a pessoa deixa de ser "um número que escreveu" e
// passa a existir no sistema — por isso é uma decisão sua, com um clique, e não
// um efeito colateral de ter recebido mensagem.
export async function converterLeadEmCliente(oportunidadeId, dadosDoCliente = {}) {
  const oportunidade = oportunidades.get(oportunidadeId)
  if (!oportunidade) throw new Error('negociação não encontrada')
  if (oportunidade.clienteId) return clientes.get(oportunidade.clienteId)

  const nome = String(dadosDoCliente.nome || oportunidade.contatoNome || '').trim()
  if (!nome) throw new Error('dê um nome ao cliente antes de converter')

  const cliente = await clientes.create({
    ...dadosDoCliente,
    nome,
    telefone: dadosDoCliente.telefone || formatarE164(oportunidade.contatoTelefone),
    criadoPor: usuarioAtual(),
  })

  await oportunidades.update(oportunidadeId, {
    clienteId: cliente.id,
    titulo: oportunidade.titulo?.includes('(WhatsApp)') ? nome : oportunidade.titulo,
  })

  // A conversa também passa a ter dono: a partir daqui ela aparece na ficha do
  // cliente e para de ser mostrada como "sem cadastro".
  if (oportunidade.conversaId) {
    await conversas.update(oportunidade.conversaId, { clienteId: cliente.id })
  }

  return cliente
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
  const salvo = form.id ? await lancamentos.update(form.id, dados) : await lancamentos.create(dados)
  // Editar a situação à mão é o mesmo que dar baixa: o agendamento de origem
  // precisa saber, senão o rótulo "Pago / A receber" fica mentindo lá.
  await refletirPagamentoNoAgendamento(salvo)
  return salvo
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
  // `lancarFinanceiro === false` é a escolha explícita de manter o serviço fora
  // do caixa (cortesia, garantia, retrabalho, acerto por fora). Comparação com
  // !== false e não com truthy: registros anteriores à migração 006 vêm sem o
  // campo e devem continuar lançando.
  const contabiliza =
    ag.lancarFinanceiro !== false && Number(ag.valor) > 0 && ag.status !== 'cancelado'

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

// Os lançamentos irmãos de um lançamento vinculado — as outras parcelas da
// mesma venda ou do mesmo agendamento. A tela usa para dizer, antes de remover,
// exatamente o que vai sair do caixa e o que já foi recebido.
export function lancamentosDaOrigem(lancamento) {
  const chave = lancamento.vendaId ? 'vendaId' : lancamento.agendamentoId ? 'agendamentoId' : ''
  if (!chave) return []
  return lancamentos.list().filter((l) => l[chave] === lancamento[chave])
}

// "Remover do financeiro" a partir da tela do Financeiro.
//
// Não apaga a linha: desliga a chave na ORIGEM. Apagar só o lançamento seria
// inútil, porque a próxima gravação do agendamento/venda o recriaria — a
// sincronia trata a origem como verdade. Desligado lá, a sincronia remove as
// parcelas previstas e destaca as já recebidas como manuais.
export async function removerDoFinanceiro(lancamento) {
  if (lancamento.agendamentoId) {
    const ag = await agendamentos.update(lancamento.agendamentoId, { lancarFinanceiro: false })
    return sincronizarFinanceiro(ag)
  }
  if (lancamento.vendaId) {
    await vendas.update(lancamento.vendaId, { lancarFinanceiro: false })
    return sincronizarLancamentos({ vendaId: lancamento.vendaId }, [])
  }
  // Lançamento manual não tem origem: sai de vez.
  return lancamentos.remove(lancamento.id)
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

// Coloca um aparelho na ficha do cliente SEM gerar venda, item nem financeiro.
//
// É para o aparelho que já está na casa da pessoa e não passou por aqui: veio
// de brinde, foi instalado por outra empresa, sobrou de um contrato antigo. O
// que interessa é acompanhá-lo — o ciclo de troca de refil já sai agendado a
// partir da data de instalação —, e inventar uma venda que nunca houve só suja
// o faturamento do mês.
//
// Não duplica: se o cliente já tem esse mesmo produto na ficha, devolve o
// equipamento existente em vez de criar um segundo.
export async function registrarEquipamento({ clienteId, produtoId, dataInstalacao }) {
  if (!clienteId || !produtoId) throw new Error('cliente e produto são obrigatórios')

  const base = dataInstalacao || hojeISO()
  const jaTem = equipamentos
    .list()
    .find((eq) => eq.clienteId === clienteId && eq.produtoId === produtoId)

  const equipamento = jaTem ?? await equipamentos.create({
    clienteId,
    produtoId,
    dataInstalacao: base,
    dataUltimaTroca: '',
  })

  await agendarProximaTroca(equipamento)
  return equipamento
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

// O que nasceu de uma atividade: outras atividades, negociações, serviços e vendas.
export function desdobramentosDe(atividadeId) {
  if (!atividadeId) return { atividades: [], oportunidades: [], agendamentos: [], vendas: [] }
  return {
    atividades: atividades.list().filter((a) => a.origemAtividadeId === atividadeId),
    oportunidades: oportunidades.list().filter((o) => o.origemAtividadeId === atividadeId),
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

  // A negociação entra pela data em que fechou; enquanto está aberta, pela data
  // em que nasceu — é quando ela de fato aconteceu na história do cliente.
  for (const o of oportunidades.list().filter((x) => x.clienteId === clienteId)) {
    itens.push({
      id: `oportunidade:${o.id}`,
      quando: o.fechadaEm || String(o.criadoEm || '').slice(0, 10),
      categoria: 'oportunidade',
      titulo: o.titulo || 'Negociação',
      detalhe: [
        ETAPAS_FUNIL[o.etapa] ?? o.etapa,
        Number(o.valorEstimado || 0) ? formatBRL(o.valorEstimado) : '',
        o.motivoPerda ? MOTIVOS_PERDA[o.motivoPerda] ?? o.motivoPerda : '',
      ].filter(Boolean).join(' · '),
      registro: o,
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
