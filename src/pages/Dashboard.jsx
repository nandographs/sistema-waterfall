import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  agendamentos, clientes, equipamentos, lancamentos, produtos,
  eventosDoDia, eventosPorDia, pendenciasAtrasadas, assinarDados,
  concluirAtividade, mudarStatusAgendamento,
  proximaTroca, formatBRL, formatData, FORMAS_PAGAMENTO, TIPOS_AGENDAMENTO,
  resumoDoFunil, oportunidadesParadas, ETAPAS_ABERTAS, ETAPAS_FUNIL,
} from '../data/repository.js'
import { hojeISO, mesAtual, mesDe, gradeDoMes, diaExtenso } from '../lib/datas.js'
import { Card, Badge, Empty, Button, Aviso, corpoDoNumero, notificar } from '../components/ui.jsx'
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

// Um KPI é uma "Feature Media Card": Gallery White, 28px, sem sombra e sem
// borda colorida. O número é o objeto exposto na galeria, então quem carrega a
// hierarquia é o TAMANHO do tipo, não um fundo tingido.
//
// Foi daqui que saiu o card azul preenchido: a referência é explícita em não
// usar o Pricing Blue como fundo grande — ele é reservado à pílula compacta de
// ação. O destaque agora é tipográfico, e a cor sobrou para uma coisa só: o
// alerta. Se um número está em vermelho, tem conta vencida.
// `medida` é o valor MAIS LONGO da fileira, e é ele que dita o corpo do tipo de
// todos os quatro cards.
//
// Dimensionar cada card pelo seu próprio número parecia certo e não era: como o
// corpo encolhe conforme o texto cresce, "27" batia no teto e ficava MAIOR que
// "R$ 49.072,63", que é o número mais importante da tela. Medindo todos pelo
// mais comprido, a fileira volta a ler como um sistema só e a hierarquia deixa
// de depender de quantos dígitos o mês por acaso teve.
function Kpi({ icon, label, value, hint, medida, alerta = false }) {
  return (
    <article className="painel-numero ui-card bg-white border border-slate-200 rounded-2xl p-5 lg:p-6 min-h-40 flex flex-col justify-between">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] text-slate-500">{label}</p>
        {/* Glifo monocromático e pequeno, como os ícones da navegação da
            referência — não uma pastilha saturada. */}
        <span className="text-slate-400 shrink-0">{icon}</span>
      </div>
      <div>
        <p
          style={corpoDoNumero(medida ?? value)}
          className={`texto-heroi tnum mt-5 whitespace-nowrap ${alerta ? 'text-red-600' : 'text-slate-900'}`}
        >
          {value}
        </p>
        <p className={`text-xs mt-1.5 ${alerta ? 'text-red-600' : 'text-slate-500'}`}>{hint}</p>
      </div>
    </article>
  )
}

export default function Dashboard() {
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

  // Concluir um serviço em outra tela tem que apagar o alerta daqui também.
  useEffect(() => assinarDados(recarregar), [])

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

  // O valor mais comprido da fileira de KPIs. É ele que dita o corpo do tipo
  // dos quatro cards, para eles lerem como um sistema só — ver Kpi().
  const medidaDosKpis = [
    formatBRL(totalVendidoMes),
    formatBRL(totalAReceber),
    formatBRL(totalAPagar),
    String(visitasDoMes.length),
  ].reduce((maior, v) => (v.length > maior.length ? v : maior), '')

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
      {/* O "Hero Product Stage" da referência: palco branco, sem caixa, sem véu
          e sem imagem por baixo do texto. Antes isto era um wallpaper com véu
          #0b0d11/80 e título branco — o oposto exato da galeria, onde o espaço
          em volta é que dá peso ao que está exposto.

          A data é o kicker, a saudação é a declaração em tipo de display, e o
          resumo vem no corpo de 17px da referência. */}
      <header className="mb-8 lg:mb-10 pt-2 lg:pt-6 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
        <div className="max-w-2xl">
          <p className="text-[13px] font-medium text-slate-500 first-letter:uppercase">{dataExtenso}</p>
          <h2 className="texto-heroi text-[2rem] lg:text-[3.25rem] text-slate-900 mt-2">
            {saudacao}
          </h2>
          <p className="text-[15px] lg:text-[17px] text-slate-500 mt-3 leading-relaxed tracking-[-0.022em] max-w-xl">
            {resumoDoMes}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <Link to="/agendamentos">
            <Button><IconPlus size={16} /> Novo agendamento</Button>
          </Link>
          <Link to="/clientes">
            <Button variant="secondary"><IconPlus size={16} /> Novo cliente</Button>
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(390px,0.88fr)] gap-5 lg:gap-6 mb-6">
        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          <Kpi
            medida={medidaDosKpis}
            icon={<IconWallet size={18} />}
            label="Vendido no mês"
            value={formatBRL(totalVendidoMes)}
            hint={`${entradasDoMes.length} lançamento${entradasDoMes.length === 1 ? '' : 's'}`}
          />
          <Kpi
            medida={medidaDosKpis}
            icon={<IconClock size={18} />}
            label="A receber"
            value={formatBRL(totalAReceber)}
            hint={`${pendentes.length} pagamento${pendentes.length === 1 ? '' : 's'} pendente${pendentes.length === 1 ? '' : 's'}`}
          />
          <Kpi
            medida={medidaDosKpis}
            alerta={vencidasAPagar.length > 0}
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
            medida={medidaDosKpis}
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
              <p className="text-[13px] text-slate-500">Prioridades</p>
              <h3 className="text-[22px] font-semibold text-slate-900 mt-1">Hoje</h3>
            </div>
            <Link to="/agenda" className="text-[13px] text-blue-600 hover:underline shrink-0">
              Abrir agenda
            </Link>
          </div>

          {atrasados.length > 0 && (
            <div className="mb-2 rounded-xl border border-slate-200 bg-slate-100 px-3">
              {/* A urgência é uma pastilha sólida, não um véu vermelho atrás da
                  lista: o bloco inteiro tingido fazia o alerta competir com o
                  próprio conteúdo que ele deveria estar destacando. */}
              <div className="pt-3">
                <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-red-600">
                  <IconAlert size={12} /> {atrasados.length} atrasada{atrasados.length === 1 ? '' : 's'}
                </span>
              </div>
              <ul className="divide-y divide-slate-200">
                {atrasados.slice(0, 2).map((evento) => (
                  <LinhaEvento key={evento.id} evento={evento} onAbrir={abrirEvento} onConcluir={concluirEvento} />
                ))}
              </ul>
            </div>
          )}

          {eventosHoje.length === 0 ? (
            <p className="text-[15px] text-slate-500 py-8 text-center">Nada marcado para hoje.</p>
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
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-blue-600 hover:bg-slate-100 cursor-pointer"
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
            action={<Link to="/crm" className="text-[13px] text-blue-600 hover:underline">Abrir CRM</Link>}
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
                    <Aviso tipo="alerta" className="mt-3">
                      {funilParadas.length === 1
                        ? '1 negociação parada há mais de 7 dias.'
                        : `${funilParadas.length} negociações paradas há mais de 7 dias.`}
                    </Aviso>
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
                      className="h-1.5 rounded-full bg-slate-400"
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
