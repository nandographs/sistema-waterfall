import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  vendas, vendaItens, clientes, produtos, lancamentos,
  salvarVenda, excluirVenda, itensDaVenda, lancamentosDaVenda, totaisDaVenda,
  formatData, formatBRL, hojeISO, resolverPagamentos, normalizarPagamentos,
  FORMAS_PAGAMENTO, STATUS_VENDA, CANAIS_VENDA,
} from '../data/repository.js'
import { PERIODOS, dentroDoPeriodo } from '../lib/datas.js'
import { Card, Page, PageTitle, Button, Field, inputCls, Empty, Modal, Badge, notificar } from '../components/ui.jsx'
import { IconPlus, IconFileText, IconTrash, IconEye, IconMais, IconSearch } from '../components/icons.jsx'
import ClienteBusca from '../components/ClienteBusca.jsx'
import ProdutoBusca from '../components/ProdutoBusca.jsx'
import PedidoModal from '../components/PedidoModal.jsx'
import PagamentosVenda, { pagamentosIniciais } from '../components/PagamentosVenda.jsx'

const ITEM_VAZIO = { produtoId: '', descricao: '', quantidade: 1, valorUnitario: '', desconto: '' }

const FORM_VAZIO = {
  clienteId: '', data: hojeISO(), tipo: 'venda', canal: '', status: 'proposta',
  validadeDias: 15, numero: '',
  desconto: '', frete: '',
  formaPagamento: 'pix', condicao: 'a_vista', entrada: '', parcelas: 1, primeiroVencimento: '',
  consultor: '', consultorTelefone: '', distribuidor: '', distribuidorTelefone: '',
  entregaTipo: '', entregaEndereco: '', entregaPrevisao: '',
  observacoes: '',
  lancarFinanceiro: true,
}

const STATUS_BADGE = {
  proposta: 'sky',
  confirmada: 'green',
  cancelada: 'red',
}

// Busca sem acento e sem caixa: "sao jose" acha "São José", e "PURIFICADOR"
// acha "purificador". Num cadastro de centenas de nomes ninguém acerta o acento
// na primeira, e uma busca que exige isso é uma busca que não se usa.
const semAcento = (texto) =>
  String(texto || '')
    // NFD separa o acento da letra; \p{Diacritic} então descarta só o acento.
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()

function AcoesVenda({ venda, onVer, onPedido, onEditar, onConfirmar, onCancelar, onExcluir }) {
  function fechar(e) {
    e.currentTarget.closest('details')?.removeAttribute('open')
  }

  const acaoCls = 'flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-200'

  return (
    <div className="flex items-center gap-2 shrink-0">
      <Button variant="secondary" onClick={onVer}><IconEye size={16} /> Ver</Button>
      <details className="relative">
        <summary
          aria-label="Mais ações da venda"
          className="list-none inline-flex h-11 w-11 sm:h-9 sm:w-9 cursor-pointer items-center justify-center rounded-xl border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 [&::-webkit-details-marker]:hidden"
        >
          <IconMais size={18} />
        </summary>
        <div className="absolute right-0 z-20 mt-2 w-52 rounded-xl border border-slate-300 bg-slate-100 p-1.5 shadow-xl shadow-black/30">
          <button type="button" className={acaoCls} onClick={(e) => { fechar(e); onPedido() }}>
            <IconFileText size={16} /> Gerar pedido
          </button>
          {venda.status === 'proposta' && (
            <>
              <button type="button" className={acaoCls} onClick={(e) => { fechar(e); onEditar() }}>Editar</button>
              <button type="button" className={acaoCls} onClick={(e) => { fechar(e); onConfirmar() }}>Confirmar venda</button>
            </>
          )}
          {venda.status === 'confirmada' && (
            <button type="button" className={acaoCls} onClick={(e) => { fechar(e); onCancelar() }}>Cancelar venda</button>
          )}
          <button type="button" className={acaoCls + ' text-red-700 hover:bg-red-50'} onClick={(e) => { fechar(e); onExcluir() }}>
            <IconTrash size={15} /> Excluir
          </button>
        </div>
      </details>
    </div>
  )
}

export default function Vendas() {
  const [, forceRender] = useState(0)
  const refresh = () => forceRender((n) => n + 1)

  const [form, setForm] = useState(null)
  const [itens, setItens] = useState([])
  const [pagamentos, setPagamentos] = useState([])
  const [filtro, setFiltro] = useState('todos')
  const [busca, setBusca] = useState('')
  // Começa em "todo o período" de propósito: um recorte padrão esconderia
  // vendas antigas sem ninguém ter pedido, e some com histórico é o tipo de
  // ausência que passa despercebida.
  const [periodo, setPeriodo] = useState('todos')
  const [pedidoVenda, setPedidoVenda] = useState(null)
  const [detalhe, setDetalhe] = useState(null)
  const [excluir, setExcluir] = useState(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  const listaProdutos = produtos.list()

  // O texto pesquisável de cada venda: cliente, cidade/UF, nº do pedido e os
  // produtos vendidos.
  //
  // Montado de uma vez, e não a cada tecla: `itensDaVenda` varre a tabela
  // inteira de itens, e chamá-la por venda a cada letra digitada é
  // O(vendas × itens) — com centenas de vendas a busca engasgaria. Aqui os
  // itens são agrupados numa passada só.
  const indiceBusca = useMemo(() => {
    const produtosPorVenda = new Map()
    for (const item of vendaItens.list()) {
      const atual = produtosPorVenda.get(item.vendaId)
      if (atual) atual.push(item.descricao)
      else produtosPorVenda.set(item.vendaId, [item.descricao])
    }

    const indice = new Map()
    for (const v of vendas.list()) {
      const cliente = clientes.get(v.clienteId)
      indice.set(v.id, semAcento([
        cliente?.nome,
        cliente?.cidade,
        cliente?.uf,
        v.numero,
        ...(produtosPorVenda.get(v.id) || []),
      ].filter(Boolean).join(' ')))
    }
    return indice
  }, [vendas.list(), vendaItens.list(), clientes.list()])

  const termo = semAcento(busca)
  const lista = vendas
    .list()
    .filter((v) => (filtro === 'todos' ? true : v.status === filtro))
    .filter((v) => dentroDoPeriodo(v.data, periodo))
    .filter((v) => !termo || (indiceBusca.get(v.id) || '').includes(termo))
    .sort((a, b) => (b.data || '').localeCompare(a.data || ''))

  // Quanto o que está na tela representa. Venda CANCELADA fica na lista (você
  // pode querer vê-la) mas fora da soma: ela não é receita, e somá-la faria o
  // total do mês mentir.
  const canceladasNaLista = lista.filter((v) => v.status === 'cancelada').length
  const somaListada = lista
    .filter((v) => v.status !== 'cancelada')
    .reduce((soma, v) => soma + Number(v.total || 0), 0)

  // Totais recalculados a cada tecla, para o rodapé do formulário mostrar
  // exatamente o que será gravado.
  const { subtotal, total } = form
    ? totaisDaVenda(itens, form.desconto, form.frete)
    : { subtotal: 0, total: 0 }

  function abrirNova() {
    setErro('')
    setForm({ ...FORM_VAZIO })
    setItens([{ ...ITEM_VAZIO }])
    setPagamentos(pagamentosIniciais(null, 0))
  }

  function abrirEdicao(venda) {
    setErro('')
    setForm({ ...FORM_VAZIO, ...venda })
    const existentes = itensDaVenda(venda.id)
    setItens(existentes.length ? existentes.map((i) => ({ ...i })) : [{ ...ITEM_VAZIO }])
    setPagamentos(pagamentosIniciais(venda, venda.total))
  }

  async function salvar(e) {
    e.preventDefault()
    setErro('')
    setSalvando(true)
    try {
      // `resolverPagamentos` fecha o campo deixado em branco com o restante do
      // total — é o que permite salvar sem digitar valor de pagamento nenhum
      // quando a venda tem uma forma só.
      await salvarVenda({ ...form, pagamentos: resolverPagamentos(pagamentos, total) }, itens)
      notificar(
        form.status === 'confirmada'
          ? 'Venda confirmada. Financeiro e agenda foram atualizados conforme a condição informada.'
          : 'Venda salva com sucesso.',
      )
      setForm(null)
      refresh()
    } catch (ex) {
      setErro(ex?.message || String(ex))
    } finally {
      setSalvando(false)
    }
  }

  async function mudarStatus(venda, status) {
    try {
      await salvarVenda({ ...venda, status }, itensDaVenda(venda.id))
      notificar(status === 'confirmada' ? 'Venda confirmada e desdobramentos atualizados.' : 'Venda cancelada.')
      refresh()
    } catch (ex) {
      notificar('Não foi possível alterar a venda: ' + (ex?.message || ex), 'erro')
    }
  }

  async function confirmarExcluir() {
    await excluirVenda(excluir.id)
    setExcluir(null)
    refresh()
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  // Escolher o produto puxa nome e preço de tabela; ambos continuam editáveis.
  function alterarItem(indice, campo, valor) {
    setItens(itens.map((item, i) => {
      if (i !== indice) return item
      if (campo !== 'produtoId') return { ...item, [campo]: valor }
      const produto = produtos.get(valor)
      return {
        ...item,
        produtoId: valor,
        descricao: produto?.nome || '',
        valorUnitario: produto ? Number(produto.valor || 0) : item.valorUnitario,
      }
    }))
  }

  const totalDoItem = (item) =>
    Math.max(0, Number(item.quantidade || 0) * Number(item.valorUnitario || 0) - Number(item.desconto || 0))

  return (
    <Page>
      <PageTitle
        subtitle="Pedidos, orçamentos e o que foi vendido"
        action={<Button onClick={abrirNova}><IconPlus size={16} /> Nova venda</Button>}
      >
        Vendas
      </PageTitle>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className={inputCls + ' pl-9'}
            placeholder="Buscar por cliente, produto ou cidade…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        {/* A largura mora no wrapper: `inputCls` já traz `w-full`, e entre duas
            classes de mesma especificidade quem manda é a ordem do CSS gerado. */}
        <div className="w-44 shrink-0">
          <select
            className={inputCls + ' cursor-pointer'}
            value={periodo}
            onChange={(e) => setPeriodo(e.target.value)}
            aria-label="Filtrar vendas por período"
          >
            {Object.entries(PERIODOS).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
          </select>
        </div>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {[['todos', 'Todas'], ['proposta', 'Propostas'], ['confirmada', 'Confirmadas'], ['cancelada', 'Canceladas']].map(
          ([valor, rotulo]) => (
            <button
              key={valor}
              onClick={() => setFiltro(valor)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium cursor-pointer ${
                filtro === valor ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              {rotulo}
            </button>
          ),
        )}
      </div>

      <Card>
        <p className="text-xs text-slate-400 mb-3">
          {lista.length} venda{lista.length === 1 ? '' : 's'}
          {somaListada > 0 && <> · <span className="tnum">{formatBRL(somaListada)}</span></>}
          {canceladasNaLista > 0 && ' (canceladas fora da soma)'}
        </p>
        {lista.length === 0 && (
          <Empty>
            {busca || periodo !== 'todos' || filtro !== 'todos'
              ? 'Nenhuma venda encontrada com esses filtros.'
              : 'Nenhuma venda por aqui.'}
          </Empty>
        )}
        <ul className="divide-y divide-slate-100">
          {lista.map((v) => {
            const itensVenda = itensDaVenda(v.id)
            const nomes = itensVenda.map((i) => i.descricao).filter(Boolean).join(', ')
            const parcelas = lancamentosDaVenda(v.id)
            const recebido = parcelas.filter((l) => l.status === 'realizado').length
            return (
              <li key={v.id} className="py-4 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1 basis-[16rem]">
                  <Link to={`/clientes/${v.clienteId}`} className="text-sm font-medium text-slate-900 hover:text-blue-600">
                    {clientes.get(v.clienteId)?.nome ?? '(cliente removido)'}
                  </Link>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {formatData(v.data)}
                    {v.numero ? ` · Nº ${v.numero}` : ''}
                    {nomes ? ` · ${nomes}` : ''}
                    {parcelas.length > 0 ? ` · ${recebido}/${parcelas.length} recebida(s)` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-slate-900 tnum">{formatBRL(v.total)}</span>
                  {v.tipo === 'orcamento' && <Badge color="slate">Orçamento</Badge>}
                  {v.pedidoNumero && <Badge color="slate">Pedido Nº {v.pedidoNumero}</Badge>}
                  <Badge color={STATUS_BADGE[v.status] ?? 'slate'}>{STATUS_VENDA[v.status] ?? v.status}</Badge>
                </div>
                <AcoesVenda
                  venda={v}
                  onVer={() => setDetalhe(v)}
                  onPedido={() => setPedidoVenda(v)}
                  onEditar={() => abrirEdicao(v)}
                  onConfirmar={() => mudarStatus(v, 'confirmada')}
                  onCancelar={() => mudarStatus(v, 'cancelada')}
                  onExcluir={() => setExcluir(v)}
                />
              </li>
            )
          })}
        </ul>
      </Card>

      {pedidoVenda && (
        <PedidoModal
          key={pedidoVenda.id}
          venda={pedidoVenda}
          onClose={() => setPedidoVenda(null)}
          onGerado={refresh}
        />
      )}

      {/* Detalhe: itens e situação de cada parcela */}
      <Modal title="Detalhes da venda" open={!!detalhe} onClose={() => setDetalhe(null)} size="wide">
        {detalhe && (
          <div className="space-y-5 text-sm">
            <div>
              <p className="text-[13px] font-semibold text-slate-700 mb-2">Itens</p>
              <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                {itensDaVenda(detalhe.id).map((i) => (
                  <li key={i.id} className="flex justify-between gap-3 px-3 py-2">
                    <span className="text-slate-700">
                      {i.descricao} <span className="text-slate-400">× {Number(i.quantidade)}</span>
                    </span>
                    <span className="tnum text-slate-900">{formatBRL(i.valorTotal)}</span>
                  </li>
                ))}
                {itensDaVenda(detalhe.id).length === 0 && (
                  <li className="px-3 py-2 text-slate-400">Sem itens.</li>
                )}
              </ul>
              <div className="flex justify-end gap-6 mt-2 text-xs text-slate-500">
                <span>Subtotal: <span className="tnum">{formatBRL(detalhe.subtotal)}</span></span>
                <span>Desconto: <span className="tnum">{formatBRL(detalhe.desconto)}</span></span>
                <span>Frete: <span className="tnum">{formatBRL(detalhe.frete)}</span></span>
                <span className="font-semibold text-slate-900">
                  Total: <span className="tnum">{formatBRL(detalhe.total)}</span>
                </span>
              </div>
            </div>

            {/* Como o cliente pagou. Só aparece quando há formas registradas —
                venda antiga (de antes da migração 015) não tem a lista, e o
                resumo dela já está nas contas a receber logo abaixo. */}
            {normalizarPagamentos(detalhe.pagamentos).length > 0 && (
              <div>
                <p className="text-[13px] font-semibold text-slate-700 mb-2">Formas de pagamento</p>
                <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                  {normalizarPagamentos(detalhe.pagamentos).map((pg, i) => (
                    <li key={i} className="flex flex-wrap justify-between gap-3 px-3 py-2">
                      <span className="text-slate-700">
                        {FORMAS_PAGAMENTO[pg.forma] ?? pg.forma}
                        {pg.entrada && <span className="text-slate-400"> · entrada</span>}
                        {pg.parcelas > 1 && <span className="text-slate-400"> · {pg.parcelas}x</span>}
                        {pg.primeiroVencimento && (
                          <span className="text-slate-400"> · a partir de {formatData(pg.primeiroVencimento)}</span>
                        )}
                      </span>
                      <span className="tnum text-slate-900">{formatBRL(pg.valor)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <p className="text-[13px] font-semibold text-slate-700 mb-2">Contas a receber</p>
              {lancamentosDaVenda(detalhe.id).length === 0 ? (
                <p className="text-slate-400 text-xs">
                  Nenhuma — só vendas confirmadas geram contas a receber.
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                  {lancamentosDaVenda(detalhe.id).map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="text-slate-700">{l.descricao}</span>
                      <span className="flex items-center gap-2">
                        <span className="text-xs text-slate-500">vence {formatData(l.vencimento)}</span>
                        <span className="tnum text-slate-900">{formatBRL(l.valor)}</span>
                        <Badge color={l.status === 'realizado' ? 'green' : 'amber'}>
                          {l.status === 'realizado' ? 'Recebido' : 'A receber'}
                        </Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {detalhe.observacoes && (
              <p className="text-slate-600">
                <span className="font-medium text-slate-700">Observações:</span> {detalhe.observacoes}
              </p>
            )}
          </div>
        )}
      </Modal>

      <Modal title="Excluir venda" open={!!excluir} onClose={() => setExcluir(null)}>
        {excluir && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Excluir definitivamente esta venda de{' '}
              <span className="font-semibold text-slate-900">
                {clientes.get(excluir.clienteId)?.nome ?? 'cliente removido'}
              </span>{' '}
              ({formatBRL(excluir.total)})? Os itens e as contas a receber dela saem junto.
              Essa ação não pode ser desfeita.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={() => setExcluir(null)}>Cancelar</Button>
              <Button type="button" variant="danger" onClick={confirmarExcluir}>Excluir venda</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal title={form?.id ? 'Editar venda' : 'Nova venda'} open={!!form} onClose={() => setForm(null)} size="wide">
        {form && (
          <form onSubmit={salvar} className="space-y-5 pb-20 sm:pb-0">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Cliente">
                <ClienteBusca
                  clientes={clientes.list()}
                  value={form.clienteId}
                  onChange={(id) => setForm({ ...form, clienteId: id })}
                  required
                />
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Data">
                  <input className={inputCls} type="date" required value={form.data} onChange={set('data')} />
                </Field>
                <Field label="Nº do pedido">
                  <input className={inputCls} placeholder="opcional" value={form.numero} onChange={set('numero')} />
                </Field>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Field label="Tipo">
                <select className={inputCls} value={form.tipo} onChange={set('tipo')}>
                  <option value="venda">Venda</option>
                  <option value="orcamento">Orçamento</option>
                </select>
              </Field>
              <Field label="Canal">
                <select className={inputCls} value={form.canal} onChange={set('canal')}>
                  <option value="">—</option>
                  {Object.entries(CANAIS_VENDA).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
                </select>
              </Field>
              <Field label="Validade (dias)">
                <input className={inputCls} type="number" min="0" value={form.validadeDias} onChange={set('validadeDias')} />
              </Field>
              <Field label="Situação">
                <select className={inputCls} value={form.status} onChange={set('status')}>
                  {Object.entries(STATUS_VENDA).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
                </select>
              </Field>
            </div>

            {/* Itens */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
              <p className="text-[13px] font-semibold text-slate-700">Itens da venda</p>
              {itens.map((item, i) => (
                <div key={i} className="grid grid-cols-2 sm:grid-cols-12 gap-2 items-end">
                  <div className="sm:col-span-4">
                    <Field label={i === 0 ? 'Produto' : ''}>
                      <ProdutoBusca
                        produtos={listaProdutos}
                        value={item.produtoId}
                        onChange={(id) => alterarItem(i, 'produtoId', id)}
                        ocultarIds={itens.filter((_, idx) => idx !== i).map((it) => it.produtoId).filter(Boolean)}
                      />
                    </Field>
                  </div>
                  <div className="sm:col-span-2">
                    <Field label={i === 0 ? 'Qtd.' : ''}>
                      <input
                        className={inputCls} type="number" min="1" step="1"
                        value={item.quantidade}
                        onChange={(e) => alterarItem(i, 'quantidade', e.target.value)}
                      />
                    </Field>
                  </div>
                  <div className="sm:col-span-2">
                    <Field label={i === 0 ? 'Valor un.' : ''}>
                      <input
                        className={inputCls} type="number" min="0" step="0.01"
                        value={item.valorUnitario}
                        onChange={(e) => alterarItem(i, 'valorUnitario', e.target.value)}
                      />
                    </Field>
                  </div>
                  <div className="sm:col-span-2">
                    <Field label={i === 0 ? 'Desconto' : ''}>
                      <input
                        className={inputCls} type="number" min="0" step="0.01"
                        value={item.desconto}
                        onChange={(e) => alterarItem(i, 'desconto', e.target.value)}
                      />
                    </Field>
                  </div>
                  <div className="sm:col-span-2 flex items-center gap-2">
                    <span className="text-sm tnum text-slate-700 flex-1 text-right">
                      {formatBRL(totalDoItem(item))}
                    </span>
                    <button
                      type="button"
                      onClick={() => setItens(itens.filter((_, idx) => idx !== i))}
                      className="text-red-500 hover:text-red-700 text-lg leading-none cursor-pointer px-1"
                      title="Remover item"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
              <Button type="button" variant="ghost" onClick={() => setItens([...itens, { ...ITEM_VAZIO }])}>
                <IconPlus size={14} /> Adicionar item
              </Button>
            </div>

            {/* Totais */}
            <div className="rounded-lg border border-slate-200 p-4 space-y-3">
              <p className="text-[13px] font-semibold text-slate-700">Totais</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
                <Field label="Desconto geral (R$)">
                  <input className={inputCls} type="number" min="0" step="0.01" value={form.desconto} onChange={set('desconto')} />
                </Field>
                <Field label="Frete (R$)">
                  <input className={inputCls} type="number" min="0" step="0.01" value={form.frete} onChange={set('frete')} />
                </Field>
                <div className="flex justify-between text-sm border-t border-slate-100 pt-2 sm:border-0 sm:pt-0">
                  <span className="text-slate-500">Subtotal</span>
                  <span className="tnum">{formatBRL(subtotal)}</span>
                </div>
                <div className="flex justify-between text-base font-semibold">
                  <span>Total</span>
                  <span className="tnum">{formatBRL(total)}</span>
                </div>
              </div>
            </div>

            {/* Pagamento — uma ou várias formas na mesma venda */}
            <div className="rounded-lg border border-slate-200 p-4 space-y-3">
              <p className="text-[13px] font-semibold text-slate-700">Pagamento</p>
              <PagamentosVenda pagamentos={pagamentos} onChange={setPagamentos} total={total} />
              <label className="flex items-start gap-2.5 cursor-pointer rounded-lg bg-slate-50 border border-slate-200 p-3">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600 cursor-pointer"
                  checked={form.lancarFinanceiro !== false}
                  onChange={(e) => setForm({ ...form, lancarFinanceiro: e.target.checked })}
                />
                <span>
                  <span className="block text-[13px] font-medium text-slate-700">Lançar no financeiro</span>
                  <span className="block text-xs text-slate-400 mt-0.5">
                    {form.lancarFinanceiro === false
                      ? 'Esta venda não gera contas a receber.'
                      : 'Ao confirmar a venda, cada parcela vira uma conta a receber com a forma e o vencimento dela.'}
                  </span>
                </span>
              </label>
            </div>

            {/* Campos menos frequentes ficam disponíveis sem competir com o
                fechamento principal. Se já possuem valor, abrem na edição. */}
            <details
              open={!!(form.consultor || form.consultorTelefone || form.entregaTipo || form.observacoes)}
              className="group rounded-xl border border-slate-200 bg-slate-50"
            >
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-sm font-semibold text-slate-700 [&::-webkit-details-marker]:hidden">
                Atendimento, entrega e observações
                <span className="text-slate-400 transition-transform group-open:rotate-45">+</span>
              </summary>
              <div className="border-t border-slate-200 p-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <Field label="Consultor / Vendedor">
                    <input className={inputCls} value={form.consultor} onChange={set('consultor')} />
                  </Field>
                  <Field label="Telefone do consultor">
                    <input className={inputCls} value={form.consultorTelefone} onChange={set('consultorTelefone')} />
                  </Field>
                  <Field label="Entrega">
                    <select className={inputCls} value={form.entregaTipo} onChange={set('entregaTipo')}>
                      <option value="">—</option>
                      <option value="retirada">Retirada</option>
                      <option value="endereco_cliente">Endereço do cliente</option>
                      <option value="outro">Outro endereço</option>
                    </select>
                  </Field>
                  <Field label="Previsão de entrega">
                    <input className={inputCls} type="date" value={form.entregaPrevisao} onChange={set('entregaPrevisao')} />
                  </Field>
                </div>

                {form.entregaTipo === 'outro' && (
                  <Field label="Endereço de entrega">
                    <input className={inputCls} value={form.entregaEndereco} onChange={set('entregaEndereco')} />
                  </Field>
                )}

                <Field label="Observações">
                  <textarea className={inputCls} rows="2" value={form.observacoes} onChange={set('observacoes')} />
                </Field>
              </div>
            </details>

            {form.status === 'confirmada' && (
              <p className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2">
                Confirmar gera as contas a receber e já deixa o serviço na agenda
                (instalação, se houver aparelho; troca, se for só refil).
              </p>
            )}

            {erro && (
              <p role="alert" aria-live="polite" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{erro}</p>
            )}

            <div className="sticky bottom-0 z-10 -mx-4 sm:-mx-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-300 bg-slate-100/95 px-4 sm:px-6 py-3 backdrop-blur-md">
              <div>
                <span className="block text-xs text-slate-500">Total da venda</span>
                <strong className="block text-lg tnum text-slate-900">{formatBRL(total)}</strong>
              </div>
              <div className="flex gap-2 ml-auto">
              <Button type="button" variant="secondary" onClick={() => setForm(null)} disabled={salvando}>
                Cancelar
              </Button>
              <Button type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar venda'}</Button>
              </div>
            </div>
          </form>
        )}
      </Modal>
    </Page>
  )
}
