import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  lancamentos, clientes,
  salvarLancamento, excluirLancamento, darBaixa, estornarLancamento,
  formatBRL, formatData, hojeISO, somarMeses,
  resumoDoMes, variacao, somarMesesNoMes, mesDe,
  FORMAS_PAGAMENTO, CATEGORIAS_SAIDA,
} from '../data/repository.js'
import { Card, Page, PageTitle, Button, Field, inputCls, Empty, Modal, Badge } from '../components/ui.jsx'
import {
  IconPlus, IconTrash, IconWallet, IconClock, IconAlert,
  IconChevronLeft, IconChevronRight,
} from '../components/icons.jsx'

const CATEGORIAS_ENTRADA = { venda: 'Venda', servico: 'Serviço', outros: 'Outros' }
const nomeCategoria = (c) => CATEGORIAS_SAIDA[c] ?? CATEGORIAS_ENTRADA[c] ?? c

function nomeDoMes(mes) {
  const [ano, m] = mes.split('-')
  return new Date(Number(ano), Number(m) - 1, 1)
    .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}

// Variação percentual ao lado de um número. Sem base no mês anterior não há
// percentual — mostra "—" em vez de inventar um "+100%".
function Variacao({ atual, anterior, invertido = false }) {
  const v = variacao(atual, anterior)
  if (v === null) return <span className="text-xs text-slate-400">—</span>
  const positivo = invertido ? v < 0 : v > 0
  const cor = v === 0 ? 'text-slate-400' : (positivo ? 'text-emerald-600' : 'text-red-600')
  return (
    <span className={`text-xs font-medium ${cor}`}>
      {v > 0 ? '▲' : (v < 0 ? '▼' : '')} {Math.abs(v).toFixed(0)}%
    </span>
  )
}

// Uma linha do relatório: rótulo, valor do mês e comparação com o anterior.
function LinhaRelatorio({ label, valor, anterior, cor = 'text-slate-900', invertido, forte }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className={`text-sm ${forte ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>{label}</span>
      <span className="flex items-baseline gap-2">
        <Variacao atual={valor} anterior={anterior} invertido={invertido} />
        <span className={`tnum ${forte ? 'text-base font-bold' : 'text-sm font-medium'} ${cor}`}>
          {formatBRL(valor)}
        </span>
      </span>
    </div>
  )
}

const FORM_VAZIO = {
  tipo: 'saida', status: 'previsto', descricao: '', categoria: 'fornecedor',
  valor: '', vencimento: hojeISO(), dataPagamento: '', formaPagamento: 'pix',
  clienteId: '', observacoes: '', parcela: 1, parcelas: 1, origem: 'manual',
}

function Resumo({ icon, iconBg, label, value, hint }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center gap-3">
        <span className={`flex items-center justify-center w-10 h-10 rounded-lg ${iconBg}`}>{icon}</span>
        <p className="text-[13px] font-medium text-slate-500">{label}</p>
      </div>
      <p className="text-2xl font-bold text-slate-900 tracking-tight tnum mt-3">{value}</p>
      <p className="text-xs text-slate-400 mt-0.5">{hint}</p>
    </div>
  )
}

export default function Financeiro() {
  const [, forceRender] = useState(0)
  const refresh = () => forceRender((n) => n + 1)

  const [aba, setAba] = useState('receber')
  const [form, setForm] = useState(null)
  const [excluir, setExcluir] = useState(null)

  const hoje = hojeISO()
  const todos = lancamentos.list()

  const entradas = todos.filter((l) => l.tipo === 'entrada')
  const saidas = todos.filter((l) => l.tipo === 'saida')

  const aReceber = entradas.filter((l) => l.status === 'previsto')
  const aPagar = saidas.filter((l) => l.status === 'previsto')
  const recebido = entradas.filter((l) => l.status === 'realizado')
  const pago = saidas.filter((l) => l.status === 'realizado')

  const soma = (lista) => lista.reduce((s, l) => s + Number(l.valor || 0), 0)
  const saldoRealizado = soma(recebido) - soma(pago)
  const saldoPrevisto = saldoRealizado + soma(aReceber) - soma(aPagar)

  const vencidos = (lista) => lista.filter((l) => l.vencimento && l.vencimento < hoje)

  // ---- Fluxo de caixa: os próximos 6 meses, mês a mês ----
  const fluxo = useMemo(() => {
    const meses = Array.from({ length: 6 }, (_, i) => somarMeses(hoje.slice(0, 8) + '01', i).slice(0, 7))
    let acumulado = saldoRealizado
    return meses.map((mes) => {
      const doMes = todos.filter((l) => (l.vencimento || '').startsWith(mes))
      const entra = soma(doMes.filter((l) => l.tipo === 'entrada'))
      const sai = soma(doMes.filter((l) => l.tipo === 'saida'))
      acumulado += entra - sai
      return { mes, entra, sai, resultado: entra - sai, acumulado }
    })
  }, [todos, saldoRealizado, hoje])

  const maiorMovimento = Math.max(1, ...fluxo.map((f) => Math.max(f.entra, f.sai)))

  // ---- Relatório do mês (com o mês anterior lado a lado) ----
  const [mesRelatorio, setMesRelatorio] = useState(() => mesDe(hojeISO()))
  const mesAnterior = somarMesesNoMes(mesRelatorio, -1)
  const relatorio = useMemo(() => resumoDoMes(todos, mesRelatorio), [todos, mesRelatorio])
  const relatorioAnterior = useMemo(() => resumoDoMes(todos, mesAnterior), [todos, mesAnterior])
  const ehMesAtual = mesRelatorio === mesDe(hoje)

  async function salvar(e) {
    e.preventDefault()
    await salvarLancamento(form)
    setForm(null)
    refresh()
  }

  async function alternarBaixa(l) {
    if (l.status === 'realizado') await estornarLancamento(l.id)
    else await darBaixa(l.id)
    refresh()
  }

  async function confirmarExcluir() {
    await excluirLancamento(excluir.id)
    setExcluir(null)
    refresh()
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const listaDaAba = {
    receber: aReceber,
    pagar: aPagar,
    realizados: [...recebido, ...pago],
  }[aba].sort((a, b) => (a.vencimento || '').localeCompare(b.vencimento || ''))

  function Linha({ l }) {
    const atrasado = l.status === 'previsto' && l.vencimento && l.vencimento < hoje
    const cliente = l.clienteId ? clientes.get(l.clienteId) : null
    return (
      <li className="py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-900 flex items-center gap-1.5">
            {atrasado && <IconAlert size={15} className="text-red-500 shrink-0" />}
            {l.descricao || '(sem descrição)'}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            {l.status === 'realizado'
              ? `Baixado em ${formatData(l.dataPagamento)}`
              : `Vence em ${formatData(l.vencimento)}`}
            {l.categoria ? ` · ${CATEGORIAS_SAIDA[l.categoria] ?? l.categoria}` : ''}
            {l.formaPagamento ? ` · ${FORMAS_PAGAMENTO[l.formaPagamento] ?? l.formaPagamento}` : ''}
            {cliente ? ' · ' : ''}
            {cliente && (
              <Link to={`/clientes/${cliente.id}`} className="hover:text-blue-600">{cliente.nome}</Link>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-semibold tnum ${l.tipo === 'entrada' ? 'text-emerald-700' : 'text-red-600'}`}>
            {l.tipo === 'entrada' ? '+' : '−'} {formatBRL(l.valor)}
          </span>
          {l.status === 'realizado' ? (
            <Badge color="green">{l.tipo === 'entrada' ? 'Recebido' : 'Pago'}</Badge>
          ) : (
            <Badge color={atrasado ? 'red' : 'amber'}>
              {atrasado ? 'Vencido' : (l.tipo === 'entrada' ? 'A receber' : 'A pagar')}
            </Badge>
          )}
          <Button variant="ghost" onClick={() => alternarBaixa(l)}>
            {l.status === 'realizado' ? 'Estornar' : 'Dar baixa'}
          </Button>
          {/* Lançamentos de venda/agendamento são geridos na origem: apagar aqui
              deixaria a venda sem a sua parcela. Só os manuais têm lixeira. */}
          {l.origem === 'manual' && (
            <Button variant="danger" onClick={() => setExcluir(l)} title="Excluir lançamento">
              <IconTrash size={15} />
            </Button>
          )}
        </div>
      </li>
    )
  }

  return (
    <Page>
      <PageTitle
        subtitle="Entradas, saídas e o caixa dos próximos meses"
        action={
          <Button onClick={() => setForm({ ...FORM_VAZIO })}>
            <IconPlus size={16} /> Novo lançamento
          </Button>
        }
      >
        Financeiro
      </PageTitle>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <Resumo
          icon={<IconWallet size={20} className="text-emerald-600" />}
          iconBg="bg-emerald-50"
          label="A receber"
          value={formatBRL(soma(aReceber))}
          hint={`${aReceber.length} conta(s) · ${vencidos(aReceber).length} vencida(s)`}
        />
        <Resumo
          icon={<IconWallet size={20} className="text-red-600" />}
          iconBg="bg-red-50"
          label="A pagar"
          value={formatBRL(soma(aPagar))}
          hint={`${aPagar.length} conta(s) · ${vencidos(aPagar).length} vencida(s)`}
        />
        <Resumo
          icon={<IconClock size={20} className="text-blue-600" />}
          iconBg="bg-blue-50"
          label="Saldo realizado"
          value={formatBRL(saldoRealizado)}
          hint="O que já entrou menos o que já saiu"
        />
        <Resumo
          icon={<IconClock size={20} className="text-amber-600" />}
          iconBg="bg-amber-50"
          label="Saldo projetado"
          value={formatBRL(saldoPrevisto)}
          hint="Se tudo que está previsto se confirmar"
        />
      </div>

      {/* Relatório mensal */}
      <Card
        className="mb-6"
        title="Relatório do mês"
        action={
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setMesRelatorio(somarMesesNoMes(mesRelatorio, -1))}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
              aria-label="Mês anterior"
              title="Mês anterior"
            >
              <IconChevronLeft size={16} />
            </button>
            <span className="text-sm font-semibold text-slate-900 min-w-[9rem] text-center first-letter:uppercase">
              {nomeDoMes(mesRelatorio)}
            </span>
            <button
              type="button"
              onClick={() => setMesRelatorio(somarMesesNoMes(mesRelatorio, 1))}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
              aria-label="Próximo mês"
              title="Próximo mês"
            >
              <IconChevronRight size={16} />
            </button>
            {!ehMesAtual && (
              <Button variant="ghost" onClick={() => setMesRelatorio(mesDe(hoje))}>Mês atual</Button>
            )}
          </div>
        }
      >
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Números do mês, comparados com o mês anterior */}
          <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1">
            <div>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1 pb-1.5 border-b border-slate-100">
                Entrou
              </p>
              <LinhaRelatorio
                label="Recebido"
                valor={relatorio.entradas.realizado}
                anterior={relatorioAnterior.entradas.realizado}
                cor="text-emerald-700"
              />
              <LinhaRelatorio
                label="Ainda a receber no mês"
                valor={relatorio.entradas.previsto}
                anterior={relatorioAnterior.entradas.previsto}
                cor="text-slate-500"
              />
            </div>

            <div>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1 pb-1.5 border-b border-slate-100">
                Saiu
              </p>
              <LinhaRelatorio
                label="Pago"
                valor={relatorio.saidas.realizado}
                anterior={relatorioAnterior.saidas.realizado}
                cor="text-red-600"
                invertido
              />
              <LinhaRelatorio
                label="Ainda a pagar no mês"
                valor={relatorio.saidas.previsto}
                anterior={relatorioAnterior.saidas.previsto}
                cor="text-slate-500"
                invertido
              />
            </div>

            <div className="sm:col-span-2 mt-2 pt-3 border-t border-slate-200">
              <LinhaRelatorio
                label="Resultado do mês"
                valor={relatorio.resultado}
                anterior={relatorioAnterior.resultado}
                cor={relatorio.resultado >= 0 ? 'text-emerald-700' : 'text-red-600'}
                forte
              />
              <LinhaRelatorio
                label={ehMesAtual ? 'Projeção de fechamento' : 'Resultado com o previsto'}
                valor={relatorio.projetado}
                anterior={relatorioAnterior.projetado}
                cor="text-slate-500"
              />
              <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
                O resultado conta o dinheiro que de fato se moveu no mês (pela data da baixa).
                O previsto conta o que vence no mês e ainda está em aberto.
                A comparação é com {nomeDoMes(mesAnterior)}.
              </p>
            </div>
          </div>

          {/* Para onde foi o dinheiro */}
          <div className="space-y-5">
            <div>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">
                Saídas por categoria
              </p>
              {relatorio.categorias.saidas.length === 0 ? (
                <p className="text-xs text-slate-400">Nenhuma saída paga neste mês.</p>
              ) : (
                <ul className="space-y-2">
                  {relatorio.categorias.saidas.map(({ categoria, total }) => (
                    <li key={categoria}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-slate-600">{nomeCategoria(categoria)}</span>
                        <span className="tnum font-medium text-slate-900">{formatBRL(total)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-slate-100" role="presentation">
                        <div
                          className="h-1.5 rounded-full bg-red-400"
                          style={{ width: `${Math.round((total / Math.max(1, relatorio.saidas.realizado)) * 100)}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">
                Entradas por categoria
              </p>
              {relatorio.categorias.entradas.length === 0 ? (
                <p className="text-xs text-slate-400">Nenhum recebimento neste mês.</p>
              ) : (
                <ul className="space-y-2">
                  {relatorio.categorias.entradas.map(({ categoria, total }) => (
                    <li key={categoria}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-slate-600">{nomeCategoria(categoria)}</span>
                        <span className="tnum font-medium text-slate-900">{formatBRL(total)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-slate-100" role="presentation">
                        <div
                          className="h-1.5 rounded-full bg-emerald-400"
                          style={{ width: `${Math.round((total / Math.max(1, relatorio.entradas.realizado)) * 100)}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="flex gap-2 mb-4 flex-wrap">
            {[['receber', `A receber (${aReceber.length})`],
              ['pagar', `A pagar (${aPagar.length})`],
              ['realizados', `Realizados (${recebido.length + pago.length})`]].map(([valor, rotulo]) => (
              <button
                key={valor}
                onClick={() => setAba(valor)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium cursor-pointer ${
                  aba === valor ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                }`}
              >
                {rotulo}
              </button>
            ))}
          </div>

          <Card>
            {listaDaAba.length === 0 && <Empty>Nada por aqui.</Empty>}
            <ul className="divide-y divide-slate-100">
              {listaDaAba.map((l) => <Linha key={l.id} l={l} />)}
            </ul>
          </Card>
        </div>

        <Card title="Fluxo de caixa — próximos 6 meses">
          <ul className="space-y-4">
            {fluxo.map((f) => {
              const [ano, mes] = f.mes.split('-')
              const rotulo = new Date(Number(ano), Number(mes) - 1, 1)
                .toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })
              return (
                <li key={f.mes}>
                  <div className="flex items-center justify-between text-sm mb-1.5">
                    <span className="text-slate-600 first-letter:uppercase">{rotulo}</span>
                    <span className={`font-semibold tnum ${f.resultado >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                      {f.resultado >= 0 ? '+' : '−'} {formatBRL(Math.abs(f.resultado))}
                    </span>
                  </div>
                  <div className="space-y-1" role="presentation">
                    <div className="h-1.5 rounded-full bg-slate-100">
                      <div
                        className="h-1.5 rounded-full bg-emerald-400"
                        style={{ width: `${Math.round((f.entra / maiorMovimento) * 100)}%` }}
                      />
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-100">
                      <div
                        className="h-1.5 rounded-full bg-red-400"
                        style={{ width: `${Math.round((f.sai / maiorMovimento) * 100)}%` }}
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1 tnum">
                    Acumulado: {formatBRL(f.acumulado)}
                  </p>
                </li>
              )
            })}
          </ul>
          <p className="text-[11px] text-slate-400 mt-4 pt-3 border-t border-slate-100">
            Barra verde: entradas previstas no mês. Barra vermelha: saídas.
            O acumulado parte do saldo já realizado.
          </p>
        </Card>
      </div>

      <Modal title="Excluir lançamento" open={!!excluir} onClose={() => setExcluir(null)}>
        {excluir && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Excluir <span className="font-semibold text-slate-900">{excluir.descricao}</span>{' '}
              ({formatBRL(excluir.valor)})? Essa ação não pode ser desfeita.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={() => setExcluir(null)}>Cancelar</Button>
              <Button type="button" variant="danger" onClick={confirmarExcluir}>Excluir</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal title={form?.id ? 'Editar lançamento' : 'Novo lançamento'} open={!!form} onClose={() => setForm(null)}>
        {form && (
          <form onSubmit={salvar} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Tipo">
                <select className={inputCls} value={form.tipo} onChange={set('tipo')}>
                  <option value="saida">Saída (conta a pagar)</option>
                  <option value="entrada">Entrada (a receber)</option>
                </select>
              </Field>
              <Field label="Valor (R$)">
                <input className={inputCls} type="number" step="0.01" min="0" required value={form.valor} onChange={set('valor')} />
              </Field>
            </div>
            <Field label="Descrição">
              <input className={inputCls} required placeholder="ex.: Compra de refis — fornecedor X" value={form.descricao} onChange={set('descricao')} />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Categoria">
                <select className={inputCls} value={form.categoria} onChange={set('categoria')}>
                  {form.tipo === 'saida'
                    ? Object.entries(CATEGORIAS_SAIDA).map(([v, r]) => <option key={v} value={v}>{r}</option>)
                    : [['venda', 'Venda'], ['servico', 'Serviço'], ['outros', 'Outros']].map(([v, r]) => (
                        <option key={v} value={v}>{r}</option>
                      ))}
                </select>
              </Field>
              <Field label="Forma de pagamento">
                <select className={inputCls} value={form.formaPagamento} onChange={set('formaPagamento')}>
                  {Object.entries(FORMAS_PAGAMENTO).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Vencimento">
                <input className={inputCls} type="date" required value={form.vencimento} onChange={set('vencimento')} />
              </Field>
              <Field label="Situação">
                <select
                  className={inputCls}
                  value={form.status}
                  onChange={(e) => setForm({
                    ...form,
                    status: e.target.value,
                    // Dar baixa sem data de pagamento deixaria o caixa sem saber
                    // QUANDO o dinheiro se moveu; assume o vencimento.
                    dataPagamento: e.target.value === 'realizado'
                      ? (form.dataPagamento || form.vencimento || hoje)
                      : '',
                  })}
                >
                  <option value="previsto">Previsto</option>
                  <option value="realizado">Já {form.tipo === 'entrada' ? 'recebido' : 'pago'}</option>
                </select>
              </Field>
            </div>
            {form.status === 'realizado' && (
              <Field label="Data do pagamento">
                <input className={inputCls} type="date" value={form.dataPagamento} onChange={set('dataPagamento')} />
              </Field>
            )}
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
