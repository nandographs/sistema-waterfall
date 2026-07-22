import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  clientes, produtos, equipamentos, vendas, agendamentos, marcarVendaPaga, excluirVenda,
  definirFotoPerfil, removerFotoPerfil,
  proximaTroca, formatBRL, formatData, enderecoCompleto, FORMAS_PAGAMENTO, TIPOS_AGENDAMENTO,
} from '../data/repository.js'
import { Card, Page, PageTitle, Button, Field, inputCls, Empty, Modal, Badge } from '../components/ui.jsx'
import { IconPlus, IconFileText, IconChevronLeft, IconUser, IconTrash } from '../components/icons.jsx'
import OrdemServicoModal from '../components/OrdemServicoModal.jsx'
import ClienteFormFields from '../components/ClienteFormFields.jsx'
import FotosCliente from '../components/FotosCliente.jsx'
import FotoUnica from '../components/FotoUnica.jsx'

const CLIENTE_VAZIO = {
  nome: '', telefone: '', email: '', cpfCnpj: '',
  endereco: '', numeroComplemento: '', bairro: '', cidade: '', uf: '', cep: '',
  observacoes: '',
}

const VENDA_VAZIA = {
  produtoId: '', valor: '', formaPagamento: 'pix', parcelas: 1,
  status: 'pago', data: new Date().toISOString().slice(0, 10), dataInstalacao: '',
}

export default function ClienteDetalhe() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [, forceRender] = useState(0)
  const refresh = () => forceRender((n) => n + 1)

  const cliente = clientes.get(id)
  const [editando, setEditando] = useState(null)
  const [vendaForm, setVendaForm] = useState(null)
  const [osAgendamento, setOsAgendamento] = useState(null)
  const [vendaExcluir, setVendaExcluir] = useState(null)
  const [removerEquip, setRemoverEquip] = useState(false)
  const [excluindo, setExcluindo] = useState(false)

  if (!cliente) {
    return (
      <Page>
        <p className="text-slate-500">Cliente não encontrado.</p>
        <Link to="/clientes" className="text-blue-600 hover:underline text-sm">← Voltar para clientes</Link>
      </Page>
    )
  }

  const hoje = new Date().toISOString().slice(0, 10)
  const meusEquipamentos = equipamentos.list().filter((e) => e.clienteId === id)
  const minhasVendas = vendas.list().filter((v) => v.clienteId === id)
  const meusAgendamentos = agendamentos.list().filter((a) => a.clienteId === id)
  const historico = meusAgendamentos
    .filter((a) => a.status === 'concluido')
    .sort((a, b) => (b.data || '').localeCompare(a.data || ''))
  const proximaVisita = meusAgendamentos
    .filter((a) => a.status === 'agendado' && a.data >= hoje)
    .sort((a, b) => a.data.localeCompare(b.data))[0]

  async function salvarEdicao(e) {
    e.preventDefault()
    await clientes.update(id, editando)
    setEditando(null)
    refresh()
  }

  async function registrarVenda(e) {
    e.preventDefault()
    const venda = await vendas.create({
      clienteId: id,
      produtoId: vendaForm.produtoId,
      valor: Number(vendaForm.valor || 0),
      formaPagamento: vendaForm.formaPagamento,
      parcelas: Number(vendaForm.parcelas || 1),
      status: vendaForm.status,
      data: vendaForm.data,
    })
    const produto = produtos.get(venda.produtoId)
    if (produto?.tipo === 'aparelho') {
      await equipamentos.create({
        clienteId: id,
        produtoId: venda.produtoId,
        dataInstalacao: vendaForm.dataInstalacao || vendaForm.data,
        dataUltimaTroca: '',
      })
    }
    setVendaForm(null)
    refresh()
  }

  async function marcarPago(vendaId) {
    await marcarVendaPaga(vendaId)
    refresh()
  }

  function abrirExcluirVenda(venda) {
    setRemoverEquip(false)
    setVendaExcluir(venda)
  }

  async function confirmarExcluirVenda() {
    setExcluindo(true)
    try {
      const equipamento = equipamentos
        .list()
        .find((eq) => eq.clienteId === id && eq.produtoId === vendaExcluir.produtoId)
      if (equipamento && removerEquip) {
        await equipamentos.remove(equipamento.id)
      }
      await excluirVenda(vendaExcluir.id)
      setVendaExcluir(null)
      refresh()
    } catch (erro) {
      alert('Não foi possível excluir a venda: ' + (erro?.message || erro))
    } finally {
      setExcluindo(false)
    }
  }

  async function excluirCliente() {
    if (confirm(`Excluir o cliente "${cliente.nome}"? Os registros dele deixarão de aparecer.`)) {
      await clientes.remove(id)
      navigate('/clientes')
    }
  }

  const set = (k) => (e) => setEditando({ ...editando, [k]: e.target.value })
  const preencherEndereco = (dados) => setEditando((atual) => ({ ...atual, ...dados }))
  const setV = (k) => (e) => setVendaForm({ ...vendaForm, [k]: e.target.value })

  function selecionarProduto(e) {
    const produto = produtos.get(e.target.value)
    setVendaForm({ ...vendaForm, produtoId: e.target.value, valor: produto?.valor ?? vendaForm.valor })
  }

  return (
    <Page>
      <Link
        to="/clientes"
        className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-blue-600 mb-3"
      >
        <IconChevronLeft size={16} /> Clientes
      </Link>
      <PageTitle
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setEditando({ ...CLIENTE_VAZIO, ...cliente })}>Editar dados</Button>
            <Button variant="danger" onClick={excluirCliente}>Excluir</Button>
          </div>
        }
      >
        {cliente.nome}
      </PageTitle>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-6">
          <Card title="Dados do cliente">
            <div className="flex justify-center mb-5">
              <FotoUnica
                url={cliente.fotoPerfilUrl}
                onEnviar={async (arquivo) => { await definirFotoPerfil(id, arquivo); refresh() }}
                onRemover={async () => { await removerFotoPerfil(id); refresh() }}
                formato="circulo"
                tamanho={104}
                placeholder={<IconUser size={48} />}
              />
            </div>
            <dl className="space-y-2 text-sm">
              <div><dt className="text-xs text-slate-500">Telefone</dt><dd>{cliente.telefone || '—'}</dd></div>
              <div><dt className="text-xs text-slate-500">E-mail</dt><dd>{cliente.email || '—'}</dd></div>
              <div><dt className="text-xs text-slate-500">CPF / CNPJ</dt><dd>{cliente.cpfCnpj || '—'}</dd></div>
              <div><dt className="text-xs text-slate-500">Endereço</dt><dd>{enderecoCompleto(cliente) || '—'}</dd></div>
              <div><dt className="text-xs text-slate-500">Observações</dt><dd>{cliente.observacoes || '—'}</dd></div>
              <div><dt className="text-xs text-slate-500">Cadastrado por</dt><dd>{cliente.criadoPor || '—'}</dd></div>
            </dl>
          </Card>

          <Card title="Próxima visita">
            {proximaVisita ? (
              <div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold">{formatData(proximaVisita.data)}</p>
                    <p className="text-xs text-slate-500">{TIPOS_AGENDAMENTO[proximaVisita.tipo]}</p>
                  </div>
                  <Badge color="sky">Agendada</Badge>
                </div>
                <div className="mt-3 pt-3 border-t border-slate-100">
                  <Button variant="ghost" onClick={() => setOsAgendamento(proximaVisita)}>
                    <IconFileText size={15} /> Gerar Ordem de Serviço
                  </Button>
                </div>
              </div>
            ) : (
              <div>
                <Empty>Nenhuma visita marcada.</Empty>
                <Link to="/agendamentos"><Button variant="ghost">+ Agendar visita</Button></Link>
              </div>
            )}
          </Card>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <Card title="Produtos e vendas">
            <div className="mb-3">
              <Button onClick={() => setVendaForm({ ...VENDA_VAZIA })}><IconPlus size={16} /> Registrar venda</Button>
            </div>
            {minhasVendas.length === 0 && <Empty>Nenhuma venda registrada para este cliente.</Empty>}
            <ul className="divide-y divide-slate-100">
              {minhasVendas.map((v) => {
                const produto = produtos.get(v.produtoId)
                const equipamento = meusEquipamentos.find((eq) => eq.produtoId === v.produtoId)
                const troca = equipamento ? proximaTroca(equipamento) : null
                return (
                  <li key={v.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{produto?.nome ?? '(produto removido)'}</p>
                      <p className="text-xs text-slate-500">
                        {formatData(v.data)} · {formatBRL(v.valor)} · {FORMAS_PAGAMENTO[v.formaPagamento]}
                        {v.parcelas > 1 ? ` (${v.parcelas}x)` : ''}
                        {troca ? ` · próxima troca de refil: ${formatData(troca)}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {v.status === 'pago' ? (
                        <Badge color="green">Pago</Badge>
                      ) : (
                        <>
                          <Badge color="amber">A receber</Badge>
                          <Button variant="ghost" onClick={() => marcarPago(v.id)}>Marcar como pago</Button>
                        </>
                      )}
                      <Button variant="danger" onClick={() => abrirExcluirVenda(v)} title="Excluir venda">
                        <IconTrash size={15} />
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </Card>

          <Card title="Histórico de serviços">
            {historico.length === 0 && <Empty>Nenhum serviço concluído ainda.</Empty>}
            <ul className="divide-y divide-slate-100">
              {historico.map((a) => (
                <li key={a.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{TIPOS_AGENDAMENTO[a.tipo] ?? a.tipo}</p>
                    <p className="text-xs text-slate-500">{formatData(a.data)}{a.observacoes ? ` · ${a.observacoes}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {a.osNumero && <Badge color="slate">OS Nº {a.osNumero}</Badge>}
                    <Badge color="green">Concluído</Badge>
                    <Button variant="ghost" onClick={() => setOsAgendamento(a)}>
                      <IconFileText size={15} /> Gerar OS
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <FotosCliente clienteId={id} agendamentos={meusAgendamentos} />
        </div>
      </div>

      <Modal title="Editar dados do cliente" open={!!editando} onClose={() => setEditando(null)}>
        {editando && (
          <form onSubmit={salvarEdicao} className="space-y-4">
            <ClienteFormFields form={editando} set={set} onEnderecoEncontrado={preencherEndereco} />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setEditando(null)}>Cancelar</Button>
              <Button type="submit">Salvar</Button>
            </div>
          </form>
        )}
      </Modal>

      {osAgendamento && (
        <OrdemServicoModal
          key={osAgendamento.id}
          agendamento={osAgendamento}
          onClose={() => setOsAgendamento(null)}
          onGerada={refresh}
        />
      )}

      <Modal title="Excluir venda" open={!!vendaExcluir} onClose={() => setVendaExcluir(null)}>
        {vendaExcluir && (() => {
          const produto = produtos.get(vendaExcluir.produtoId)
          const equipamento = equipamentos
            .list()
            .find((eq) => eq.clienteId === id && eq.produtoId === vendaExcluir.produtoId)
          return (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">
                Tem certeza que deseja excluir a venda de{' '}
                <span className="font-semibold text-slate-900">{produto?.nome ?? 'produto removido'}</span>{' '}
                no valor de <span className="font-semibold text-slate-900">{formatBRL(vendaExcluir.valor)}</span>?
                Ela será removida também do financeiro. Essa ação não pode ser desfeita.
              </p>
              {equipamento && (
                <label className="flex items-start gap-2 text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={removerEquip}
                    onChange={(e) => setRemoverEquip(e.target.checked)}
                  />
                  <span>Remover também o equipamento instalado deste cliente.</span>
                </label>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="secondary" onClick={() => setVendaExcluir(null)} disabled={excluindo}>
                  Cancelar
                </Button>
                <Button type="button" variant="danger" onClick={confirmarExcluirVenda} disabled={excluindo}>
                  {excluindo ? 'Excluindo…' : 'Excluir venda'}
                </Button>
              </div>
            </div>
          )
        })()}
      </Modal>

      <Modal title="Registrar venda" open={!!vendaForm} onClose={() => setVendaForm(null)}>
        {vendaForm && (
          <form onSubmit={registrarVenda} className="space-y-4">
            <Field label="Produto">
              <select className={inputCls} required value={vendaForm.produtoId} onChange={selecionarProduto}>
                <option value="">Selecione…</option>
                {produtos.list().map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome} — {formatBRL(p.valor)}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Valor da venda (R$)">
                <input className={inputCls} type="number" step="0.01" min="0" required value={vendaForm.valor} onChange={setV('valor')} />
              </Field>
              <Field label="Data da venda">
                <input className={inputCls} type="date" required value={vendaForm.data} onChange={setV('data')} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Forma de pagamento">
                <select className={inputCls} value={vendaForm.formaPagamento} onChange={setV('formaPagamento')}>
                  {Object.entries(FORMAS_PAGAMENTO).map(([v, r]) => (
                    <option key={v} value={v}>{r}</option>
                  ))}
                </select>
              </Field>
              <Field label="Parcelas">
                <input className={inputCls} type="number" min="1" value={vendaForm.parcelas} onChange={setV('parcelas')} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Status do pagamento">
                <select className={inputCls} value={vendaForm.status} onChange={setV('status')}>
                  <option value="pago">Pago</option>
                  <option value="pendente">A receber</option>
                </select>
              </Field>
              <Field label="Data de instalação (se aparelho)">
                <input className={inputCls} type="date" value={vendaForm.dataInstalacao} onChange={setV('dataInstalacao')} />
              </Field>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setVendaForm(null)}>Cancelar</Button>
              <Button type="submit">Registrar</Button>
            </div>
          </form>
        )}
      </Modal>
    </Page>
  )
}
