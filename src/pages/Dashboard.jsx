import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  agendamentos, clientes, equipamentos, lancamentos, produtos,
  eventosDoDia, eventosPorDia, pendenciasAtrasadas,
  concluirAtividade, mudarStatusAgendamento,
  proximaTroca, formatBRL, formatData, FORMAS_PAGAMENTO, TIPOS_AGENDAMENTO,
  resumoDoFunil, oportunidadesParadas, ETAPAS_ABERTAS, ETAPAS_FUNIL,
} from '../data/repository.js'
import { hojeISO, mesAtual, mesDe, gradeDoMes, diaExtenso } from '../lib/datas.js'
import { Card, Badge, Empty, Button, notificar } from '../components/ui.jsx'
import { IconWallet, IconClock, IconCalendar, IconPlus, IconAlert } from '../components/icons.jsx'
import { LinhaEvento } from '../components/evento.jsx'
import CapturaRapida from '../components/CapturaRapida.jsx'
import MiniCalendario from '../components/MiniCalendario.jsx'
import AtividadeModal, { atividadeNova } from '../components/AtividadeModal.jsx'
import AgendamentoDetalheModal from '../components/AgendamentoDetalheModal.jsx'
import { usuarioAtual } from '../lib/auth.js'

// Saudações do topo do dashboard — uma é sorteada a cada carregamento.
// {nome} é o primeiro nome de quem está logado.
const SAUDACOES = [
  (nome) => `Bem-vindo de volta, ${nome}!`,
  (nome) => `Que bom te ver, ${nome}!`,
  (nome) => `E aí, ${nome}? Bora fazer acontecer.`,
  (nome) => `Olá, ${nome}! Pronto pra começar?`,
  (nome) => `De volta à ativa, ${nome}!`,
]

function saudacaoAleatoria() {
  const bruto = (usuarioAtual() || '').trim().split(/\s+/)[0]
  if (!bruto) return 'Bem-vindo de volta'
  const nome = bruto.charAt(0).toUpperCase() + bruto.slice(1)
  return SAUDACOES[Math.floor(Math.random() * SAUDACOES.length)](nome)
}

function Kpi({ icon, label, value, hint, tone = 'dark' }) {
  // `light` é o KPI de destaque: azul da marca cheio, contraste garantido nos
  // dois temas. Os demais tons usam as escalas semânticas (acompanham o tema).
  const destaque = tone === 'light'
  const tons = {
    light: 'bg-[var(--accent-blue)] text-[var(--btn-primary-fg)] border-transparent',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    coral: 'bg-red-50 text-red-700 border-red-200',
    dark: 'ui-card bg-white text-slate-900 border-slate-200',
  }
  const secundario = destaque ? 'text-[var(--btn-primary-fg)] opacity-70' : 'text-slate-500'

  return (
    <article className={`min-h-40 rounded-2xl border p-5 flex flex-col justify-between ${tons[tone]}`}>
      <div className="flex items-start justify-between gap-3">
        <p className={`text-[13px] font-semibold ${secundario}`}>{label}</p>
        <span className={`flex h-9 w-9 items-center justify-center rounded-full ${
          destaque ? 'bg-black/10 text-[var(--btn-primary-fg)]' : 'bg-slate-500/15 text-slate-500'
        }`}>
          {icon}
        </span>
      </div>
      <div>
        <p className="text-2xl xl:text-[2rem] font-extrabold tracking-[-0.04em] tnum mt-5">{value}</p>
        <p className={`text-xs mt-1 ${secundario}`}>{hint}</p>
      </div>
    </article>
  )
}

export default function Dashboard({ wallpaper }) {
  // Sorteada uma vez por montagem (a cada login/abertura do dashboard).
  const [saudacao] = useState(saudacaoAleatoria)
  const navigate = useNavigate()

  const [form, setForm] = useState(null)
  const [concluindo, setConcluindo] = useState(null)
  const [agDetalhe, setAgDetalhe] = useState(null)
  const [mesMini, setMesMini] = useState(mesAtual())
  // As telas leem do cache em memória do repositório; basta forçar o render
  // para elas verem o que acabou de ser gravado (mesmo padrão de ClienteDetalhe).
  const [, forcarRender] = useState(0)
  const recarregar = () => forcarRender((n) => n + 1)

  const hoje = hojeISO()
  const mesCorrente = mesDe(hoje)

  const proximasVisitas = agendamentos
    .list()
    .filter((a) => a.status === 'agendado' && a.data >= hoje)
    .sort((a, b) => a.data.localeCompare(b.data))

  const visitasDoMes = agendamentos.list().filter((a) => a.data?.startsWith(mesCorrente) && a.status !== 'cancelado')

  const trocasPrevistas = equipamentos
    .list()
    .map((eq) => ({ eq, prevista: proximaTroca(eq) }))
    .filter(({ prevista }) => prevista && prevista <= mesCorrente + '-31')
    .sort((a, b) => a.prevista.localeCompare(b.prevista))

  // ---- Financeiro (tudo sai do caixa único: a tabela de lançamentos) ----
  const todos = lancamentos.list()
  const entradas = todos.filter((l) => l.tipo === 'entrada')
  const saidas = todos.filter((l) => l.tipo === 'saida')

  // "Vendido no mês" conta pela data de vencimento (quando o dinheiro é devido),
  // não pela data em que o registro foi criado.
  const entradasDoMes = entradas.filter((l) => l.vencimento?.startsWith(mesCorrente))
  const totalVendidoMes = entradasDoMes.reduce((s, l) => s + Number(l.valor || 0), 0)

  const pendentes = entradas.filter((l) => l.status === 'previsto')
  const totalAReceber = pendentes.reduce((s, l) => s + Number(l.valor || 0), 0)

  const aPagar = saidas.filter((l) => l.status === 'previsto')
  const totalAPagar = aPagar.reduce((s, l) => s + Number(l.valor || 0), 0)
  const vencidasAPagar = aPagar.filter((l) => l.vencimento && l.vencimento < hoje)

  const aReceberPorForma = Object.keys(FORMAS_PAGAMENTO).map((forma) => ({
    forma,
    total: pendentes.filter((l) => l.formaPagamento === forma).reduce((s, l) => s + Number(l.valor || 0), 0),
  })).filter((f) => f.total > 0)
  const maiorForma = Math.max(1, ...aReceberPorForma.map((f) => f.total))

  const nomeCliente = (id) => clientes.get(id)?.nome ?? '(cliente removido)'

  // ---- Funil ----
  // O número que interessa aqui não é quantas negociações existem, e sim
  // quantas pararam: negócio esquecido não avisa que foi esquecido.
  const resumoFunil = resumoDoFunil()
  const funilAbertas = ETAPAS_ABERTAS.reduce((s, etapa) => s + resumoFunil[etapa].quantidade, 0)
  const funilEmJogo = ETAPAS_ABERTAS.reduce((s, etapa) => s + resumoFunil[etapa].valor, 0)
  const funilParadas = oportunidadesParadas(7)

  // ---- O dia ----
  // A pergunta que o dashboard tem que responder às 8h da manhã é uma só:
  // o que eu faço hoje? Atrasados primeiro, porque é o que muda a resposta.
  const atrasados = pendenciasAtrasadas(hoje)
  const eventosHoje = eventosDoDia(hoje)
  const pendentesHoje = eventosHoje.filter((e) => e.pendente)

  const gradeMini = gradeDoMes(mesMini)
  const eventosDoMini = gradeMini.length
    ? eventosPorDia(gradeMini[0], gradeMini[gradeMini.length - 1])
    : new Map()

  async function concluirEvento(evento) {
    try {
      if (evento.fonte === 'agendamento') {
        await mudarStatusAgendamento(evento.registro.id, 'concluido')
        recarregar()
        return
      }
      const atividade = evento.registro
      if (['tarefa', 'nota'].includes(atividade.tipo)) {
        await concluirAtividade(atividade.id, { resultado: 'sucesso' })
        recarregar()
        return
      }
      setConcluindo(atividade)
    } catch (erro) {
      notificar('Não foi possível concluir: ' + (erro?.message || erro), 'erro')
    }
  }

  function abrirEvento(evento) {
    if (evento.fonte === 'atividade') setForm(evento.registro)
    else setAgDetalhe(evento.registro)
  }

  // ---- Hero ----
  const dataExtenso = diaExtenso(hoje)

  const partesResumo = []
  if (atrasados.length > 0) {
    partesResumo.push(`${atrasados.length} pendência${atrasados.length > 1 ? 's' : ''} atrasada${atrasados.length > 1 ? 's' : ''}`)
  }
  if (pendentesHoje.length > 0) {
    partesResumo.push(`${pendentesHoje.length} ${pendentesHoje.length > 1 ? 'itens' : 'item'} para hoje`)
  }
  if (proximasVisitas.length > 0) {
    partesResumo.push(
      `${proximasVisitas.length} visita${proximasVisitas.length > 1 ? 's' : ''} agendada${proximasVisitas.length > 1 ? 's' : ''}`,
    )
  }
  if (trocasPrevistas.length > 0) {
    partesResumo.push(`${trocasPrevistas.length} troca${trocasPrevistas.length > 1 ? 's' : ''} de refil prevista${trocasPrevistas.length > 1 ? 's' : ''}`)
  }
  if (totalAReceber > 0) partesResumo.push(`${formatBRL(totalAReceber)} a receber`)

  const resumoDoMes = partesResumo.length
    ? `Você tem ${partesResumo.join(', ')}.`
    : 'Nenhuma pendência por aqui. Comece cadastrando um cliente ou agendando uma visita.'

  return (
    <div className="px-4 sm:px-6 py-5 lg:px-8 lg:py-7 pb-28 lg:pb-10 max-w-[1480px] mx-auto w-full">
      <header className="relative overflow-hidden rounded-2xl border border-slate-200 mb-5 lg:mb-6 min-h-48 flex items-end">
        <img
          src={wallpaper.src}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover opacity-45 saturate-50"
        />
        <div className="absolute inset-0 bg-[#0b0a10]/80" />
        <div className="relative w-full p-5 sm:p-7 lg:p-8 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold text-blue-200 first-letter:uppercase">{dataExtenso}</p>
            <h2 className="text-3xl lg:text-[2.5rem] font-extrabold text-white tracking-[-0.04em] mt-2">
              {saudacao}
            </h2>
            <p className="text-sm text-white/70 mt-2 leading-relaxed max-w-xl">{resumoDoMes}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/agendamentos">
              <Button><IconPlus size={16} /> Novo agendamento</Button>
            </Link>
            <Link to="/clientes">
              <Button variant="hero"><IconPlus size={16} /> Novo cliente</Button>
            </Link>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(390px,0.88fr)] gap-5 lg:gap-6 mb-6">
        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          <Kpi
            tone="light"
            icon={<IconWallet size={18} />}
            label="Vendido no mês"
            value={formatBRL(totalVendidoMes)}
            hint={`${entradasDoMes.length} lançamento${entradasDoMes.length === 1 ? '' : 's'}`}
          />
          <Kpi
            tone="blue"
            icon={<IconClock size={18} />}
            label="A receber"
            value={formatBRL(totalAReceber)}
            hint={`${pendentes.length} pagamento${pendentes.length === 1 ? '' : 's'} pendente${pendentes.length === 1 ? '' : 's'}`}
          />
          <Kpi
            tone={vencidasAPagar.length ? 'coral' : 'dark'}
            icon={<IconWallet size={18} />}
            label="A pagar"
            value={formatBRL(totalAPagar)}
            hint={
              vencidasAPagar.length
                ? `${vencidasAPagar.length} conta${vencidasAPagar.length === 1 ? '' : 's'} vencida${vencidasAPagar.length === 1 ? '' : 's'}`
                : `${aPagar.length} conta${aPagar.length === 1 ? '' : 's'} em aberto`
            }
          />
          <Kpi
            tone="green"
            icon={<IconCalendar size={18} />}
            label="Visitas no mês"
            value={visitasDoMes.length}
            hint={`${trocasPrevistas.length} troca${trocasPrevistas.length === 1 ? '' : 's'} de refil prevista${trocasPrevistas.length === 1 ? '' : 's'}`}
          />
        </div>

        {/* O dia ocupa o primeiro lugar no mobile e o painel dominante à direita
            no desktop: é o bloco de decisão, não mais um KPI. */}
        <section className="ui-card order-first xl:order-none rounded-2xl border border-slate-200 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div>
              <p className="text-xs font-semibold text-slate-500">Prioridades</p>
              <h3 className="text-xl font-bold tracking-[-0.03em] text-slate-900 mt-1">Hoje</h3>
            </div>
            <Link to="/agenda" className="rounded-xl bg-[var(--nav-active-bg)] px-3.5 py-2 text-xs font-bold text-[var(--nav-active-fg)] hover:opacity-90">
              Abrir agenda
            </Link>
          </div>

          {atrasados.length > 0 && (
            <div className="mb-2 rounded-xl bg-red-50 border border-red-200 px-3">
              <p className="flex items-center gap-1.5 text-[11px] font-bold text-red-700 pt-3">
                <IconAlert size={12} /> {atrasados.length} atrasada{atrasados.length === 1 ? '' : 's'}
              </p>
              <ul className="divide-y divide-red-200/60">
                {atrasados.slice(0, 2).map((evento) => (
                  <LinhaEvento key={evento.id} evento={evento} onAbrir={abrirEvento} onConcluir={concluirEvento} />
                ))}
              </ul>
            </div>
          )}

          {eventosHoje.length === 0 ? (
            <p className="text-sm text-slate-500 py-7 text-center">Nada marcado para hoje.</p>
          ) : (
            <ul className="divide-y divide-slate-200">
              {eventosHoje.slice(0, 5).map((evento) => (
                <LinhaEvento key={evento.id} evento={evento} onAbrir={abrirEvento} onConcluir={concluirEvento} />
              ))}
            </ul>
          )}

          <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setForm(atividadeNova({ data: hoje }))}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-blue-700 hover:bg-blue-50 cursor-pointer"
            >
              <IconPlus size={15} /> Adicionar ao dia
            </button>
            {eventosHoje.length > 5 && (
              <span className="text-xs text-slate-500">+{eventosHoje.length - 5} depois</span>
            )}
          </div>
        </section>
      </div>

      {/* Registrar é o gesto mais frequente do sistema; ele fica na home, já
          aberto, ao lado do calendário do mês. */}
      <div className="grid grid-cols-1 xl:grid-cols-[1.08fr_.92fr] gap-5 lg:gap-6 mb-6">
        <Card title="Registrar agora">
          <CapturaRapida onRegistrado={recarregar} />
        </Card>

        <Card
          title="Calendário"
          action={<Link to="/agenda" className="text-xs font-medium text-blue-600 hover:underline">Abrir agenda</Link>}
        >
          <MiniCalendario
            mes={mesMini}
            selecionado={hoje}
            eventosPorDia={eventosDoMini}
            onMudarMes={setMesMini}
            onSelecionar={() => navigate('/agenda')}
          />
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.05fr_.95fr] gap-5 lg:gap-6">
        <Card
          title="Próximas visitas"
          action={<Link to="/agendamentos" className="text-xs font-medium text-blue-600 hover:underline">Ver todas</Link>}
        >
          {proximasVisitas.length === 0 && <Empty>Nenhuma visita agendada.</Empty>}
          <ul className="divide-y divide-slate-100">
            {proximasVisitas.slice(0, 8).map((a) => (
              <li key={a.id} className="py-3 flex items-center justify-between gap-3">
                <div>
                  <Link to={`/clientes/${a.clienteId}`} className="text-sm font-medium text-slate-900 hover:text-blue-600">
                    {nomeCliente(a.clienteId)}
                  </Link>
                  <p className="text-xs text-slate-500 mt-0.5">{TIPOS_AGENDAMENTO[a.tipo] ?? a.tipo}</p>
                </div>
                <Badge color="sky">{formatData(a.data)}</Badge>
              </li>
            ))}
          </ul>
        </Card>

        <div className="space-y-6">
          <Card
            title="CRM"
            action={<Link to="/crm" className="text-xs font-medium text-blue-600 hover:underline">Abrir CRM</Link>}
          >
            {funilAbertas === 0 ? (
              <Empty>Nenhuma negociação aberta.</Empty>
            ) : (
              <>
                <p className="text-sm text-slate-600">
                  <span className="font-semibold text-slate-900 tnum">{funilAbertas}</span>{' '}
                  {funilAbertas === 1 ? 'negociação aberta' : 'negociações abertas'} ·{' '}
                  <span className="font-semibold text-slate-900 tnum">{formatBRL(funilEmJogo)}</span> em jogo
                </p>

                {funilParadas.length > 0 && (
                  <>
                    <p className="mt-3 flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                      <IconAlert size={16} className="shrink-0" />
                      {funilParadas.length === 1
                        ? '1 negociação parada há mais de 7 dias.'
                        : `${funilParadas.length} negociações paradas há mais de 7 dias.`}
                    </p>
                    <ul className="divide-y divide-slate-100 mt-1">
                      {funilParadas.slice(0, 5).map((o) => (
                        <li key={o.id} className="py-3 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <Link to={`/clientes/${o.clienteId}`} className="text-sm font-medium text-slate-900 hover:text-blue-600">
                              {nomeCliente(o.clienteId)}
                            </Link>
                            <p className="text-xs text-slate-500 mt-0.5 truncate">{o.titulo}</p>
                          </div>
                          <Badge color="slate">{ETAPAS_FUNIL[o.etapa] ?? o.etapa}</Badge>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </Card>

          <Card title="Trocas de refil previstas">
            {trocasPrevistas.length === 0 && <Empty>Nenhuma troca prevista até o fim do mês.</Empty>}
            <ul className="divide-y divide-slate-100">
              {trocasPrevistas.slice(0, 6).map(({ eq, prevista }) => (
                <li key={eq.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    {prevista < hoje && <IconAlert size={16} className="text-red-500 shrink-0" />}
                    <div>
                      <Link to={`/clientes/${eq.clienteId}`} className="text-sm font-medium text-slate-900 hover:text-blue-600">
                        {nomeCliente(eq.clienteId)}
                      </Link>
                      <p className="text-xs text-slate-500 mt-0.5">{produtos.get(eq.produtoId)?.nome ?? 'Equipamento'}</p>
                    </div>
                  </div>
                  <Badge color={prevista < hoje ? 'red' : 'amber'}>
                    {prevista < hoje ? 'Atrasada — ' : ''}{formatData(prevista)}
                  </Badge>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="A receber por forma de pagamento">
            {aReceberPorForma.length === 0 && <Empty>Nada pendente de recebimento.</Empty>}
            <ul className="space-y-3">
              {aReceberPorForma.map(({ forma, total }) => (
                <li key={forma}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-slate-600">{FORMAS_PAGAMENTO[forma]}</span>
                    <span className="font-semibold text-slate-900 tnum">{formatBRL(total)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-100" role="presentation">
                    <div
                      className="h-1.5 rounded-full bg-amber-400"
                      style={{ width: `${Math.round((total / maiorForma) * 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      {form && (
        <AtividadeModal
          key={form.id || 'nova'}
          atividade={form}
          onFechar={() => setForm(null)}
          onSalvo={recarregar}
        />
      )}

      {concluindo && (
        <AtividadeModal
          key={`concluir-${concluindo.id}`}
          atividade={concluindo}
          modo="conclusao"
          onFechar={() => setConcluindo(null)}
          onSalvo={recarregar}
        />
      )}

      {agDetalhe && (
        <AgendamentoDetalheModal
          agendamento={agDetalhe}
          onClose={() => setAgDetalhe(null)}
          onCriarTarefa={(ag) => {
            setAgDetalhe(null)
            setForm(atividadeNova({ data: hoje, tipo: 'tarefa', clienteId: ag.clienteId, agendamentoId: ag.id }))
          }}
        />
      )}
    </div>
  )
}
