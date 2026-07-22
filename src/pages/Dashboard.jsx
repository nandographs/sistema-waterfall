import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  agendamentos, clientes, equipamentos, vendas, produtos,
  proximaTroca, formatBRL, formatData, FORMAS_PAGAMENTO, TIPOS_AGENDAMENTO,
} from '../data/repository.js'
import { Card, Badge, Empty, Button } from '../components/ui.jsx'
import { IconWallet, IconClock, IconCalendar, IconPlus, IconAlert } from '../components/icons.jsx'
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

function Kpi({ icon, iconBg, label, value, hint }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center gap-3">
        <span className={`flex items-center justify-center w-10 h-10 rounded-lg ${iconBg}`}>{icon}</span>
        <p className="text-[13px] font-medium text-slate-500">{label}</p>
      </div>
      <p className="text-2xl xl:text-[28px] font-bold text-slate-900 tracking-tight tnum mt-3">{value}</p>
      <p className="text-xs text-slate-400 mt-0.5">{hint}</p>
    </div>
  )
}

export default function Dashboard() {
  // Sorteada uma vez por montagem (a cada login/abertura do dashboard).
  const [saudacao] = useState(saudacaoAleatoria)

  const hoje = new Date().toISOString().slice(0, 10)
  const mesAtual = hoje.slice(0, 7)

  const proximasVisitas = agendamentos
    .list()
    .filter((a) => a.status === 'agendado' && a.data >= hoje)
    .sort((a, b) => a.data.localeCompare(b.data))

  const visitasDoMes = agendamentos.list().filter((a) => a.data?.startsWith(mesAtual) && a.status !== 'cancelado')

  const trocasPrevistas = equipamentos
    .list()
    .map((eq) => ({ eq, prevista: proximaTroca(eq) }))
    .filter(({ prevista }) => prevista && prevista <= mesAtual + '-31')
    .sort((a, b) => a.prevista.localeCompare(b.prevista))

  // ---- Financeiro ----
  const todasVendas = vendas.list()
  const vendasDoMes = todasVendas.filter((v) => v.data?.startsWith(mesAtual))
  const totalVendidoMes = vendasDoMes.reduce((s, v) => s + Number(v.valor || 0), 0)
  const pendentes = todasVendas.filter((v) => v.status === 'pendente')
  const totalAReceber = pendentes.reduce((s, v) => s + Number(v.valor || 0), 0)
  const aReceberPorForma = Object.keys(FORMAS_PAGAMENTO).map((forma) => ({
    forma,
    total: pendentes.filter((v) => v.formaPagamento === forma).reduce((s, v) => s + Number(v.valor || 0), 0),
  })).filter((f) => f.total > 0)
  const maiorForma = Math.max(1, ...aReceberPorForma.map((f) => f.total))

  const nomeCliente = (id) => clientes.get(id)?.nome ?? '(cliente removido)'

  // ---- Hero ----
  const proximaVisita = proximasVisitas[0]
  const dataExtenso = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  const partesResumo = []
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
    <div className="px-6 pb-10 lg:px-10 max-w-[1600px] mx-auto w-full">
      {/* Boas-vindas */}
      <div className="flex flex-wrap items-start justify-between gap-6 mb-8 lg:mb-12 lg:pt-4">
        <div className="max-w-lg">
          <p className="text-[13px] font-medium text-blue-300 first-letter:uppercase">{dataExtenso}</p>
          <h2 className="text-3xl lg:text-[34px] font-bold text-white tracking-tight mt-2">
            {saudacao}
          </h2>
          <p className="text-sm text-slate-200 mt-2.5 leading-relaxed">{resumoDoMes}</p>
          <div className="flex flex-wrap gap-2 mt-6">
            <Link to="/agendamentos">
              <Button><IconPlus size={16} /> Novo agendamento</Button>
            </Link>
            <Link to="/clientes">
              <Button variant="hero"><IconPlus size={16} /> Novo cliente</Button>
            </Link>
          </div>
        </div>

        {/* Destaque da próxima visita */}
        {proximaVisita && (
          <div className="hidden lg:block w-72 rounded-xl bg-white border border-slate-200 p-4">
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Próxima visita</p>
            <p className="text-lg font-bold text-slate-900 mt-1.5 truncate">
              {nomeCliente(proximaVisita.clienteId)}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              {TIPOS_AGENDAMENTO[proximaVisita.tipo] ?? proximaVisita.tipo}
            </p>
            <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-slate-200">
              <IconCalendar size={15} className="text-blue-600" />
              <span className="text-sm font-semibold text-slate-900 tnum">
                {formatData(proximaVisita.data)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Indicadores */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
        <Kpi
          icon={<IconWallet size={20} className="text-emerald-600" />}
          iconBg="bg-emerald-50"
          label="Vendido no mês"
          value={formatBRL(totalVendidoMes)}
          hint={`${vendasDoMes.length} venda(s)`}
        />
        <Kpi
          icon={<IconClock size={20} className="text-amber-600" />}
          iconBg="bg-amber-50"
          label="A receber"
          value={formatBRL(totalAReceber)}
          hint={`${pendentes.length} pagamento(s) pendente(s)`}
        />
        <Kpi
          icon={<IconCalendar size={20} className="text-blue-600" />}
          iconBg="bg-blue-50"
          label="Visitas no mês"
          value={visitasDoMes.length}
          hint={`${trocasPrevistas.length} troca(s) de refil prevista(s)`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
    </div>
  )
}
