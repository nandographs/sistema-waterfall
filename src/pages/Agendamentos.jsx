import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  agendamentos, clientes, mudarStatusAgendamento, excluirAgendamento, assinarDados,
  textoAutorDoAgendamento, badgeDoAgendamento, agendamentoEncerrado,
  produtosDoAgendamento,
  formatData, formatBRL, TIPOS_AGENDAMENTO,
} from '../data/repository.js'
import { formatHora } from '../lib/datas.js'
import {
  Card, Page, PageTitle, Button, inputCls, Empty, Modal, Badge, notificar, usePaginacao, Paginacao, Segmentos,
  CampoBusca, SemResultado, useLembrado,
} from '../components/ui.jsx'
import { IconPlus, IconFileText, IconTrash, IconEye, IconFilter, IconMais } from '../components/icons.jsx'
import { indexarBusca, prepararBusca, filtrarPorBusca } from '../lib/texto.js'
import { telefonesDoCliente } from '../lib/telefone.js'
import OrdemServicoModal from '../components/OrdemServicoModal.jsx'
import AgendamentoDetalheModal from '../components/AgendamentoDetalheModal.jsx'
import AgendamentoFormModal from '../components/AgendamentoFormModal.jsx'

// As ações de uma linha somavam 706px numa tela de 375px — a página inteira
// rolava de lado. No desktop continuam em linha; no celular fica só "Ver" e um
// "⋯" que abre o resto empilhado, com alvos de 44px. Concluir e Cancelar, que
// antes ficavam a 4px um do outro, agora estão separados e rotulados.
function AcoesAgendamento({ agendamento: a, ocupado, onVer, onGerarOS, onEditar, onConcluir, onCancelar, onExcluir }) {
  const [aberto, setAberto] = useState(false)
  const secundarias = []

  if (!agendamentoEncerrado(a)) {
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
        {!agendamentoEncerrado(a) && (
          <Button variant="secondary" onClick={onGerarOS}><IconFileText size={16} /> Gerar OS</Button>
        )}
        {a.status === 'agendado' && (
          <>
            <Button variant="ghost" onClick={onEditar}>Editar</Button>
            <Button variant="secondary" onClick={onConcluir} disabled={ocupado}>
              {ocupado ? 'Salvando…' : 'Concluir'}
            </Button>
            <Button variant="danger" onClick={onCancelar} disabled={ocupado}>Cancelar</Button>
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
  // Lembrados na sessão: abrir o cliente pelo nome e voltar mantém a lista.
  const [filtro, setFiltro] = useLembrado('servicos:situacao', 'agendado')
  const [busca, setBusca] = useLembrado('servicos:busca', '')
  const [dataDe, setDataDe] = useLembrado('servicos:de', '')
  const [dataAte, setDataAte] = useLembrado('servicos:ate', '')
  const buscaAdiada = useDeferredValue(busca)
  const [osAgendamento, setOsAgendamento] = useState(null)
  const [agDetalhe, setAgDetalhe] = useState(null)
  const [agExcluir, setAgExcluir] = useState(null)
  const [excluindo, setExcluindo] = useState(false)
  const [mudandoStatus, setMudandoStatus] = useState('')

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

  // A lista também muda fora daqui (concluir pela agenda, refil agendado
  // automaticamente): ouvir o repositório evita a tela mostrar o mundo antigo.
  useEffect(() => assinarDados(refresh), [])

  const qtdFiltros = [dataDe, dataAte].filter(Boolean).length
  const filtrosAtivos = qtdFiltros > 0
  const limparFiltros = () => { setDataDe(''); setDataAte('') }

  // O texto pesquisável de cada serviço. Antes só o nome do cliente, e com
  // acento: "joao" não achava João, e procurar pelo telefone, pela cidade ou
  // por "troca de refil" não achava nada.
  const indices = useMemo(() => {
    const mapa = new Map()
    for (const a of lista) {
      const c = clientes.get(a.clienteId)
      mapa.set(a.id, indexarBusca({
        principal: c?.nome,
        outros: [
          c?.conjugeNome, c?.cidade, c?.bairro,
          TIPOS_AGENDAMENTO[a.tipo] ?? a.tipo,
          ...produtosDoAgendamento(a).map(({ produto }) => produto?.nome),
          a.observacoes,
          // A data como aparece na tela: "29/10" acha o serviço daquele dia.
          formatData(a.data),
        ],
        numeros: c ? [...telefonesDoCliente(c).map((t) => t.numero), c.conjugeTelefone] : [],
      }))
    }
    return mapa
    // clientes.list() troca de array quando um cliente muda: renomear alguém
    // tem que valer na busca sem recarregar a página.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lista, clientes.list()])

  const consulta = useMemo(() => prepararBusca(buscaAdiada), [buscaAdiada])
  // O que está por vir, do mais próximo ao mais distante; o que já passou
  // (concluído, cancelado, todos), do mais recente ao mais antigo — antes a
  // aba Concluídos abria nos serviços de anos atrás.
  const crescente = filtro === 'agendado'
  const filtrados = filtrarPorBusca(
    lista
      .filter((a) => (filtro === 'todos' ? true : a.status === filtro))
      .filter((a) => !dataDe || (a.data || '') >= dataDe)
      .filter((a) => !dataAte || (a.data || '') <= dataAte)
      .sort((a, b) => {
        const ordem = (a.data || '').localeCompare(b.data || '') || (a.hora || '').localeCompare(b.hora || '')
        return crescente ? ordem : -ordem
      }),
    consulta,
    (a) => indices.get(a.id),
  )

  const { visiveis, barra } = usePaginacao(filtrados, {
    lembrarComo: 'servicos',
    reiniciarCom: JSON.stringify([buscaAdiada.trim(), filtro, dataDe, dataAte]),
  })
  const limparTudo = () => { setBusca(''); limparFiltros() }

  const abrirForm = (dados = {}) => setForm(dados)

  // Sem try/catch, uma falha aqui rejeitava a promise em silêncio: o refresh
  // nunca rodava e o botão parecia simplesmente não funcionar. Mesmo padrão do
  // FecharDiaModal da Agenda.
  async function mudarStatus(id, status) {
    setMudandoStatus(id)
    try {
      await mudarStatusAgendamento(id, status)
      refresh()
    } catch (erro) {
      const acao = status === 'concluido' ? 'concluir' : 'cancelar'
      notificar(`Não foi possível ${acao} este agendamento: ${erro?.message || erro}`, 'erro')
    } finally {
      setMudandoStatus('')
    }
  }

  async function confirmarExcluir() {
    setExcluindo(true)
    try {
      await excluirAgendamento(agExcluir.id)
      setAgExcluir(null)
      refresh()
    } catch (erro) {
      notificar('Não foi possível excluir a ordem de serviço: ' + (erro?.message || erro), 'erro')
    } finally {
      setExcluindo(false)
    }
  }

  return (
    <Page>
      <PageTitle
        subtitle="Visitas, instalações e trocas de refil — o serviço em campo"
        action={<Button onClick={() => abrirForm()}><IconPlus size={16} /> Novo agendamento</Button>}
      >
        Serviços
      </PageTitle>

      <Segmentos
        className="mb-4"
        rotulo="Situação do serviço"
        valor={filtro}
        onChange={setFiltro}
        opcoes={[['agendado', 'Agendados'], ['concluido', 'Concluídos'], ['cancelado', 'Cancelados'], ['todos', 'Todos']]}
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <CampoBusca
          className="flex-1 min-w-[220px] max-w-sm"
          placeholder="Buscar por cliente, telefone, cidade ou produto…"
          aria-label="Buscar serviços"
          value={busca}
          onChange={setBusca}
        />

        <div className="relative" ref={painelRef}>
          <Button variant="secondary" onClick={() => setPainelAberto((v) => !v)}>
            <IconFilter size={16} /> Filtrar por
            {qtdFiltros > 0 && (
              <span className="ml-1 text-xs font-medium text-blue-600 tnum">
                {qtdFiltros}
              </span>
            )}
          </Button>

          {painelAberto && (
            <div className="absolute right-0 z-20 mt-2 w-72 max-w-[calc(100vw-3rem)] rounded-2xl superficie-flutuante p-4 space-y-4">
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
          buscaAdiada.trim() || filtrosAtivos
            ? <SemResultado busca={buscaAdiada} filtros={filtrosAtivos} onLimpar={limparTudo}>Nenhum agendamento encontrado</SemResultado>
            : <Empty>Nenhum agendamento aqui.</Empty>
        )}
        <ul className={`divide-y divide-slate-100 transition-opacity ${busca !== buscaAdiada ? 'opacity-60' : ''}`}>
          {visiveis.map((a) => {
            const [cor, rotulo] = badgeDoAgendamento(a)
            const nomesProdutos = produtosDoAgendamento(a)
              .map(({ produto, quantidade }) => (quantidade > 1 ? `${quantidade}x ${produto.nome}` : produto.nome))
              .join(', ')
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
                  {textoAutorDoAgendamento(a) && (
                    <p className="text-xs text-slate-400 mt-0.5">{textoAutorDoAgendamento(a)}</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                  {Number(a.valor) > 0 && (
                    <span className="text-sm font-semibold text-slate-900 tnum inline-flex items-center gap-1.5">
                      {formatBRL(a.valor)}
                      {!agendamentoEncerrado(a) && (
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
                    ocupado={mudandoStatus === a.id}
                    onVer={() => setAgDetalhe(a)}
                    onGerarOS={() => setOsAgendamento(a)}
                    onEditar={() => abrirForm(a)}
                    onConcluir={() => mudarStatus(a.id, 'concluido')}
                    onCancelar={() => mudarStatus(a.id, 'cancelado')}
                    onExcluir={() => setAgExcluir(a)}
                  />
                </div>
              </li>
            )
          })}
        </ul>
        <Paginacao {...barra} />
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
          onEditar={(a) => { setAgDetalhe(null); abrirForm(a) }}
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

      {form && (
        <AgendamentoFormModal
          key={form.id || 'novo-agendamento'}
          agendamento={form}
          onFechar={() => setForm(null)}
          onSalvo={() => { setForm(null); refresh() }}
        />
      )}
    </Page>
  )
}
