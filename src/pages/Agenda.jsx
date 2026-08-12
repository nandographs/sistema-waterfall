import { useMemo, useState } from 'react'
import {
  eventosPorDia, eventosDoDia, pendenciasAtrasadas, resumoDoDia,
  concluirAtividade, remarcarAtividade, cancelarAtividade,
  mudarStatusAgendamento, remarcarAgendamento,
  formatBRL, TIPOS_ATIVIDADE, RESULTADOS_ATIVIDADE, FONTES_AGENDA, FONTES_PADRAO,
} from '../data/repository.js'
import {
  hojeISO, mesAtual, mesDe, mudarMes, gradeDoMes, semanaDe, rotuloMes, diaDaSemana,
  diaExtenso, diaCurto, formatHora, somarDias, ehHoje, ehPassado, DIAS_CURTOS,
} from '../lib/datas.js'
import { usuarioAtual } from '../lib/auth.js'
import { Card, Page, PageTitle, Button, Empty, Modal, Badge, inputCls } from '../components/ui.jsx'
import { IconChevronLeft, IconChevronRight, IconPlus, IconCheck, IconAlert } from '../components/icons.jsx'
import { LinhaEvento, IconeDoEvento, estiloDoEvento } from '../components/evento.jsx'
import AtividadeModal, { atividadeNova } from '../components/AtividadeModal.jsx'
import AgendamentoDetalheModal from '../components/AgendamentoDetalheModal.jsx'

// Chip de um evento dentro da célula do calendário.
function ChipEvento({ evento }) {
  const estilo = estiloDoEvento(evento)
  const hora = formatHora(evento.hora)
  return (
    <div className="flex items-center gap-1 min-w-0">
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${estilo.ponto}`} />
      <span className={`text-[11px] truncate ${estilo.texto}`}>
        {hora && <span className="tnum text-slate-400 mr-1">{hora}</span>}
        {evento.titulo}
      </span>
    </div>
  )
}

function GradeDoMes({ mes, selecionado, porDia, onSelecionar }) {
  const dias = gradeDoMes(mes)

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
        {DIAS_CURTOS.map((dia) => (
          <span key={dia} className="text-center text-[11px] font-semibold text-slate-500 py-2">
            {dia}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {dias.map((dia, i) => {
          const doMes = mesDe(dia) === mes
          const eventos = porDia.get(dia) ?? []
          const ativo = dia === selecionado
          const hoje = ehHoje(dia)

          return (
            <button
              key={dia}
              type="button"
              onClick={() => onSelecionar(dia)}
              className={`min-h-[64px] sm:min-h-[92px] text-left p-1 sm:p-1.5 border-slate-100 cursor-pointer ${
                i % 7 !== 6 ? 'border-r' : ''
              } ${i >= 7 ? 'border-t' : ''} ${
                ativo ? 'bg-blue-50 ring-1 ring-inset ring-blue-500' : doMes ? 'bg-white hover:bg-slate-50' : 'bg-slate-50/60'
              }`}
            >
              <span
                className={`inline-flex items-center justify-center min-w-6 h-6 rounded-full text-xs tnum mb-1 ${
                  hoje ? 'bg-blue-600 text-white font-semibold' : doMes ? 'text-slate-700' : 'text-slate-300'
                }`}
              >
                {Number(dia.slice(8, 10))}
              </span>
              {/* No celular a célula tem ~46px de largura: o chip sobra ~24px
                  para o título e vira letra cortada. Pontos dizem "tem coisa
                  aqui" com honestidade; o detalhe está a um toque, no dia. */}
              <div className="flex flex-wrap gap-0.5 sm:hidden">
                {eventos.slice(0, 4).map((evento) => (
                  <span
                    key={evento.id}
                    className={`h-1.5 w-1.5 rounded-full ${estiloDoEvento(evento).ponto}`}
                  />
                ))}
              </div>
              <div className="hidden sm:block space-y-0.5">
                {eventos.slice(0, 3).map((evento) => (
                  <ChipEvento key={evento.id} evento={evento} />
                ))}
                {eventos.length > 3 && (
                  <span className="text-[11px] text-slate-400">+{eventos.length - 3} mais</span>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function GradeDaSemana({ selecionado, porDia, onSelecionar }) {
  const dias = semanaDe(selecionado)

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
      {dias.map((dia) => {
        const eventos = porDia.get(dia) ?? []
        const ativo = dia === selecionado
        return (
          <button
            key={dia}
            type="button"
            onClick={() => onSelecionar(dia)}
            className={`rounded-xl border p-2 text-left min-h-[140px] cursor-pointer ${
              ativo ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50'
            }`}
          >
            <p className="text-[11px] font-semibold text-slate-500">{DIAS_CURTOS[diaDaSemana(dia)]}</p>
            <p className={`text-lg font-bold tnum ${ehHoje(dia) ? 'text-blue-600' : 'text-slate-900'}`}>
              {Number(dia.slice(8, 10))}
            </p>
            <div className="space-y-1 mt-1.5">
              {eventos.slice(0, 5).map((evento) => (
                <ChipEvento key={evento.id} evento={evento} />
              ))}
              {eventos.length > 5 && (
                <span className="text-[11px] text-slate-400">+{eventos.length - 5} mais</span>
              )}
            </div>
          </button>
        )
      })}
    </div>
  )
}

// O relatório do dia. Não é digitado: sai do que já foi registrado ao longo do
// dia, o que só funciona porque registrar é barato (ver CapturaRapida).
function ResumoDoDia({ dia }) {
  const r = resumoDoDia(dia)

  if (r.vazio) {
    return <Empty>Nada registrado neste dia ainda.</Empty>
  }

  const Bloco = ({ rotulo, valor, detalhe }) => (
    <div className="rounded-lg border border-slate-200 px-3 py-2.5">
      <p className="text-[11px] font-medium text-slate-500">{rotulo}</p>
      <p className="text-lg font-bold text-slate-900 tnum">{valor}</p>
      {detalhe && <p className="text-[11px] text-slate-400 mt-0.5">{detalhe}</p>}
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <Bloco
          rotulo="Contatos"
          valor={r.contatos.length}
          detalhe={r.porTipo.map((t) => `${t.quantidade} ${TIPOS_ATIVIDADE[t.tipo].toLowerCase()}`).join(', ')}
        />
        <Bloco rotulo="Serviços concluídos" valor={r.servicos.length} />
        <Bloco
          rotulo="Vendas fechadas"
          valor={formatBRL(r.totalVendido)}
          detalhe={`${r.vendasFechadas.length} venda(s)`}
        />
        <Bloco
          rotulo="Recebido"
          valor={formatBRL(r.totalRecebido)}
          detalhe={r.totalPago > 0 ? `${formatBRL(r.totalPago)} pago` : ''}
        />
      </div>

      {r.porResultado.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Desfechos</p>
          <ul className="space-y-1.5">
            {r.porResultado.map(({ resultado, quantidade }) => (
              <li key={resultado} className="flex items-center justify-between text-sm">
                <span className="text-slate-600">{RESULTADOS_ATIVIDADE[resultado]}</span>
                <span className="font-semibold text-slate-900 tnum">{quantidade}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5">
        <p className="text-[13px] text-slate-600">
          {r.retornosMarcados.length > 0 ? (
            <>
              <span className="font-semibold text-slate-900">{r.retornosMarcados.length}</span> retorno(s)
              marcado(s) a partir do que você fez hoje.
            </>
          ) : (
            'Nenhum retorno ficou marcado a partir de hoje.'
          )}
        </p>
        {r.emAberto > 0 && (
          <p className="text-[13px] text-amber-700 mt-1">
            {r.emAberto} item(ns) ainda em aberto neste dia.
          </p>
        )}
      </div>
    </div>
  )
}

// O ritual do fim do dia: nada fica pendente sem uma decisão.
function FecharDiaModal({ dia, pendentes, onFechar, onMudou }) {
  const [ocupado, setOcupado] = useState('')
  const [remarcarPara, setRemarcarPara] = useState(somarDias(dia, 1))

  async function agir(evento, acao) {
    setOcupado(evento.id)
    try {
      if (evento.fonte === 'atividade') {
        if (acao === 'concluir') await concluirAtividade(evento.registro.id, { resultado: 'sucesso' })
        if (acao === 'remarcar') await remarcarAtividade(evento.registro.id, remarcarPara, evento.registro.hora)
        if (acao === 'cancelar') await cancelarAtividade(evento.registro.id)
      } else {
        if (acao === 'concluir') await mudarStatusAgendamento(evento.registro.id, 'concluido')
        if (acao === 'remarcar') await remarcarAgendamento(evento.registro.id, remarcarPara, evento.registro.hora)
        if (acao === 'cancelar') await mudarStatusAgendamento(evento.registro.id, 'cancelado')
      }
      onMudou()
    } catch (erro) {
      alert('Não foi possível concluir a ação: ' + (erro?.message || erro))
    } finally {
      setOcupado('')
    }
  }

  return (
    <Modal title="Fechar o dia" open onClose={onFechar} size="wide">
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Estes itens ficaram em aberto. Decida um a um — o que não for decidido some do seu
          campo de visão amanhã.
        </p>

        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <span className="text-[13px] font-medium text-slate-700">Remarcar para</span>
          <input
            className={`${inputCls} w-auto`}
            type="date"
            value={remarcarPara}
            onChange={(e) => setRemarcarPara(e.target.value)}
          />
        </div>

        {pendentes.length === 0 ? (
          <Empty>Nada em aberto. Dia fechado.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {pendentes.map((evento) => (
              <li key={evento.id} className="px-3 py-2.5 flex flex-wrap items-center justify-between gap-2">
                {/* flex-1 faltando fazia o bloco de texto exceder a linha e o
                    "· atrasado" — justamente o que muda a decisão — era cortado. */}
                <div className="min-w-0 flex-1 flex items-center gap-2">
                  <IconeDoEvento evento={evento} className={estiloDoEvento(evento).icone} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{evento.titulo}</p>
                    <p className="text-xs text-slate-500">
                      {diaCurto(evento.data)}
                      {evento.detalhe ? ` · ${evento.detalhe}` : ''}
                      {ehPassado(evento.data) && <span className="text-red-600"> · atrasado</span>}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button variant="secondary" disabled={!!ocupado} onClick={() => agir(evento, 'concluir')}>
                    <IconCheck size={15} /> Concluí
                  </Button>
                  <Button variant="secondary" disabled={!!ocupado} onClick={() => agir(evento, 'remarcar')}>
                    Remarcar
                  </Button>
                  <Button variant="danger" disabled={!!ocupado} onClick={() => agir(evento, 'cancelar')}>
                    Cancelar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="flex justify-end">
          <Button variant="secondary" onClick={onFechar}>Fechar</Button>
        </div>
      </div>
    </Modal>
  )
}

export default function Agenda() {
  const [dia, setDia] = useState(hojeISO())
  const [mes, setMes] = useState(mesAtual())
  // No celular a grade do mês dá ~46px por dia — espaço para um ponto e nada
  // mais. Quem abre a agenda no telefone quer o dia de hoje, não o panorama.
  const [visao, setVisao] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < 640 ? 'dia' : 'mes'
  )
  const [fontes, setFontes] = useState(FONTES_PADRAO)
  const [soMinhas, setSoMinhas] = useState(false)
  const [aba, setAba] = useState('agenda')

  const [form, setForm] = useState(null)
  const [concluindo, setConcluindo] = useState(null)
  const [agDetalhe, setAgDetalhe] = useState(null)
  const [fechandoDia, setFechandoDia] = useState(false)
  const [versao, setVersao] = useState(0)

  const recarregar = () => setVersao((n) => n + 1)
  const usuario = usuarioAtual()

  // "Só as minhas" filtra atividades por responsável; serviços em campo não têm
  // dono no modelo atual, então continuam visíveis para todo mundo.
  const filtrar = (lista) =>
    soMinhas ? lista.filter((e) => e.fonte !== 'atividade' || e.responsavel === usuario) : lista

  // O intervalo carregado acompanha a visão: o mês inteiro (com as bordas das
  // semanas vizinhas) ou só a semana selecionada.
  const porDia = useMemo(() => {
    const dias = visao === 'semana' ? semanaDe(dia) : gradeDoMes(mes)
    if (dias.length === 0) return new Map()
    const mapa = eventosPorDia(dias[0], dias[dias.length - 1], fontes)
    if (!soMinhas) return mapa
    const filtrado = new Map()
    for (const [data, eventos] of mapa) filtrado.set(data, filtrar(eventos))
    return filtrado
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mes, dia, visao, fontes, soMinhas, versao])

  const doDia = filtrar(eventosDoDia(dia, fontes))

  // Atrasados só entram no painel quando o dia escolhido é HOJE — visitar uma
  // data passada não deve arrastar junto a bagunça de outras datas.
  const atrasados = ehHoje(dia) ? filtrar(pendenciasAtrasadas(dia, fontes)) : []
  const pendentesDoDia = [...atrasados, ...doDia.filter((e) => e.pendente)]

  function selecionarDia(novoDia) {
    setDia(novoDia)
    if (mesDe(novoDia) !== mes) setMes(mesDe(novoDia))
  }

  function irParaHoje() {
    setDia(hojeISO())
    setMes(mesAtual())
  }

  function abrirEvento(evento) {
    if (evento.fonte === 'atividade') setForm(evento.registro)
    else if (evento.fonte === 'agendamento') setAgDetalhe(evento.registro)
  }

  // Concluir uma tarefa é um clique; concluir um CONTATO abre o registro do
  // desfecho, porque é aí que mora o próximo passo. A fricção fica onde ela
  // produz informação.
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
      alert('Não foi possível concluir: ' + (erro?.message || erro))
    }
  }

  function alternarFonte(fonte) {
    setFontes((atuais) =>
      atuais.includes(fonte) ? atuais.filter((f) => f !== fonte) : [...atuais, fonte],
    )
  }

  const pilula = (ativo) =>
    `rounded-full px-3.5 py-1.5 text-sm font-medium cursor-pointer ${
      ativo ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
    }`

  return (
    <Page>
      <PageTitle
        subtitle="Seu dia: contatos, tarefas e serviços no mesmo lugar"
        action={
          <Button onClick={() => setForm(atividadeNova({ data: dia }))}>
            <IconPlus size={16} /> Nova atividade
          </Button>
        }
      >
        Agenda
      </PageTitle>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => (visao === 'semana' ? selecionarDia(somarDias(dia, -7)) : setMes(mudarMes(mes, -1)))}
            className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50 cursor-pointer"
            aria-label="Anterior"
          >
            <IconChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={() => (visao === 'semana' ? selecionarDia(somarDias(dia, 7)) : setMes(mudarMes(mes, 1)))}
            className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50 cursor-pointer"
            aria-label="Próximo"
          >
            <IconChevronRight size={16} />
          </button>
        </div>

        <span className="text-base font-semibold text-slate-900 flex-1 sm:flex-none sm:min-w-[160px]">
          {rotuloMes(mes)}
        </span>

        <Button variant="secondary" onClick={irParaHoje}>Hoje</Button>

        {/* No mobile as três visões ocupam a linha inteira em partes iguais —
            antes o ml-auto jogava um botão sozinho na segunda linha. */}
        <div className="grid grid-cols-3 gap-1.5 w-full sm:w-auto sm:flex sm:ml-auto">
          {[['mes', 'Mês'], ['semana', 'Semana'], ['dia', 'Dia']].map(([valor, rotulo]) => (
            <button key={valor} type="button" onClick={() => setVisao(valor)} className={pilula(visao === valor)}>
              {rotulo}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {Object.entries(FONTES_AGENDA).map(([fonte, rotulo]) => (
          <button
            key={fonte}
            type="button"
            onClick={() => alternarFonte(fonte)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-medium cursor-pointer ${
              fontes.includes(fonte)
                ? 'border-slate-300 bg-white text-slate-700'
                : 'border-slate-200 bg-slate-50 text-slate-400'
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                !fontes.includes(fonte)
                  ? 'bg-slate-300'
                  : fonte === 'agendamento' ? 'bg-blue-500' : fonte === 'vencimento' ? 'bg-violet-500' : 'bg-emerald-500'
              }`}
            />
            {rotulo}
          </button>
        ))}
        {usuario && (
          <button type="button" onClick={() => setSoMinhas((v) => !v)} className={pilula(soMinhas) + ' sm:ml-auto'}>
            {soMinhas ? 'Só as minhas' : 'Todas'}
          </button>
        )}
      </div>

      <div className={visao === 'dia' ? '' : 'grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-6'}>
        {visao !== 'dia' && (
          <div>
            {visao === 'mes' ? (
              <GradeDoMes mes={mes} selecionado={dia} porDia={porDia} onSelecionar={selecionarDia} />
            ) : (
              <GradeDaSemana selecionado={dia} porDia={porDia} onSelecionar={selecionarDia} />
            )}
          </div>
        )}

        <Card
          className={visao === 'dia' ? 'max-w-3xl' : ''}
          title={
            <span className="first-letter:uppercase">
              {diaExtenso(dia)}
              {ehHoje(dia) && <Badge color="sky">Hoje</Badge>}
            </span>
          }
          action={
            <div className="flex gap-1">
              {[['agenda', 'Agenda'], ['resumo', 'Resumo']].map(([valor, rotulo]) => (
                <button
                  key={valor}
                  type="button"
                  onClick={() => setAba(valor)}
                  className={`rounded-md px-2 py-1 text-xs font-medium cursor-pointer ${
                    aba === valor ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  {rotulo}
                </button>
              ))}
            </div>
          }
        >
          {aba === 'resumo' ? (
            <ResumoDoDia key={versao} dia={dia} />
          ) : (
            <div className="space-y-4">
              {atrasados.length > 0 && (
                <div>
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold text-red-600 uppercase tracking-wide mb-1">
                    <IconAlert size={13} /> Atrasados
                  </p>
                  <ul className="divide-y divide-slate-100">
                    {atrasados.map((evento) => (
                      <LinhaEvento
                        key={evento.id}
                        evento={evento}
                        onAbrir={abrirEvento}
                        onConcluir={concluirEvento}
                      />
                    ))}
                  </ul>
                </div>
              )}

              {doDia.length === 0 ? (
                <Empty>Nada marcado para este dia.</Empty>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {doDia.map((evento) => (
                    <LinhaEvento
                      key={evento.id}
                      evento={evento}
                      onAbrir={abrirEvento}
                      onConcluir={concluirEvento}
                    />
                  ))}
                </ul>
              )}

              <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-100">
                <Button variant="ghost" onClick={() => setForm(atividadeNova({ data: dia }))}>
                  <IconPlus size={15} /> Adicionar neste dia
                </Button>
                {pendentesDoDia.length > 0 && (
                  <Button variant="secondary" onClick={() => setFechandoDia(true)}>
                    Fechar o dia ({pendentesDoDia.length})
                  </Button>
                )}
              </div>
            </div>
          )}
        </Card>
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
            setForm(atividadeNova({
              data: dia,
              tipo: 'tarefa',
              clienteId: ag.clienteId,
              agendamentoId: ag.id,
            }))
          }}
        />
      )}

      {fechandoDia && (
        <FecharDiaModal
          dia={dia}
          pendentes={pendentesDoDia}
          onFechar={() => setFechandoDia(false)}
          onMudou={recarregar}
        />
      )}
    </Page>
  )
}
