import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  agendamentos, clientes, produtos, salvarAgendamento, mudarStatusAgendamento, excluirAgendamento,
  formatData, formatBRL, TIPOS_AGENDAMENTO, FORMAS_PAGAMENTO,
} from '../data/repository.js'
import { Card, Page, PageTitle, Button, Field, inputCls, Empty, Modal, Badge } from '../components/ui.jsx'
import { IconPlus, IconFileText, IconTrash } from '../components/icons.jsx'
import OrdemServicoModal from '../components/OrdemServicoModal.jsx'

const FORM_VAZIO = {
  clienteId: '', data: '', tipo: 'visita', observacoes: '', status: 'agendado',
  produtoIds: [], valor: '', formaPagamento: 'pix', parcelas: 1, statusPagamento: 'pendente',
}

const STATUS_BADGE = {
  agendado: ['sky', 'Agendado'],
  concluido: ['green', 'Concluído'],
  cancelado: ['red', 'Cancelado'],
}

export default function Agendamentos() {
  const [lista, setLista] = useState(agendamentos.list())
  const [form, setForm] = useState(null)
  const [filtro, setFiltro] = useState('agendado')
  const [osAgendamento, setOsAgendamento] = useState(null)
  const [agExcluir, setAgExcluir] = useState(null)
  const [excluindo, setExcluindo] = useState(false)

  const refresh = () => setLista(agendamentos.list())
  const listaClientes = clientes.list()
  const listaProdutos = produtos.list()

  const filtrados = lista
    .filter((a) => (filtro === 'todos' ? true : a.status === filtro))
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
        subtitle="Visitas, instalações e trocas de refil"
        action={<Button onClick={() => setForm({ ...FORM_VAZIO })}><IconPlus size={16} /> Novo agendamento</Button>}
      >
        Agendamentos
      </PageTitle>

      <div className="flex gap-2 mb-4">
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

      <Card>
        {filtrados.length === 0 && <Empty>Nenhum agendamento aqui.</Empty>}
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
                    {formatData(a.data)} · {TIPOS_AGENDAMENTO[a.tipo] ?? a.tipo}
                    {nomesProdutos ? ` · ${nomesProdutos}` : ''}
                    {a.observacoes ? ` · ${a.observacoes}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {Number(a.valor) > 0 && (
                    <span className="text-sm font-semibold text-slate-900 tnum">
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
                  {a.status !== 'cancelado' && (
                    <Button variant="secondary" onClick={() => setOsAgendamento(a)}>
                      <IconFileText size={16} /> Gerar OS
                    </Button>
                  )}
                  {a.status === 'agendado' && (
                    <>
                      <Button variant="ghost" onClick={() => setForm({ ...FORM_VAZIO, ...a })}>Editar</Button>
                      <Button variant="secondary" onClick={() => mudarStatus(a.id, 'concluido')}>Concluir</Button>
                      <Button variant="danger" onClick={() => mudarStatus(a.id, 'cancelado')}>Cancelar</Button>
                    </>
                  )}
                  {a.status === 'cancelado' && (
                    <Button variant="danger" onClick={() => setAgExcluir(a)} title="Excluir ordem de serviço">
                      <IconTrash size={15} /> Excluir
                    </Button>
                  )}
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
              <select className={inputCls} required value={form.clienteId} onChange={set('clienteId')}>
                <option value="">Selecione…</option>
                {listaClientes.map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Data">
                <input className={inputCls} type="date" required value={form.data} onChange={set('data')} />
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
                  <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
                    {listaProdutos.map((p) => {
                      const marcado = (form.produtoIds || []).includes(p.id)
                      return (
                        <label key={p.id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-slate-50">
                          <input type="checkbox" checked={marcado} onChange={() => alternarProduto(p.id)} />
                          <span className="text-sm text-slate-700 flex-1">{p.nome}</span>
                          <span className="text-xs text-slate-400">{formatBRL(p.valor)}</span>
                        </label>
                      )
                    })}
                  </div>
                )}
                <p className="text-xs text-slate-400 mt-1">Deixe tudo desmarcado para uma visita sem produto.</p>
              </Field>
              <div className="grid grid-cols-2 gap-4">
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
              <div className="grid grid-cols-2 gap-4">
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
