import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  clientes, produtos, equipamentos, vendas, lancamentos, agendamentos,
  salvarVenda, darBaixa, excluirVenda, itensDaVenda, agendarProximaTroca,
  registrarEquipamento, definirFotoPerfil, removerFotoPerfil,
  proximoPasso, linhaDoTempoDoCliente, oportunidadesDoCliente, conversaDoCliente,
  proximaTroca, formatBRL, formatData, enderecoCompleto,
  FORMAS_PAGAMENTO, STATUS_VENDA, RESULTADOS_ATIVIDADE, ETAPAS_FUNIL, ETAPAS_FECHADAS,
} from '../data/repository.js'
import { hojeISO, formatHora, diaCurto } from '../lib/datas.js'
import { Card, Page, PageTitle, Button, Field, inputCls, Empty, Modal, Badge, notificar } from '../components/ui.jsx'
import { IconPlus, IconFileText, IconChevronLeft, IconUser, IconTrash, IconEye, IconAlert, IconMessage } from '../components/icons.jsx'
import { paraE164 } from '../lib/telefone.js'
import { IconeDoEvento, estiloDoEvento } from '../components/evento.jsx'
import AtividadeModal, { atividadeNova } from '../components/AtividadeModal.jsx'
import OrdemServicoModal from '../components/OrdemServicoModal.jsx'
import AgendamentoDetalheModal from '../components/AgendamentoDetalheModal.jsx'
import PedidoModal from '../components/PedidoModal.jsx'
import OportunidadeModal, { oportunidadeNova } from '../components/OportunidadeModal.jsx'
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
  status: 'pago', data: hojeISO(), dataInstalacao: '',
}

const EQUIPAMENTO_VAZIO = { produtoId: '', dataInstalacao: hojeISO() }

export default function ClienteDetalhe() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [, forceRender] = useState(0)
  const refresh = () => forceRender((n) => n + 1)

  const cliente = clientes.get(id)
  // A foto que ELE usa no WhatsApp — só entra na ficha quando não há foto de
  // cadastro. Não é `fotoDoContato` de propósito: ali a do cadastro vence, e
  // aqui a do cadastro já é o `url` do componente logo abaixo.
  const avatarWhatsapp = conversaDoCliente(id)?.avatarUrl || ''
  // `paraE164` e não `cliente.telefone`: telefone preenchido com lixo ("a
  // combinar", um ramal) não dá um número para o qual se possa escrever, e um
  // botão que leva a lugar nenhum é pior que botão nenhum.
  const temTelefone = !!paraE164(cliente?.telefone)
  const [editando, setEditando] = useState(null)
  const [vendaForm, setVendaForm] = useState(null)
  const [osAgendamento, setOsAgendamento] = useState(null)
  const [agDetalhe, setAgDetalhe] = useState(null)
  const [vendaExcluir, setVendaExcluir] = useState(null)
  const [pedidoVenda, setPedidoVenda] = useState(null)
  const [removerEquip, setRemoverEquip] = useState(false)
  const [excluindo, setExcluindo] = useState(false)
  const [atividadeForm, setAtividadeForm] = useState(null)
  const [oportunidadeForm, setOportunidadeForm] = useState(null)
  const [equipForm, setEquipForm] = useState(null)

  if (!cliente) {
    return (
      <Page>
        <p className="text-slate-500">Cliente não encontrado.</p>
        <Link to="/clientes" className="text-blue-600 hover:underline text-sm">← Voltar para clientes</Link>
      </Page>
    )
  }

  const hoje = hojeISO()
  const meusEquipamentos = equipamentos.list().filter((e) => e.clienteId === id)
  const minhasVendas = vendas
    .list()
    .filter((v) => v.clienteId === id)
    .sort((a, b) => (b.data || '').localeCompare(a.data || ''))
  // Contas a receber deste cliente, venham de venda ou de agendamento avulso.
  const meusRecebimentos = lancamentos
    .list()
    .filter((l) => l.clienteId === id && l.tipo === 'entrada')
    .sort((a, b) => (a.vencimento || '').localeCompare(b.vencimento || ''))
  const meusAgendamentos = agendamentos.list().filter((a) => a.clienteId === id)

  // As negociações deste cliente — abertas e fechadas, da mais recente para a
  // mais antiga. É o que o funil mostra em coluna, visto pelo lado do cliente.
  const minhasOportunidades = oportunidadesDoCliente(id)

  // A próxima coisa marcada para este cliente, seja contato ou serviço.
  const passo = proximoPasso(id)
  const historicoCompleto = linhaDoTempoDoCliente(id)

  async function salvarEdicao(e) {
    e.preventDefault()
    await clientes.update(id, editando)
    setEditando(null)
    refresh()
  }

  // Cadastro rápido: registra uma venda de um produto só, de algo que já foi
  // entregue/instalado. Por isso não gera visita de instalação (agendarServicos:
  // false) — o equipamento é criado aqui mesmo, e a troca do refil já fica
  // programada a partir da data de instalação informada.
  async function registrarVenda(e) {
    e.preventDefault()
    const produto = produtos.get(vendaForm.produtoId)
    const parcelas = Math.max(1, Number(vendaForm.parcelas || 1))

    const venda = await salvarVenda(
      {
        clienteId: id,
        data: vendaForm.data,
        tipo: 'venda',
        status: 'confirmada',
        formaPagamento: vendaForm.formaPagamento,
        condicao: parcelas > 1 ? 'parcelado' : 'a_vista',
        parcelas,
        primeiroVencimento: vendaForm.data,
      },
      [{
        produtoId: vendaForm.produtoId,
        descricao: produto?.nome || '',
        quantidade: 1,
        valorUnitario: Number(vendaForm.valor || 0),
        desconto: 0,
      }],
      { agendarServicos: false },
    )

    if (vendaForm.status === 'pago') {
      for (const l of lancamentos.list().filter((l) => l.vendaId === venda.id)) {
        await darBaixa(l.id, vendaForm.data)
      }
    }

    if (produto?.tipo === 'aparelho') {
      const jaTem = equipamentos
        .list()
        .find((eq) => eq.clienteId === id && eq.produtoId === produto.id)
      const equipamento = jaTem ?? await equipamentos.create({
        clienteId: id,
        produtoId: produto.id,
        dataInstalacao: vendaForm.dataInstalacao || vendaForm.data,
        dataUltimaTroca: '',
      })
      await agendarProximaTroca(equipamento)
    }

    setVendaForm(null)
    refresh()
  }

  // Coloca um aparelho na ficha sem venda: é o que já está na casa do cliente e
  // nunca passou pelo caixa. A troca de refil já sai agendada no repositório.
  async function adicionarEquipamento(e) {
    e.preventDefault()
    try {
      await registrarEquipamento({
        clienteId: id,
        produtoId: equipForm.produtoId,
        dataInstalacao: equipForm.dataInstalacao,
      })
      setEquipForm(null)
      refresh()
    } catch (erro) {
      notificar('Não foi possível adicionar o produto: ' + (erro?.message || erro), 'erro')
    }
  }

  async function removerEquipamento(equipamento) {
    const nome = produtos.get(equipamento.produtoId)?.nome || 'este produto'
    if (!confirm(`Remover "${nome}" da ficha do cliente? As vendas e o histórico não são afetados.`)) return
    await equipamentos.remove(equipamento.id)
    refresh()
  }

  async function receber(lancamentoId) {
    await darBaixa(lancamentoId)
    refresh()
  }

  function abrirExcluirVenda(venda) {
    setRemoverEquip(false)
    setVendaExcluir(venda)
  }

  async function confirmarExcluirVenda() {
    setExcluindo(true)
    try {
      const itens = itensDaVenda(vendaExcluir.id)
      const equipamento = equipamentos
        .list()
        .find((eq) => eq.clienteId === id && itens.some((i) => i.produtoId === eq.produtoId))
      if (equipamento && removerEquip) {
        await equipamentos.remove(equipamento.id)
      }
      await excluirVenda(vendaExcluir.id)
      setVendaExcluir(null)
      refresh()
    } catch (erro) {
      notificar('Não foi possível excluir a venda: ' + (erro?.message || erro), 'erro')
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
            <div className="flex flex-col items-center mb-5">
              <FotoUnica
                url={cliente.fotoPerfilUrl}
                onEnviar={async (arquivo) => { await definirFotoPerfil(id, arquivo); refresh() }}
                onRemover={async () => { await removerFotoPerfil(id); refresh() }}
                formato="circulo"
                tamanho={104}
                // A foto do WhatsApp entra como PLACEHOLDER, e não como `url`,
                // e a diferença importa: `url` é a foto DESTA ficha — a que o
                // botão de câmera troca e o "Remover foto" apaga. A do WhatsApp
                // não é sua para apagar; ela só ocupa o vazio até você tirar uma.
                // Passando por aqui, o "Remover foto" continua escondido
                // enquanto não existir foto de verdade, que é o correto.
                placeholder={
                  avatarWhatsapp
                    ? <img src={avatarWhatsapp} alt="" className="w-full h-full object-cover" />
                    : <IconUser size={48} />
                }
              />
              {/* Sem esta linha a foto do WhatsApp passa por foto do cadastro, e
                  aí ninguém entende por que ela mudou sozinha um dia. */}
              {!cliente.fotoPerfilUrl && avatarWhatsapp && (
                <span className="mt-2 text-[11px] text-slate-500">Foto do WhatsApp</span>
              )}
            </div>

            {/* Chamar no WhatsApp — só quando há telefone, porque sem número o
                botão não teria para onde ir.
                Ele NÃO manda mensagem: abre a conversa dentro do sistema, com o
                campo pronto. O que se escreve para um cliente costuma depender
                do que já foi dito, e disparar algo de dentro da ficha, sem ver o
                histórico, é como se manda a mensagem errada.
                A conversa não é criada agora: se você abrir e desistir, nada
                fica para trás (ver o rascunho em WhatsApp.jsx). */}
            {temTelefone && (
              <Link
                to={`/whatsapp?cliente=${id}`}
                className="mb-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50"
              >
                <IconMessage size={16} className="text-emerald-500" />
                {conversaDoCliente(id) ? 'Abrir conversa no WhatsApp' : 'Chamar no WhatsApp'}
              </Link>
            )}

            <dl className="space-y-2 text-sm">
              <div><dt className="text-xs text-slate-500">Telefone</dt><dd>{cliente.telefone || '—'}</dd></div>
              <div><dt className="text-xs text-slate-500">E-mail</dt><dd>{cliente.email || '—'}</dd></div>
              <div><dt className="text-xs text-slate-500">CPF / CNPJ</dt><dd>{cliente.cpfCnpj || '—'}</dd></div>
              <div><dt className="text-xs text-slate-500">Endereço</dt><dd>{enderecoCompleto(cliente) || '—'}</dd></div>
              <div><dt className="text-xs text-slate-500">Observações</dt><dd>{cliente.observacoes || '—'}</dd></div>
              <div><dt className="text-xs text-slate-500">Cadastrado por</dt><dd>{cliente.criadoPor || '—'}</dd></div>
            </dl>
          </Card>

          {/* Um cliente sem próximo passo é um cliente que você vai esquecer.
              A ficha diz isso em voz alta em vez de deixar a ausência passar. */}
          <Card title="Próximo passo">
            {passo ? (
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex items-start gap-2">
                    <IconeDoEvento evento={passo} className={`mt-0.5 shrink-0 ${estiloDoEvento(passo).icone}`} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{passo.titulo}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {formatData(passo.data)}
                        {formatHora(passo.hora) ? ` às ${formatHora(passo.hora)}` : ''}
                      </p>
                    </div>
                  </div>
                  <Badge color={passo.atrasado ? 'red' : 'sky'}>
                    {passo.atrasado ? 'Atrasado' : 'Marcado'}
                  </Badge>
                </div>
                <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap gap-2">
                  {passo.fonte === 'atividade' ? (
                    <Button variant="ghost" onClick={() => setAtividadeForm(passo.registro)}>
                      <IconEye size={15} /> Abrir
                    </Button>
                  ) : (
                    <>
                      <Button variant="ghost" onClick={() => setAgDetalhe(passo.registro)}>
                        <IconEye size={15} /> Ver informações
                      </Button>
                      <Button variant="ghost" onClick={() => setOsAgendamento(passo.registro)}>
                        <IconFileText size={15} /> Gerar Ordem de Serviço
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div>
                <p className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                  <IconAlert size={16} className="shrink-0" />
                  Sem próximo passo definido.
                </p>
                <div className="flex flex-wrap gap-2 mt-3">
                  <Button
                    variant="ghost"
                    onClick={() => setAtividadeForm(atividadeNova({ clienteId: id }))}
                  >
                    <IconPlus size={15} /> Marcar contato
                  </Button>
                  <Link to="/agendamentos"><Button variant="ghost">+ Agendar visita</Button></Link>
                </div>
              </div>
            )}
          </Card>

        </div>

        <div className="lg:col-span-2 space-y-6">
          <Card
            title="Negociações"
            action={
              <Link to="/crm" className="text-xs font-medium text-blue-600 hover:underline">
                Abrir CRM
              </Link>
            }
          >
            <div className="mb-3">
              <Button onClick={() => setOportunidadeForm(oportunidadeNova({ clienteId: id }))}>
                <IconPlus size={16} /> Nova negociação
              </Button>
            </div>
            {minhasOportunidades.length === 0 && (
              <Empty>Nenhuma negociação registrada para este cliente.</Empty>
            )}
            <ul className="divide-y divide-slate-100">
              {minhasOportunidades.map((o) => (
                <li key={o.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{o.titulo}</p>
                    <p className="text-xs text-slate-500">
                      {Number(o.valorEstimado || 0) ? `${formatBRL(o.valorEstimado)} · ` : ''}
                      {ETAPAS_FECHADAS.includes(o.etapa) && o.fechadaEm
                        ? `fechada em ${formatData(o.fechadaEm)}`
                        : (o.dataPrevista ? `previsão ${formatData(o.dataPrevista)}` : 'sem previsão')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge color={
                      o.etapa === 'ganho' ? 'green' : (o.etapa === 'perdido' ? 'red' : 'sky')
                    }>
                      {ETAPAS_FUNIL[o.etapa] ?? o.etapa}
                    </Badge>
                    <Button variant="ghost" onClick={() => setOportunidadeForm(o)} title="Abrir negociação">
                      <IconEye size={15} /> Ver
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          {/* O que está instalado na casa do cliente — venha de venda daqui ou
              de um aparelho que já era dele. É desta lista que sai a agenda de
              troca de refil. */}
          <Card title="Equipamentos do cliente">
            <div className="mb-3">
              <Button variant="secondary" onClick={() => setEquipForm({ ...EQUIPAMENTO_VAZIO })}>
                <IconPlus size={16} /> Adicionar produto (sem venda)
              </Button>
            </div>
            {meusEquipamentos.length === 0 && (
              <Empty>Nenhum equipamento registrado na ficha deste cliente.</Empty>
            )}
            <ul className="divide-y divide-slate-100">
              {meusEquipamentos.map((eq) => {
                const produto = produtos.get(eq.produtoId)
                const troca = proximaTroca(eq)
                return (
                  <li key={eq.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{produto?.nome || 'Produto removido do catálogo'}</p>
                      <p className="text-xs text-slate-500">
                        Instalado em {formatData(eq.dataInstalacao)}
                        {eq.dataUltimaTroca ? ` · última troca ${formatData(eq.dataUltimaTroca)}` : ''}
                        {troca ? ` · próxima troca de refil: ${formatData(troca)}` : ''}
                      </p>
                    </div>
                    <Button variant="danger" onClick={() => removerEquipamento(eq)} title="Remover da ficha">
                      <IconTrash size={15} />
                    </Button>
                  </li>
                )
              })}
            </ul>
          </Card>

          <Card title="Produtos e vendas">
            <div className="mb-3">
              <Button onClick={() => setVendaForm({ ...VENDA_VAZIA })}><IconPlus size={16} /> Registrar venda</Button>
            </div>
            {minhasVendas.length === 0 && <Empty>Nenhuma venda registrada para este cliente.</Empty>}
            <ul className="divide-y divide-slate-100">
              {minhasVendas.map((v) => {
                const itens = itensDaVenda(v.id)
                const nomes = itens.map((i) => i.descricao).filter(Boolean).join(', ')
                const equipamento = meusEquipamentos.find((eq) =>
                  itens.some((i) => i.produtoId === eq.produtoId))
                const troca = equipamento ? proximaTroca(equipamento) : null
                return (
                  <li key={v.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{nomes || 'Venda sem itens'}</p>
                      <p className="text-xs text-slate-500">
                        {formatData(v.data)} · {formatBRL(v.total)} · {FORMAS_PAGAMENTO[v.formaPagamento]}
                        {Number(v.parcelas) > 1 ? ` (${v.parcelas}x)` : ''}
                        {troca ? ` · próxima troca de refil: ${formatData(troca)}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge color={
                        v.status === 'confirmada' ? 'green' : (v.status === 'cancelada' ? 'red' : 'sky')
                      }>
                        {STATUS_VENDA[v.status] ?? v.status}
                      </Badge>
                      <Button variant="ghost" onClick={() => setPedidoVenda(v)} title="Gerar pedido">
                        <IconFileText size={15} /> Pedido
                      </Button>
                      <Button variant="danger" onClick={() => abrirExcluirVenda(v)} title="Excluir venda">
                        <IconTrash size={15} />
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </Card>

          <Card title="Contas a receber">
            {meusRecebimentos.length === 0 && <Empty>Nada a receber deste cliente.</Empty>}
            <ul className="divide-y divide-slate-100">
              {meusRecebimentos.map((l) => (
                <li key={l.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900">{l.descricao || 'Recebimento'}</p>
                    <p className="text-xs text-slate-500">
                      Vence em {formatData(l.vencimento)} · {FORMAS_PAGAMENTO[l.formaPagamento] ?? '—'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900 tnum">{formatBRL(l.valor)}</span>
                    {l.status === 'realizado' ? (
                      <Badge color="green">Recebido</Badge>
                    ) : (
                      <>
                        <Badge color={l.vencimento && l.vencimento < hoje ? 'red' : 'amber'}>
                          {l.vencimento && l.vencimento < hoje ? 'Vencido' : 'A receber'}
                        </Badge>
                        <Button variant="ghost" onClick={() => receber(l.id)}>Dar baixa</Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          {/* Linha do tempo: contatos, serviços, vendas e pagamentos numa
              ordem só. É aqui que "o cliente falou tal coisa" fica consultável
              — antes de ligar você lê os últimos itens e sabe onde parou. */}
          <Card
            title="Linha do tempo"
            action={
              <button
                type="button"
                onClick={() => setAtividadeForm(atividadeNova({ clienteId: id }))}
                className="text-xs font-medium text-blue-600 hover:underline cursor-pointer"
              >
                + Registrar contato
              </button>
            }
          >
            {historicoCompleto.length === 0 && <Empty>Nada registrado para este cliente ainda.</Empty>}
            <ul className="divide-y divide-slate-100">
              {historicoCompleto.map((item) => (
                <li key={item.id} className="py-3 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex items-start gap-2.5">
                    <span className="w-11 shrink-0 text-xs text-slate-400 tnum pt-0.5">
                      {diaCurto(item.quando)}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900">{item.titulo}</p>
                      {item.detalhe && (
                        <p className="text-xs text-slate-500 mt-0.5">{item.detalhe}</p>
                      )}
                      {item.categoria === 'atividade' && item.registro.resultado && (
                        <p className="text-xs text-slate-400 mt-0.5">
                          {RESULTADOS_ATIVIDADE[item.registro.resultado]}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {item.categoria === 'atividade' && (
                      <>
                        {item.registro.status === 'pendente' && <Badge color="amber">Em aberto</Badge>}
                        <Button variant="ghost" onClick={() => setAtividadeForm(item.registro)} title="Abrir">
                          <IconEye size={15} /> Ver
                        </Button>
                      </>
                    )}
                    {item.categoria === 'agendamento' && (
                      <>
                        {item.registro.osNumero && <Badge color="slate">OS Nº {item.registro.osNumero}</Badge>}
                        <Badge color={item.registro.status === 'concluido' ? 'green' : item.registro.status === 'cancelado' ? 'red' : 'sky'}>
                          {item.registro.status === 'concluido' ? 'Concluído' : item.registro.status === 'cancelado' ? 'Cancelado' : 'Agendado'}
                        </Badge>
                        <Button variant="ghost" onClick={() => setAgDetalhe(item.registro)} title="Ver informações">
                          <IconEye size={15} /> Ver
                        </Button>
                        <Button variant="ghost" onClick={() => setOsAgendamento(item.registro)}>
                          <IconFileText size={15} /> OS
                        </Button>
                      </>
                    )}
                    {item.categoria === 'venda' && (
                      <Badge color="sky">{formatBRL(item.registro.total)}</Badge>
                    )}
                    {item.categoria === 'pagamento' && (
                      <Badge color="green">{formatBRL(item.registro.valor)}</Badge>
                    )}
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

      {agDetalhe && (
        <AgendamentoDetalheModal
          agendamento={agDetalhe}
          onClose={() => setAgDetalhe(null)}
          onCriarTarefa={(ag) => {
            setAgDetalhe(null)
            setAtividadeForm(atividadeNova({ clienteId: id, tipo: 'tarefa', agendamentoId: ag.id }))
          }}
        />
      )}

      {atividadeForm && (
        <AtividadeModal
          key={atividadeForm.id || 'nova-atividade'}
          atividade={atividadeForm}
          onFechar={() => setAtividadeForm(null)}
          onSalvo={refresh}
        />
      )}

      {oportunidadeForm && (
        <OportunidadeModal
          key={oportunidadeForm.id || 'nova-oportunidade'}
          oportunidade={oportunidadeForm}
          onFechar={() => setOportunidadeForm(null)}
          onSalvo={refresh}
        />
      )}


      {pedidoVenda && (
        <PedidoModal
          key={pedidoVenda.id}
          venda={pedidoVenda}
          onClose={() => setPedidoVenda(null)}
          onGerado={refresh}
        />
      )}

      <Modal title="Excluir venda" open={!!vendaExcluir} onClose={() => setVendaExcluir(null)}>
        {vendaExcluir && (() => {
          const itens = itensDaVenda(vendaExcluir.id)
          const nomes = itens.map((i) => i.descricao).filter(Boolean).join(', ')
          const equipamento = equipamentos
            .list()
            .find((eq) => eq.clienteId === id && itens.some((i) => i.produtoId === eq.produtoId))
          return (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">
                Tem certeza que deseja excluir a venda de{' '}
                <span className="font-semibold text-slate-900">{nomes || 'sem itens'}</span>{' '}
                no valor de <span className="font-semibold text-slate-900">{formatBRL(vendaExcluir.total)}</span>?
                Os itens e as contas a receber dela saem junto. Essa ação não pode ser desfeita.
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

      <Modal title="Adicionar produto à ficha" open={!!equipForm} onClose={() => setEquipForm(null)}>
        {equipForm && (
          <form onSubmit={adicionarEquipamento} className="space-y-4">
            <p className="text-sm text-slate-600">
              Registra um aparelho que já está com o cliente, sem gerar venda nem
              conta a receber. A troca de refil já fica programada a partir da
              data de instalação.
            </p>
            <Field label="Produto">
              <select
                className={inputCls}
                required
                value={equipForm.produtoId}
                onChange={(e) => setEquipForm({ ...equipForm, produtoId: e.target.value })}
              >
                <option value="">Selecione…</option>
                {produtos.list().filter((p) => p.tipo === 'aparelho').map((p) => (
                  <option key={p.id} value={p.id}>{p.nome}</option>
                ))}
              </select>
            </Field>
            <Field label="Data de instalação">
              <input
                className={inputCls}
                type="date"
                required
                value={equipForm.dataInstalacao}
                onChange={(e) => setEquipForm({ ...equipForm, dataInstalacao: e.target.value })}
              />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setEquipForm(null)}>Cancelar</Button>
              <Button type="submit">Adicionar</Button>
            </div>
          </form>
        )}
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Valor da venda (R$)">
                <input className={inputCls} type="number" step="0.01" min="0" required value={vendaForm.valor} onChange={setV('valor')} />
              </Field>
              <Field label="Data da venda">
                <input className={inputCls} type="date" required value={vendaForm.data} onChange={setV('data')} />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
