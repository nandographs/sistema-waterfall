import { useEffect, useMemo, useRef, useState } from 'react'
import {
  eventosPorDia, eventosDoDia, pendenciasAtrasadas, resumoDoDia,
  concluirAtividade, remarcarAtividade, cancelarAtividade,
  mudarStatusAgendamento, remarcarAgendamento,
  agendamentos, assinarDados, recarregarTabelas,
  formatBRL, TIPOS_ATIVIDADE, RESULTADOS_ATIVIDADE, FONTES_AGENDA, FONTES_PADRAO,
} from '../data/repository.js'
import {
  hojeISO, mesAtual, mesDe, mudarMes, gradeDoMes, semanaDe, rotuloMes,
  diaExtenso, diaCurto, somarDias, ehHoje, ehPassado, rotuloRelativo,
} from '../lib/datas.js'
import { usuarioAtual } from '../lib/auth.js'
import { Card, Page, PageTitle, Button, Empty, Modal, inputCls, notificar } from '../components/ui.jsx'
import {
  IconChevronLeft, IconChevronRight, IconChevronDown, IconPlus, IconCheck, IconAlert, IconFilter,
} from '../components/icons.jsx'
import { LinhaEvento, IconeDoEvento, estiloDoEvento, etiquetaDoEvento } from '../components/evento.jsx'
import { GradeDoMes, FaixaDaSemana, LinhaDoTempo } from '../components/calendario.jsx'
import AtividadeModal, { atividadeNova } from '../components/AtividadeModal.jsx'
import AgendamentoDetalheModal from '../components/AgendamentoDetalheModal.jsx'

// Quantos atrasados a lista mostra antes de oferecer o resto.
const LIMITE_ATRASADOS = 5

const pilula = (ativo) =>
  `rounded-full px-3.5 py-1.5 text-sm font-medium cursor-pointer ${
    ativo ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
  }`

// Botão redondo de ícone da barra do topo — o formato da referência, onde a
// navegação é um conjunto de alvos iguais e discretos ao lado da data.
function BotaoIcone({ rotulo, onClick, children, destaque = false, marcado = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={rotulo}
      title={rotulo}
      className={`relative grid h-10 w-10 shrink-0 place-items-center rounded-full cursor-pointer transition-colors ${
        destaque
          ? 'bg-blue-500 text-[var(--btn-primary-fg)] hover:bg-blue-600'
          : 'border border-slate-200 bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-700'
      }`}
    >
      {children}
      {marcado && <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-blue-500" />}
    </button>
  )
}

// Só o nome do dia da semana, sem a data e sem o "-feira": ao lado da data em
// números, "quarta" diz tudo o que "quarta-feira" diria e cabe no celular.
const nomeDoDia = (dia) => diaExtenso(dia).split(',')[0].replace('-feira', '')

// O relatório do dia. Não é digitado: sai do que já foi registrado ao longo do
// dia, o que só funciona porque registrar é barato (ver CapturaRapida).
function ResumoDoDia({ dia }) {
  const r = resumoDoDia(dia)

  if (r.vazio) {
    return <Empty>Nada registrado neste dia ainda.</Empty>
  }

  const Bloco = ({ rotulo, valor, detalhe }) => (
    <div className="rounded-xl border border-slate-200 px-3 py-2.5">
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

      <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5">
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
      notificar('Não foi possível concluir a ação: ' + (erro?.message || erro), 'erro')
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

        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
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
          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200">
            {pendentes.map((evento) => (
              <li key={evento.id} className="px-3 py-2.5 flex flex-wrap items-center justify-between gap-2">
                {/* flex-1 faltando fazia o bloco de texto exceder a linha e o
                    "· atrasado" — justamente o que muda a decisão — era cortado. */}
                <div className="min-w-0 flex-1 flex items-center gap-2.5">
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${estiloDoEvento(evento).bolha}`}>
                    <IconeDoEvento evento={evento} size={15} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{evento.titulo}</p>
                    <p className="text-xs text-slate-500">
                      {etiquetaDoEvento(evento)} · {diaCurto(evento.data)}
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

// Folha inferior para escolher data no mobile: o mês inteiro num toque, sem
// ocupar a tela principal quando ninguém está navegando.
function SeletorDataModal({ mes, dia, porDia, onMudarMes, onSelecionarDia, onHoje, onFechar }) {
  return (
    <Modal title="Escolher data" open onClose={onFechar}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <BotaoIcone rotulo="Mês anterior" onClick={() => onMudarMes(-1)}>
            <IconChevronLeft size={16} />
          </BotaoIcone>
          <span className="flex-1 text-center text-sm font-semibold text-slate-900">{rotuloMes(mes)}</span>
          <BotaoIcone rotulo="Próximo mês" onClick={() => onMudarMes(1)}>
            <IconChevronRight size={16} />
          </BotaoIcone>
        </div>

        <GradeDoMes
          mes={mes}
          selecionado={dia}
          porDia={porDia}
          onSelecionar={(d) => { onSelecionarDia(d); onFechar() }}
        />

        <Button variant="secondary" className="w-full" onClick={() => { onHoje(); onFechar() }}>
          Ir para hoje
        </Button>
      </div>
    </Modal>
  )
}

// Folha inferior para os filtros: fontes e "só as minhas" saem da tela
// principal (onde ficavam sempre visíveis, competindo com o dia) e viram algo
// que se abre só quando alguém quer de fato filtrar.
function FiltrosModal({ fontes, soMinhas, usuario, onAlternarFonte, onAlternarSoMinhas, onFechar }) {
  return (
    <Modal title="Filtros" open onClose={onFechar}>
      <div className="space-y-4">
        <div>
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Mostrar</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(FONTES_AGENDA).map(([fonte, rotulo]) => (
              <button
                key={fonte}
                type="button"
                onClick={() => onAlternarFonte(fonte)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium cursor-pointer ${
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
          </div>
        </div>

        {usuario && (
          <button type="button" onClick={onAlternarSoMinhas} className={pilula(soMinhas) + ' w-full'}>
            {soMinhas ? 'Mostrando só as minhas' : 'Mostrando de todos'}
          </button>
        )}

        <Button className="w-full" onClick={onFechar}>Aplicar</Button>
      </div>
    </Modal>
  )
}

export default function Agenda() {
  const [dia, setDia] = useState(hojeISO())
  const [mes, setMes] = useState(mesAtual())
  // Duas visões, como na referência: o MÊS (panorama + lista do dia escolhido) e
  // o DIA (faixa da semana + linha do tempo por hora). No celular a grade do mês
  // dá ~46px por dia; quem abre a agenda no telefone quer o dia de hoje.
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
  const [todosAtrasados, setTodosAtrasados] = useState(false)
  const [seletorAberto, setSeletorAberto] = useState(false)
  const [filtrosAbertos, setFiltrosAbertos] = useState(false)
  const toqueRef = useRef(null)

  const recarregar = () => setVersao((n) => n + 1)
  const usuario = usuarioAtual()

  // A agenda não é dona de nada: ela mostra atividades e serviços que outras
  // telas (e o próprio sistema, ao agendar um refil) mudam o tempo todo. Sem
  // ouvir essas mudanças, um serviço concluído em Serviços continuava aqui como
  // atrasado até dar F5.
  useEffect(() => assinarDados(recarregar), [])

  // E o cache só é carregado no login: o que mudou em outro aparelho ou em
  // outra aba não chegaria nunca. Buscamos de novo ao abrir a agenda e toda vez
  // que a janela volta ao foco — o momento em que a pessoa olha para a tela.
  useEffect(() => {
    // Alternar de aba dispara `visibilitychange` o tempo todo; a janela de 30s
    // segura a mão para não virar uma consulta por clique.
    let ultima = 0
    const sincronizar = () => {
      if (document.visibilityState === 'hidden') return
      if (Date.now() - ultima < 30_000) return
      ultima = Date.now()
      recarregarTabelas(['agendamentos', 'atividades', 'lancamentos']).catch(() => {})
    }
    sincronizar()
    window.addEventListener('focus', sincronizar)
    document.addEventListener('visibilitychange', sincronizar)
    return () => {
      window.removeEventListener('focus', sincronizar)
      document.removeEventListener('visibilitychange', sincronizar)
    }
  }, [])

  // "Só as minhas" filtra atividades por responsável; serviços em campo não têm
  // dono no modelo atual, então continuam visíveis para todo mundo.
  const filtrar = (lista) =>
    soMinhas ? lista.filter((e) => e.fonte !== 'atividade' || e.responsavel === usuario) : lista

  // O intervalo carregado acompanha a visão: o mês inteiro (com as bordas das
  // semanas vizinhas) ou a semana da faixa do dia.
  const porDia = useMemo(() => {
    const dias = visao === 'dia' ? semanaDe(dia) : gradeDoMes(mes)
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

  // Um único ponto para "anterior/próximo" que respeita a visão ativa: no dia
  // anda um dia, no mês anda um mês. Antes as setas sempre mudavam o MÊS, e no
  // celular o rótulo mudava sem o dia visível mudar junto.
  function navegar(direcao) {
    if (visao === 'dia') return selecionarDia(somarDias(dia, direcao))
    setMes(mudarMes(mes, direcao))
  }

  function aoTocarInicio(e) {
    const t = e.touches[0]
    toqueRef.current = { x: t.clientX, y: t.clientY }
  }

  // Arrastar o card do dia para o lado navega, como num app de agenda de
  // verdade — os botõezinhos de seta ficam pequenos demais para depender só
  // deles no polegar. Um gesto majoritariamente vertical (rolar a lista) não
  // dispara nada.
  function aoTocarFim(e) {
    const inicio = toqueRef.current
    toqueRef.current = null
    if (!inicio) return
    const t = e.changedTouches[0]
    const dx = t.clientX - inicio.x
    const dy = t.clientY - inicio.y
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      selecionarDia(somarDias(dia, dx > 0 ? -1 : 1))
    }
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
      notificar('Não foi possível concluir: ' + (erro?.message || erro), 'erro')
    }
  }

  function alternarFonte(fonte) {
    setFontes((atuais) =>
      atuais.includes(fonte) ? atuais.filter((f) => f !== fonte) : [...atuais, fonte],
    )
  }

  const filtroAtivo = fontes.length < Object.keys(FONTES_AGENDA).length || soMinhas
  const contexto = visao === 'mes' ? rotuloMes(mes) : (rotuloRelativo(dia) || `Semana de ${diaCurto(semanaDe(dia)[0])}`)

  const painelDoDia = (
    <Card
      onTouchStart={aoTocarInicio}
      onTouchEnd={aoTocarFim}
      className={visao === 'dia' ? 'max-w-4xl' : ''}
      title={
        <span className="first-letter:uppercase">
          {ehHoje(dia) ? 'Hoje' : diaExtenso(dia)}
          {doDia.length > 0 && (
            <span className="ml-2 text-xs font-medium text-slate-400 tnum">
              {doDia.length} {doDia.length === 1 ? 'item' : 'itens'}
            </span>
          )}
        </span>
      }
      action={
        <div className="flex gap-1">
          {[['agenda', 'Agenda'], ['resumo', 'Resumo']].map(([valor, rotulo]) => (
            <button
              key={valor}
              type="button"
              onClick={() => setAba(valor)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium cursor-pointer ${
                aba === valor ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:bg-slate-100'
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
        <div className="space-y-5">
          {/* A faixa da semana é a navegação do celular: sete dias na largura do
              polegar, com os pontos dizendo onde há coisa marcada. */}
          {visao === 'dia' && (
            <div className="-mt-1 border-b border-slate-200 pb-3">
              <FaixaDaSemana selecionado={dia} porDia={porDia} onSelecionar={selecionarDia} />
            </div>
          )}

          {/* Atrasado é aviso, não lista de trabalho: quem tem trinta pendências
              velhas não precisa rolar trinta linhas para chegar ao dia de hoje.
              Mostramos as mais antigas e o resto fica a um toque. */}
          {atrasados.length > 0 && (
            <div>
              <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-red-600">
                <IconAlert size={13} /> Atrasados ({atrasados.length})
              </p>
              <ul className="divide-y divide-slate-200/70">
                {(todosAtrasados ? atrasados : atrasados.slice(0, LIMITE_ATRASADOS)).map((evento) => (
                  <LinhaEvento
                    key={evento.id}
                    evento={evento}
                    onAbrir={abrirEvento}
                    onConcluir={concluirEvento}
                  />
                ))}
              </ul>
              {atrasados.length > LIMITE_ATRASADOS && (
                <button
                  type="button"
                  onClick={() => setTodosAtrasados((v) => !v)}
                  className="mt-1 text-[13px] font-semibold text-blue-700 hover:underline cursor-pointer"
                >
                  {todosAtrasados ? 'Mostrar menos' : `Ver os outros ${atrasados.length - LIMITE_ATRASADOS}`}
                </button>
              )}
            </div>
          )}

          {doDia.length === 0 ? (
            <Empty>Nada marcado para este dia.</Empty>
          ) : visao === 'dia' ? (
            <LinhaDoTempo
              eventos={doDia}
              mostrarAgora={ehHoje(dia)}
              onAbrir={abrirEvento}
              onConcluir={concluirEvento}
            />
          ) : (
            <ul className="divide-y divide-slate-200/70">
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

          <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-3">
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
  )

  return (
    <Page>
      <PageTitle subtitle="Seu dia: contatos, tarefas e serviços no mesmo lugar">Agenda</PageTitle>

      {/* A data em tamanho de manchete, com a navegação ao lado — o cabeçalho da
          referência. No celular ela é também o botão que abre o mês inteiro. */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setSeletorAberto(true)}
          className="min-w-0 text-left cursor-pointer"
        >
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 first-letter:uppercase">
            {contexto}
          </p>
          <p className="flex items-center gap-2 text-lg sm:text-xl lg:text-2xl font-semibold tracking-[-0.02em] text-slate-900">
            <span className="tnum">{diaCurto(dia)}</span>
            <span className="truncate font-medium text-slate-500 first-letter:uppercase">{nomeDoDia(dia)}</span>
            <IconChevronDown size={16} className="shrink-0 text-slate-400" />
          </p>
        </button>

        <div className="flex shrink-0 items-center gap-1.5">
          <BotaoIcone rotulo="Anterior" onClick={() => navegar(-1)}>
            <IconChevronLeft size={16} />
          </BotaoIcone>
          <BotaoIcone rotulo="Próximo" onClick={() => navegar(1)}>
            <IconChevronRight size={16} />
          </BotaoIcone>
          <BotaoIcone rotulo="Filtros" onClick={() => setFiltrosAbertos(true)} marcado={filtroAtivo}>
            <IconFilter size={16} />
          </BotaoIcone>
          <BotaoIcone rotulo="Nova atividade" destaque onClick={() => setForm(atividadeNova({ data: dia }))}>
            <IconPlus size={18} />
          </BotaoIcone>
        </div>
      </div>

      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="inline-flex rounded-full border border-slate-200 bg-white p-1">
          {[['mes', 'Mês'], ['dia', 'Dia']].map(([valor, rotulo]) => (
            <button
              key={valor}
              type="button"
              onClick={() => setVisao(valor)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium cursor-pointer transition-colors ${
                visao === valor ? 'bg-slate-900 text-slate-50' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {rotulo}
            </button>
          ))}
        </div>
        {!ehHoje(dia) && (
          <Button variant="secondary" onClick={irParaHoje}>Hoje</Button>
        )}
      </div>

      {visao === 'mes' ? (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(380px,420px)]">
          <Card className="h-fit">
            <GradeDoMes mes={mes} selecionado={dia} porDia={porDia} onSelecionar={selecionarDia} />
          </Card>
          {painelDoDia}
        </div>
      ) : (
        painelDoDia
      )}

      {/* FAB: o alvo de "adicionar" na zona do polegar, acima da barra de
          navegação inferior. */}
      <button
        type="button"
        onClick={() => setForm(atividadeNova({ data: dia }))}
        className="sm:hidden fixed right-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 flex h-14 w-14 items-center justify-center rounded-full bg-blue-500 text-[var(--btn-primary-fg)] shadow-lg hover:bg-blue-600 cursor-pointer"
        aria-label="Nova atividade"
      >
        <IconPlus size={22} />
      </button>

      {seletorAberto && (
        <SeletorDataModal
          mes={mes}
          dia={dia}
          porDia={porDia}
          onMudarMes={(n) => setMes(mudarMes(mes, n))}
          onSelecionarDia={selecionarDia}
          onHoje={irParaHoje}
          onFechar={() => setSeletorAberto(false)}
        />
      )}

      {filtrosAbertos && (
        <FiltrosModal
          fontes={fontes}
          soMinhas={soMinhas}
          usuario={usuario}
          onAlternarFonte={alternarFonte}
          onAlternarSoMinhas={() => setSoMinhas((v) => !v)}
          onFechar={() => setFiltrosAbertos(false)}
        />
      )}

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
          // Sempre a versão do cache: se o status mudou enquanto o pop-up
          // estava aberto, o que ele mostra acompanha.
          agendamento={agendamentos.get(agDetalhe.id) ?? agDetalhe}
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
