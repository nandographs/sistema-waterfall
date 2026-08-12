import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  agendamentos, clientes, produtos, salvarAgendamento, mudarStatusAgendamento, excluirAgendamento,
  formatData, formatBRL, TIPOS_AGENDAMENTO, FORMAS_PAGAMENTO,
} from '../data/repository.js'
import { formatHora } from '../lib/datas.js'
import { Card, Page, PageTitle, Button, Field, inputCls, Empty, Modal, Badge } from '../components/ui.jsx'
import { IconPlus, IconFileText, IconTrash, IconEye, IconSearch, IconFilter, IconMais } from '../components/icons.jsx'
import OrdemServicoModal from '../components/OrdemServicoModal.jsx'
import AgendamentoDetalheModal from '../components/AgendamentoDetalheModal.jsx'
import ClienteBusca from '../components/ClienteBusca.jsx'
import ProdutoBusca from '../components/ProdutoBusca.jsx'

const FORM_VAZIO = {
  clienteId: '', data: '', hora: '', tipo: 'visita', observacoes: '', status: 'agendado',
  produtoIds: [], valor: '', formaPagamento: 'pix', parcelas: 1, statusPagamento: 'pendente',
}

const STATUS_BADGE = {
  agendado: ['sky', 'Agendado'],
  concluido: ['green', 'Concluído'],
  cancelado: ['red', 'Cancelado'],
}

// As ações de uma linha somavam 706px numa tela de 375px — a página inteira
// rolava de lado. No desktop continuam em linha; no celular fica só "Ver" e um
// "⋯" que abre o resto empilhado, com alvos de 44px. Concluir e Cancelar, que
// antes ficavam a 4px um do outro, agora estão separados e rotulados.
function AcoesAgendamento({ agendamento: a, onVer, onGerarOS, onEditar, onConcluir, onCancelar, onExcluir }) {
  const [aberto, setAberto] = useState(false)
  const secundarias = []

  if (a.status !== 'cancelado') {
    secundarias.push({ rotulo: 'Gerar OS', Icon: IconFileText, onClick: onGerarOS })
  }
  if (a.status === 'agendado') {
    secundarias.push({ rotulo: 'Editar', onClick: onEditar })
    secundarias.push({ rotulo: 'Concluir', onClick: onConcluir })
    secundarias.push({ rotulo: 'Cancelar', onClick: onCancelar, perigo: true })
  }
  if (a.status === 'cancelado') {
    secundarias.push({ rotulo: 'Excluir', Icon: IconTrash, onClick: onExcluir, perigo: true })
  }

  return (
    <>
      {/* Desktop: tudo visível, como sempre foi */}
      <div className="hidden sm:flex items-center gap-2">
        <Button variant="ghost" onClick={onVer}><IconEye size={16} /> Ver</Button>
        {a.status !== 'cancelado' && (
          <Button variant="secondary" onClick={onGerarOS}><IconFileText size={16} /> Gerar OS</Button>
        )}
        {a.status === 'agendado' && (
          <>
            <Button variant="ghost" onClick={onEditar}>Editar</Button>
            <Button variant="secondary" onClick={onConcluir}>Concluir</Button>
            <Button variant="danger" onClick={onCancelar}>Cancelar</Button>
          </>
        )}
        {a.status === 'cancelado' && (
          <Button variant="danger" onClick={onExcluir}><IconTrash size={15} /> Excluir</Button>
        )}
      </div>

      {/* Mobile: uma ação primária e o resto atrás do "⋯" */}
      <div className="sm:hidden w-full">
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onVer}>
            <IconEye size={16} /> Ver
          </Button>
          {secundarias.length > 0 && (
            <button
              type="button"
              onClick={() => setAberto((v) => !v)}
              className="shrink-0 min-h-11 w-11 inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 cursor-pointer"
              aria-label={`Mais ações para ${a.status === 'agendado' ? 'este agendamento' : 'este registro'}`}
              aria-expanded={aberto}
            >
              <IconMais size={18} />
            </button>
          )}
        </div>
        {aberto && (
          <div className="mt-2 rounded-lg border border-slate-200 overflow-hidden">
            {secundarias.map(({ rotulo, Icon, onClick, perigo }) => (
              <button
                key={rotulo}
                type="button"
                onClick={() => { setAberto(false); onClick() }}
                className={`flex items-center gap-2 w-full px-3 min-h-11 text-sm font-medium text-left cursor-pointer border-b border-slate-100 last:border-b-0 ${
                  perigo ? 'text-red-600' : 'text-slate-700'
                }`}
              >
                {Icon && <Icon size={16} />} {rotulo}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

export default function Agendamentos() {
  const [lista, setLista] = useState(agendamentos.list())
  const [form, setForm] = useState(null)
  const [filtro, setFiltro] = useState('agendado')
  const [busca, setBusca] = useState('')
  const [dataDe, setDataDe] = useState('')
  const [dataAte, setDataAte] = useState('')
  const [osAgendamento, setOsAgendamento] = useState(null)
  const [agDetalhe, setAgDetalhe] = useState(null)
  const [agExcluir, setAgExcluir] = useState(null)
  const [excluindo, setExcluindo] = useState(false)

  // Painel "Filtrar por" (abre/fecha; fecha ao clicar fora) — mesmo padrão da
  // tela de Clientes.
  const [painelAberto, setPainelAberto] = useState(false)
  const painelRef = useRef(null)
  useEffect(() => {
    if (!painelAberto) return
    function aoClicarFora(e) {
      if (painelRef.current && !painelRef.current.contains(e.target)) setPainelAberto(false)
    }
    document.addEventListener('mousedown', aoClicarFora)
    return () => document.removeEventListener('mousedown', aoClicarFora)
  }, [painelAberto])

  const refresh = () => setLista(agendamentos.list())
  const listaClientes = clientes.list()
  const listaProdutos = produtos.list()

  const qtdFiltros = [dataDe, dataAte].filter(Boolean).length
  const filtrosAtivos = qtdFiltros > 0
  const limparFiltros = () => { setDataDe(''); setDataAte('') }

  const filtrados = lista
    .filter((a) => (filtro === 'todos' ? true : a.status === filtro))
    .filter((a) => {
      const q = busca.trim().toLowerCase()
      if (!q) return true
      return (clientes.get(a.clienteId)?.nome ?? '').toLowerCase().includes(q)
    })
    .filter((a) => !dataDe || (a.data || '') >= dataDe)
    .filter((a) => !dataAte || (a.data || '') <= dataAte)
    .sort((a, b) => (a.data || '').localeCompare(b.data || ''))

  async function salvar(e) {
    e.preventDefault()
    await salvarAgendamento(form)
    setForm(null)
    refresh()
  }

  async function mudarStatus(id, status) {
    await mudarStatusAgendamento(id, status)
    refresh()
  }

  async function confirmarExcluir() {
    setExcluindo(true)
    try {
      await excluirAgendamento(agExcluir.id)
      setAgExcluir(null)
      refresh()
    } catch (erro) {
      alert('Não foi possível excluir a ordem de serviço: ' + (erro?.message || erro))
    } finally {
      setExcluindo(false)
    }
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  // Marca/desmarca um produto do serviço e recalcula o valor somando a tabela
  // dos produtos escolhidos (o valor continua editável manualmente depois).
  function alternarProduto(id) {
    const atuais = Array.isArray(form.produtoIds) ? form.produtoIds : []
    const novos = atuais.includes(id) ? atuais.filter((x) => x !== id) : [...atuais, id]
    const soma = novos.reduce((s, pid) => s + Number(produtos.get(pid)?.valor || 0), 0)
    setForm({ ...form, produtoIds: novos, valor: soma || '' })
  }

  return (
    <Page>
      <PageTitle
        subtitle="Visitas, instalações e trocas de refil — o serviço em campo"
        action={<Button onClick={() => setForm({ ...FORM_VAZIO })}><IconPlus size={16} /> Novo agendamento</Button>}
      >
        Serviços
      </PageTitle>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {[['agendado', 'Agendados'], ['concluido', 'Concluídos'], ['cancelado', 'Cancelados'], ['todos', 'Todos']].map(
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

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className={inputCls + ' pl-9'}
            placeholder="Buscar por cliente…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>

        <div className="relative" ref={painelRef}>
          <Button variant="secondary" onClick={() => setPainelAberto((v) => !v)}>
            <IconFilter size={16} /> Filtrar por
            {qtdFiltros > 0 && (
              <span className="ml-1 inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-blue-600 text-white text-xs font-semibold">
                {qtdFiltros}
              </span>
            )}
          </Button>

          {painelAberto && (
            <div className="absolute right-0 z-20 mt-2 w-72 max-w-[calc(100vw-3rem)] bg-white rounded-xl border border-slate-200 shadow-lg p-4 space-y-4">
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Data — de</label>
                <input
                  className={inputCls}
                  type="date"
                  value={dataDe}
                  onChange={(e) => setDataDe(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Data — até</label>
                <input
                  className={inputCls}
                  type="date"
                  value={dataAte}
                  onChange={(e) => setDataAte(e.target.value)}
                />
              </div>
              {filtrosAtivos && (
                <button
                  className="w-full text-sm font-medium text-slate-500 hover:text-slate-700 cursor-pointer pt-1 border-t border-slate-100"
                  onClick={limparFiltros}
                >
                  Limpar filtros
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <Card>
        <p className="text-xs text-slate-400 mb-3">
          {filtrados.length} agendamento{filtrados.length === 1 ? '' : 's'}
        </p>
        {filtrados.length === 0 && (
          <Empty>{busca || filtrosAtivos ? 'Nenhum agendamento encontrado.' : 'Nenhum agendamento aqui.'}</Empty>
        )}
        <ul className="divide-y divide-slate-100">
          {filtrados.map((a) => {
            const [cor, rotulo] = STATUS_BADGE[a.status] ?? ['slate', a.status]
            const idsProdutos = a.produtoIds?.length ? a.produtoIds : (a.produtoId ? [a.produtoId] : [])
            const nomesProdutos = idsProdutos.map((id) => produtos.get(id)?.nome).filter(Boolean).join(', ')
            return (
              <li key={a.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <Link to={`/clientes/${a.clienteId}`} className="text-sm font-medium text-slate-900 hover:text-blue-600">
                    {clientes.get(a.clienteId)?.nome ?? '(cliente removido)'}
                  </Link>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {formatData(a.data)}{formatHora(a.hora) ? ` às ${formatHora(a.hora)}` : ''} · {TIPOS_AGENDAMENTO[a.tipo] ?? a.tipo}
                    {nomesProdutos ? ` · ${nomesProdutos}` : ''}
                    {a.observacoes ? ` · ${a.observacoes}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                  {Number(a.valor) > 0 && (
                    <span className="text-sm font-semibold text-slate-900 tnum inline-flex items-center gap-1.5">
                      {formatBRL(a.valor)}
                      {a.status !== 'cancelado' && (
                        <Badge color={a.statusPagamento === 'pago' ? 'green' : 'amber'}>
                          {a.statusPagamento === 'pago' ? 'Pago' : 'A receber'}
                        </Badge>
                      )}
                    </span>
                  )}
                  {a.osNumero && <Badge color="slate">OS Nº {a.osNumero}</Badge>}
                  <Badge color={cor}>{rotulo}</Badge>
                  <AcoesAgendamento
                    agendamento={a}
                    onVer={() => setAgDetalhe(a)}
                    onGerarOS={() => setOsAgendamento(a)}
                    onEditar={() => setForm({ ...FORM_VAZIO, ...a })}
                    onConcluir={() => mudarStatus(a.id, 'concluido')}
                    onCancelar={() => mudarStatus(a.id, 'cancelado')}
                    onExcluir={() => setAgExcluir(a)}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      </Card>

      {osAgendamento && (
        <OrdemServicoModal
          key={osAgendamento.id}
          agendamento={osAgendamento}
          onClose={() => setOsAgendamento(null)}
          onGerada={refresh}
        />
      )}

      {agDetalhe && (
        <AgendamentoDetalheModal
          agendamento={agDetalhe}
          onClose={() => setAgDetalhe(null)}
          onEditar={(a) => { setAgDetalhe(null); setForm({ ...FORM_VAZIO, ...a }) }}
        />
      )}

      <Modal title="Excluir ordem de serviço" open={!!agExcluir} onClose={() => setAgExcluir(null)}>
        {agExcluir && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Excluir definitivamente esta ordem de serviço cancelada de{' '}
              <span className="font-semibold text-slate-900">
                {clientes.get(agExcluir.clienteId)?.nome ?? 'cliente removido'}
              </span>
              {' '}({formatData(agExcluir.data)} · {TIPOS_AGENDAMENTO[agExcluir.tipo] ?? agExcluir.tipo})?
              Essa ação não pode ser desfeita.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={() => setAgExcluir(null)} disabled={excluindo}>
                Cancelar
              </Button>
              <Button type="button" variant="danger" onClick={confirmarExcluir} disabled={excluindo}>
                {excluindo ? 'Excluindo…' : 'Excluir ordem de serviço'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal title={form?.id ? 'Editar agendamento' : 'Novo agendamento'} open={!!form} onClose={() => setForm(null)}>
        {form && (
          <form onSubmit={salvar} className="space-y-4">
            <Field label="Cliente">
              <ClienteBusca
                clientes={listaClientes}
                value={form.clienteId}
                onChange={(id) => setForm({ ...form, clienteId: id })}
                required
              />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Data">
                <input className={inputCls} type="date" required value={form.data} onChange={set('data')} />
              </Field>
              <Field label="Hora">
                <input className={inputCls} type="time" value={form.hora} onChange={set('hora')} />
              </Field>
              <Field label="Tipo de serviço">
                <select className={inputCls} value={form.tipo} onChange={set('tipo')}>
                  {Object.entries(TIPOS_AGENDAMENTO).map(([v, r]) => (
                    <option key={v} value={v}>{r}</option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-4">
              <p className="text-[13px] font-semibold text-slate-700">Financeiro do serviço</p>
              <Field label="Produtos / serviços">
                {listaProdutos.length === 0 ? (
                  <p className="text-xs text-slate-400">Nenhum produto cadastrado.</p>
                ) : (
                  <>
                    <ProdutoBusca
                      produtos={listaProdutos}
                      onChange={alternarProduto}
                      ocultarIds={form.produtoIds || []}
                      limparAoSelecionar
                      placeholder="Busque por nome ou código e tecle Enter…"
                    />
                    {(form.produtoIds || []).length > 0 && (
                      <ul className="mt-2 rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
                        {(form.produtoIds || []).map((id) => {
                          const p = produtos.get(id)
                          return (
                            <li key={id} className="flex items-center gap-2.5 px-3 py-2">
                              {p?.codigo && (
                                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500 tnum">
                                  {p.codigo}
                                </span>
                              )}
                              <span className="text-sm text-slate-700 flex-1 truncate">
                                {p?.nome ?? '(produto removido)'}
                              </span>
                              <span className="text-xs text-slate-400 tnum">{formatBRL(p?.valor)}</span>
                              <button
                                type="button"
                                onClick={() => alternarProduto(id)}
                                className="text-red-500 hover:text-red-700 text-lg leading-none cursor-pointer px-1"
                                title="Remover produto"
                                aria-label={`Remover ${p?.nome ?? 'produto'}`}
                              >
                                ×
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </>
                )}
                <p className="text-xs text-slate-400 mt-1">
                  Deixe a lista vazia para uma visita sem produto.
                </p>
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Valor do serviço (R$)">
                  <input
                    className={inputCls}
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0,00"
                    value={form.valor}
                    onChange={set('valor')}
                  />
                </Field>
                <Field label="Parcelas">
                  <input className={inputCls} type="number" min="1" value={form.parcelas} onChange={set('parcelas')} />
                </Field>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Forma de pagamento">
                  <select className={inputCls} value={form.formaPagamento} onChange={set('formaPagamento')}>
                    {Object.entries(FORMAS_PAGAMENTO).map(([v, r]) => (
                      <option key={v} value={v}>{r}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Situação do pagamento">
                  <select className={inputCls} value={form.statusPagamento} onChange={set('statusPagamento')}>
                    <option value="pendente">A receber</option>
                    <option value="pago">Pago</option>
                  </select>
                </Field>
              </div>
              <p className="text-xs text-slate-400">
                Deixe o valor em branco para agendamentos sem cobrança. Quando houver valor, ele entra
                automaticamente no financeiro do dashboard.
              </p>
            </div>

            <Field label="Observações">
              <textarea className={inputCls} rows="2" value={form.observacoes} onChange={set('observacoes')} />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setForm(null)}>Cancelar</Button>
              <Button type="submit">Salvar</Button>
            </div>
          </form>
        )}
      </Modal>
    </Page>
  )
}
