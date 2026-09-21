import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  lancamentos, clientes, funcionarios,
  salvarLancamento, salvarLancamentosRepetidos, excluirLancamento, darBaixa, estornarLancamento,
  removerDoFinanceiro, lancamentosDaOrigem,
  salvarFuncionario, excluirFuncionario, lancamentosDoFuncionario,
  folhaDaCompetencia, lancamentoDaFolha, contaSalario, competenciaDe, daFolha,
  CATEGORIA_VALE,
  formatBRL, formatData, hojeISO, somarMeses,
  resumoDoPeriodo, variacao, mesDe,
  FORMAS_PAGAMENTO, CATEGORIAS_SAIDA,
} from '../data/repository.js'
import { painelDoPeriodo, serieDoSaldo, movimentosDoPeriodo, fluxoDosMeses } from '../data/financeiro.js'
import {
  ESCALAS_RELATORIO, intervaloDoRelatorio, andarNoRelatorio,
  rotuloDoRelatorio, periodoEmCurso, somarDias,
} from '../lib/datas.js'
import { gerarRelatorioPdf } from '../relatorio/gerarPdf.js'
import { Page, PageTitle, Button, Field, inputCls, InputNumero, Empty, Modal, Badge, notificar, usePaginacao, Paginacao } from '../components/ui.jsx'
import { GraficoSaldo, GraficoFluxo } from '../components/GraficosFinanceiro.jsx'
import {
  IconPlus, IconWallet, IconAlert, IconCheck,
  IconChevronLeft, IconChevronRight, IconSearch, IconFileText, IconEntrada, IconSaida,
} from '../components/icons.jsx'

// A tela é organizada em torno de UM período (semana, mês ou ano), escolhido no
// topo. Os números, o gráfico, o extrato, o relatório e a folha obedecem a ele
// — antes cada bloco olhava para um período diferente e nada fechava com nada.
// Toda a conta mora em data/financeiro.js (painelDoPeriodo e vizinhas).

const CATEGORIAS_ENTRADA = { venda: 'Venda', servico: 'Serviço', outros: 'Outros', ajuste: 'Ajuste de saldo' }
const nomeCategoria = (c) => CATEGORIAS_SAIDA[c] ?? CATEGORIAS_ENTRADA[c] ?? c

const ESCALAS_CURTAS = { semanal: 'Semana', mensal: 'Mês', anual: 'Ano' }

const ABAS = [
  ['movimentos', 'Movimentos'],
  ['fluxo', 'Fluxo de caixa'],
  ['relatorio', 'Por categoria'],
  ['salarios', 'Salários'],
]

// Variação percentual ao lado de um número. Sem base no período anterior não
// há percentual — mostra "—" em vez de inventar um "+100%".
function Variacao({ atual, anterior, invertido = false }) {
  const v = variacao(atual, anterior)
  if (v === null) return <span className="text-xs text-slate-400">—</span>
  const positivo = invertido ? v < 0 : v > 0
  const cor = v === 0 ? 'text-slate-400' : (positivo ? 'text-emerald-600' : 'text-red-600')
  return (
    <span className={`text-xs font-semibold ${cor}`}>
      {v > 0 ? '▲' : (v < 0 ? '▼' : '')} {Math.abs(v).toFixed(0)}%
    </span>
  )
}

const REPETICAO_VAZIA = { ativo: false, vezes: 12, dividir: false, jaPagas: 0, lancarPagas: false }

// Cadastro de funcionário. `ativo` nasce true: quem se cadastra está na folha.
const FUNCIONARIO_VAZIO = {
  nome: '', cargo: '', telefone: '', salario: '', diaPagamento: 5,
  admissao: '', ativo: true, observacoes: '',
}

// 'AAAA-MM' por extenso ("setembro de 2026").
const rotuloDoMes = (mes) => {
  const [ano, m] = String(mes || '').split('-')
  if (!ano || !m) return '—'
  return new Date(Number(ano), Number(m) - 1, 1)
    .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}

// 'AAAA-MM' curto para o eixo do gráfico ("set", e "jan 27" na virada do ano).
const mesCurto = (mes) => {
  const [ano, m] = String(mes || '').split('-').map(Number)
  const nome = new Date(ano, m - 1, 1).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')
  return m === 1 ? `${nome} ${String(ano).slice(2)}` : nome
}

// O dia (no fuso de quem está usando) de um carimbo de data e hora do banco.
const diaLocal = (ts) => {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return String(ts || '').slice(0, 10)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const diaMes = (iso) => {
  const [, m, d] = String(iso || '').split('-')
  return d && m ? `${d}/${m}` : ''
}

const FORM_VAZIO = {
  tipo: 'saida', status: 'previsto', descricao: '', categoria: 'fornecedor',
  valor: '', vencimento: hojeISO(), dataPagamento: '', formaPagamento: 'pix',
  clienteId: '', observacoes: '', parcela: 1, parcelas: 1, origem: 'manual',
  // Só usados quando a saída é da folha (vale / salário) — ver a conta salário.
  funcionarioId: '', competencia: '',
}

// Um dos três números coloridos ao lado do saldo.
const TONS = {
  verde: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  vermelho: 'bg-red-50 border-red-200 text-red-700',
  azul: 'bg-blue-50 border-blue-200 text-blue-700',
}
function CartaoNumero({ tom, icone, rotulo, valor, detalhe }) {
  return (
    <article className={`rounded-2xl border p-4 flex flex-col justify-between gap-3 sm:min-h-36 min-w-0 ${TONS[tom]}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-semibold opacity-90 leading-tight">{rotulo}</p>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-500/15">{icone}</span>
      </div>
      <div className="min-w-0">
        <p className="text-xl font-extrabold tracking-[-0.03em] tnum text-slate-900 whitespace-nowrap">{valor}</p>
        <p className="text-[11px] font-medium opacity-80 leading-snug mt-1">{detalhe}</p>
      </div>
    </article>
  )
}

// Botão redondo de "pago / em aberto" — a ação do dia a dia, a um clique.
function BotaoBaixa({ l, atrasado, onClick }) {
  const pago = l.status === 'realizado'
  const verbo = l.tipo === 'entrada' ? 'recebido' : 'pago'
  return (
    <button
      type="button"
      onClick={onClick}
      title={pago ? `Desfazer: voltar para em aberto` : `Marcar como ${verbo}`}
      aria-label={pago ? `Desfazer ${verbo}: ${l.descricao}` : `Marcar como ${verbo}: ${l.descricao}`}
      aria-pressed={pago}
      className={`group flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 cursor-pointer transition-colors ${
        pago
          ? 'bg-emerald-500 border-emerald-500 text-[var(--btn-primary-fg)] hover:opacity-80'
          : atrasado
            ? 'border-red-500 text-transparent hover:text-red-500 hover:bg-red-50'
            : 'border-slate-300 text-transparent hover:text-slate-500 hover:bg-slate-100'
      }`}
    >
      <IconCheck size={16} />
    </button>
  )
}

export default function Financeiro() {
  const [, forceRender] = useState(0)
  const refresh = () => forceRender((n) => n + 1)

  const [aba, setAba] = useState('movimentos')
  const [busca, setBusca] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('todos')
  const [filtroSituacao, setFiltroSituacao] = useState('geral')
  const [form, setForm] = useState(null)
  const [excluir, setExcluir] = useState(null)
  // Repetição fica FORA do form porque não é campo do lançamento: é instrução
  // de como criá-lo. Vai para o banco a consequência (N lançamentos), não a regra.
  const [repeticao, setRepeticao] = useState(REPETICAO_VAZIA)
  const [removendo, setRemovendo] = useState(false)

  const [mostrarInativos, setMostrarInativos] = useState(false)
  const [formFuncionario, setFormFuncionario] = useState(null)
  const [excluirFunc, setExcluirFunc] = useState(null)
  // Quando o cadastro é aberto de DENTRO do lançamento ("não tem ninguém aqui,
  // deixa eu cadastrar agora"), o recém-cadastrado já volta escolhido no
  // formulário — senão o usuário cadastraria e cairia de novo na lista vazia.
  const [cadastroVoltaAoLancamento, setCadastroVoltaAoLancamento] = useState(false)

  const hoje = hojeISO()
  const todos = lancamentos.list()

  // ---- O período da tela ----
  //
  // O par (escala, âncora): a escala diz o tamanho da janela — semana, mês, ano
  // — e a âncora é um dia qualquer dentro dela. Navegar é mexer só na âncora.
  // Trocar de escala NÃO mexe na âncora, de propósito: assim ir de Setembro
  // para o Ano e voltar cai de novo em Setembro, e não em Janeiro.
  const [escala, setEscala] = useState('mensal')
  const [ancora, setAncora] = useState(() => hojeISO())

  const periodo = intervaloDoRelatorio(escala, ancora)
  const ancoraAnterior = andarNoRelatorio(escala, ancora, -1)
  const periodoAnterior = intervaloDoRelatorio(escala, ancoraAnterior)
  const noPeriodoAtual = periodoEmCurso(escala, ancora, hoje)
  const rotuloPeriodo = rotuloDoRelatorio(escala, ancora)

  // A folha é sempre de um MÊS: no semanal e no anual vale o mês da âncora.
  const competencia = mesDe(ancora)

  const painel = useMemo(() => painelDoPeriodo(todos, periodo, hoje), [todos, periodo.de, periodo.ate, hoje])
  const serie = useMemo(() => serieDoSaldo(todos, periodo, hoje), [todos, periodo.de, periodo.ate, hoje])
  const fluxo = useMemo(() => fluxoDosMeses(todos, hoje, 6), [todos, hoje])
  const relatorio = useMemo(() => resumoDoPeriodo(todos, periodo), [todos, periodo.de, periodo.ate])
  const relatorioAnterior = useMemo(
    () => resumoDoPeriodo(todos, periodoAnterior),
    [todos, periodoAnterior.de, periodoAnterior.ate],
  )

  // ---- Precisa de atenção: o vencido e o que vence nos próximos 7 dias ----
  const limiteSemana = somarDias(hoje, 7)
  const atencao = todos
    .filter((l) => l.status === 'previsto' && l.vencimento && l.vencimento <= limiteSemana)
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento))
  const atrasadosTodos = atencao.filter((l) => l.vencimento < hoje)

  const [baixandoPdf, setBaixandoPdf] = useState(false)

  async function baixarRelatorio() {
    setBaixandoPdf(true)
    try {
      await gerarRelatorioPdf({
        rotuloEscala: ESCALAS_RELATORIO[escala],
        rotuloPeriodo,
        emCurso: noPeriodoAtual,
        emitidoEm: hoje,
        resumo: relatorio,
        resumoAnterior: relatorioAnterior,
        nomeCategoria,
        nomeCliente: (id) => clientes.get(id)?.nome || '',
      })
    } catch (erro) {
      notificar('Não foi possível gerar o PDF: ' + (erro?.message || erro), 'erro')
    } finally {
      setBaixandoPdf(false)
    }
  }

  async function salvar(e) {
    e.preventDefault()
    // Repetir só faz sentido ao criar: editar uma parcela mexe naquela parcela,
    // não gera outras vinte.
    if (!form.id && repeticao.ativo && Number(repeticao.vezes) > 1) {
      const criados = await salvarLancamentosRepetidos(form, {
        repeticoes: Number(repeticao.vezes),
        dividir: repeticao.dividir,
        jaPagas: Number(repeticao.jaPagas) || 0,
        lancarPagas: repeticao.lancarPagas,
      })
      notificar(`${criados.length} lançamentos criados.`)
    } else {
      await salvarLancamento(form)
      notificar(form.id ? 'Alterações salvas.' : (form.tipo === 'entrada' ? 'Entrada lançada.' : 'Saída lançada.'))
    }
    setForm(null)
    setRepeticao(REPETICAO_VAZIA)
    refresh()
  }

  async function alternarBaixa(l) {
    if (l.status === 'realizado') await estornarLancamento(l.id)
    else await darBaixa(l.id)
    refresh()
  }

  // Um lançamento manual some de vez; um vinculado sai desligando a origem —
  // ver removerDoFinanceiro, que cuida das duas pontas.
  async function confirmarExcluir() {
    setRemovendo(true)
    try {
      if (excluir.origem === 'manual' && lancamentosDaOrigem(excluir).length === 0) {
        await excluirLancamento(excluir.id)
      } else {
        await removerDoFinanceiro(excluir)
      }
      setExcluir(null)
      setForm(null)
    } catch (erro) {
      notificar('Não foi possível remover do financeiro: ' + (erro?.message || erro), 'erro')
    } finally {
      setRemovendo(false)
      refresh()
    }
  }

  // ---- Folha: cadastro e conta salário ----

  const folha = useMemo(
    () => folhaDaCompetencia(competencia, { incluirInativos: mostrarInativos }),
    [todos, competencia, mostrarInativos, funcionarios.list()],
  )

  const [salvandoFuncionario, setSalvandoFuncionario] = useState(false)

  async function salvarCadastroFuncionario(e) {
    e.preventDefault()
    setSalvandoFuncionario(true)
    try {
      const salvo = await salvarFuncionario(formFuncionario)
      // Veio do formulário de lançamento: já deixa ele escolhido lá.
      if (cadastroVoltaAoLancamento && form) setForm(comFuncionario(form, salvo))
      setFormFuncionario(null)
      setCadastroVoltaAoLancamento(false)
      notificar(`${salvo.nome} entrou na folha.`)
    } catch (erro) {
      // Sem isto, um erro do banco (a migração 019 não rodada, por exemplo)
      // não dizia nada: o modal ficava aberto e parecia que o botão não fazia
      // nada. Erro de gravação tem que aparecer.
      notificar('Não foi possível salvar o funcionário: ' + (erro?.message || erro), 'erro')
    } finally {
      setSalvandoFuncionario(false)
      refresh()
    }
  }

  // Abre o cadastro de funcionário. `voltando` marca que veio do lançamento.
  function abrirCadastroFuncionario(funcionario = null, voltando = false) {
    setCadastroVoltaAoLancamento(voltando)
    setFormFuncionario(funcionario
      ? { ...FUNCIONARIO_VAZIO, ...funcionario, salario: String(funcionario.salario ?? '') }
      : { ...FUNCIONARIO_VAZIO })
  }

  // Quem já tem lançamento não some: é desligado (ver excluirFuncionario).
  async function confirmarExcluirFuncionario() {
    setRemovendo(true)
    try {
      const desligado = await excluirFuncionario(excluirFunc.id)
      notificar(desligado
        ? `${excluirFunc.nome} foi desligado. Os lançamentos dele continuam no caixa.`
        : `${excluirFunc.nome} foi excluído.`)
      setExcluirFunc(null)
    } catch (erro) {
      notificar('Não foi possível excluir: ' + (erro?.message || erro), 'erro')
    } finally {
      setRemovendo(false)
      refresh()
    }
  }

  // Abre o formulário de lançamento já como vale (ou como o salário do mês) do
  // funcionário — é o mesmo formulário de qualquer saída, só preenchido.
  function lancarNaFolha(funcionario, tipo, valorSugerido) {
    setRepeticao(REPETICAO_VAZIA)
    setForm({ ...FORM_VAZIO, ...lancamentoDaFolha(funcionario, competencia, { tipo, valor: valorSugerido }) })
  }

  // A conta salário do funcionário escolhido NO FORMULÁRIO, no mês digitado
  // lá — que não é necessariamente o que a aba Salários está vendo.
  const contaDoForm = useMemo(() => {
    if (!form?.funcionarioId) return null
    const f = funcionarios.get(form.funcionarioId)
    if (!f) return null
    const outros = todos.filter((l) => l.id !== form.id)
    return { funcionario: f, ...contaSalario(f, outros, form.competencia || competenciaDe(form)) }
  }, [form?.id, form?.funcionarioId, form?.competencia, form?.vencimento, todos])

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const setFunc = (k) => (e) => setFormFuncionario({ ...formFuncionario, [k]: e.target.value })

  // Escolher o funcionário no formulário preenche o resto do que dá para saber:
  // a descrição (se ainda estiver vazia) e, no pagamento do salário, o valor que
  // falta — que é justamente o número que ninguém quer calcular à mão.
  function comFuncionario(formAtual, f) {
    const mes = formAtual.competencia || competenciaDe(formAtual)
    const conta = f ? contaSalario(f, todos.filter((l) => l.id !== formAtual.id), mes) : null
    const vale = formAtual.categoria === CATEGORIA_VALE
    return {
      ...formAtual,
      funcionarioId: f?.id || '',
      competencia: mes,
      descricao: formAtual.descricao || (f
        ? (vale ? `Vale — ${f.nome}` : `Salário ${mes} — ${f.nome}`)
        : ''),
      valor: formAtual.valor || (!vale && conta && conta.saldo > 0 ? conta.saldo.toFixed(2) : formAtual.valor),
    }
  }

  const escolherFuncionarioNoForm = (e) =>
    setForm(comFuncionario(form, e.target.value ? funcionarios.get(e.target.value) : null))

  // Novo lançamento: o botão já diz se é entrada ou saída.
  function novo(tipo) {
    setRepeticao(REPETICAO_VAZIA)
    setForm({ ...FORM_VAZIO, tipo, categoria: tipo === 'entrada' ? 'outros' : 'fornecedor', vencimento: hojeISO() })
  }

  // Trocar entre entrada e saída no formulário leva junto uma categoria que
  // exista do outro lado — "Aluguel" não é categoria de entrada.
  function trocarTipo(tipo) {
    if (tipo === form.tipo) return
    setForm({
      ...form,
      tipo,
      categoria: tipo === 'entrada' ? 'outros' : 'fornecedor',
      funcionarioId: '',
      competencia: '',
    })
  }

  // Abre o mesmo formulário do novo lançamento, já preenchido. Campos que só
  // existem em lançamentos antigos (ou gerados) são normalizados para o form
  // controlado não trocar de "uncontrolled" para "controlled" no meio do caminho.
  function editar(l) {
    setRepeticao(REPETICAO_VAZIA)
    setForm({
      ...FORM_VAZIO,
      ...l,
      valor: String(l.valor ?? ''),
      descricao: l.descricao || '',
      observacoes: l.observacoes || '',
      vencimento: l.vencimento || hoje,
      dataPagamento: l.dataPagamento || '',
      categoria: l.categoria || (l.tipo === 'entrada' ? 'outros' : 'fornecedor'),
      formaPagamento: l.formaPagamento || 'pix',
      funcionarioId: l.funcionarioId || '',
      competencia: l.competencia || competenciaDe(l),
    })
  }

  // ---- Movimentos do período ----
  const termo = busca.trim().toLowerCase()
  const combina = (l) => {
    if (!termo) return true
    const cliente = l.clienteId ? clientes.get(l.clienteId)?.nome : ''
    const funcionario = l.funcionarioId ? funcionarios.get(l.funcionarioId)?.nome : ''
    return [
      l.descricao,
      funcionario,
      nomeCategoria(l.categoria),
      FORMAS_PAGAMENTO[l.formaPagamento] ?? l.formaPagamento,
      cliente,
      l.observacoes,
      formatBRL(l.valor),
      String(l.valor ?? ''),
    ].some((campo) => (campo || '').toString().toLowerCase().includes(termo))
  }

  // A data que conta para a ordem: o dia em que foi pago, ou o vencimento.
  const dataDe = (l) => (l.status === 'realizado' ? l.dataPagamento : l.vencimento) || ''

  // Três jeitos de ler a lista:
  //   Geral      o que foi LANÇADO no período, na ordem em que foi lançado —
  //              registrou uma entrada, ela aparece no topo; depois uma saída,
  //              a saída fica em cima dela. É o "diário" do caixa.
  //   Em aberto  o que falta pagar/receber, na ordem de vencimento (o atrasado
  //              primeiro).
  //   Pagos      o que de fato se moveu, do pagamento mais recente ao mais antigo.
  const registroDe = (l) => String(l.criadoEm || '')
  const lista = filtroSituacao === 'geral'
    ? todos.filter((l) => {
        // Sem data de registro (acabou de ser gravado e o banco ainda não
        // devolveu), é de agora.
        const dia = l.criadoEm ? diaLocal(l.criadoEm) : hoje
        return dia >= periodo.de && dia <= periodo.ate
      })
    : movimentosDoPeriodo(todos, periodo, hoje)
        .filter((l) => (filtroSituacao === 'pago' ? l.status === 'realizado' : l.status !== 'realizado'))
  const movimentos = lista
    .filter((l) => filtroTipo === 'todos' || l.tipo === filtroTipo)
    .filter(combina)
    .sort((a, b) => {
      if (filtroSituacao === 'geral') {
        if (!a.criadoEm || !b.criadoEm) return (a.criadoEm ? 1 : 0) - (b.criadoEm ? 1 : 0)
        return registroDe(b).localeCompare(registroDe(a))
      }
      if (filtroSituacao === 'aberto') return dataDe(a).localeCompare(dataDe(b))
      return dataDe(b).localeCompare(dataDe(a)) || registroDe(b).localeCompare(registroDe(a))
    })

  const { visiveis: movimentosDaPagina, barra } = usePaginacao(movimentos)

  // No Geral a lista é separada pelo dia em que cada coisa foi lançada.
  const rotuloDoRegistro = (l) => {
    const dia = l.criadoEm ? diaLocal(l.criadoEm) : hoje
    if (dia === hoje) return 'Lançado hoje'
    if (dia === somarDias(hoje, -1)) return 'Lançado ontem'
    return `Lançado em ${formatData(dia)}`
  }

  // O que aparece embaixo da descrição: de quem é e do que é.
  function detalheDe(l) {
    const cliente = l.clienteId ? clientes.get(l.clienteId) : null
    const funcionario = l.funcionarioId ? funcionarios.get(l.funcionarioId) : null
    return (
      <>
        {cliente && (
          <>
            <Link to={`/clientes/${cliente.id}`} className="hover:text-blue-600" onClick={(e) => e.stopPropagation()}>
              {cliente.nome}
            </Link>
            {' · '}
          </>
        )}
        {funcionario ? `${funcionario.nome} · ` : ''}
        {nomeCategoria(l.categoria) || 'Sem categoria'}
      </>
    )
  }

  // Quando foi (ou quando vence), em palavras.
  function quando(l) {
    if (l.status === 'realizado') return `${l.tipo === 'entrada' ? 'Recebido' : 'Pago'} ${diaMes(l.dataPagamento)}`
    if (l.vencimento < hoje) return `Venceu ${diaMes(l.vencimento)}`
    if (l.vencimento === hoje) return 'Vence hoje'
    return `Vence ${diaMes(l.vencimento)}`
  }

  function LinhaMovimento({ l }) {
    const atrasado = l.status === 'previsto' && l.vencimento && l.vencimento < hoje
    const entrada = l.tipo === 'entrada'
    return (
      <li className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] sm:grid-cols-[2.25rem_minmax(0,1fr)_7rem_5.5rem_8.5rem] items-center gap-x-3 py-2.5">
        <BotaoBaixa l={l} atrasado={atrasado} onClick={() => alternarBaixa(l)} />
        <button
          type="button"
          onClick={() => editar(l)}
          className="min-w-0 text-left cursor-pointer rounded-lg -mx-1.5 px-1.5 py-1 hover:bg-slate-100"
          title="Abrir para editar"
        >
          <p className="text-sm font-semibold text-slate-900 truncate">{l.descricao || '(sem descrição)'}</p>
          <p className="text-xs text-slate-500 truncate mt-0.5">{detalheDe(l)}</p>
        </button>
        <p className={`hidden sm:block text-xs font-medium ${atrasado ? 'text-red-600' : 'text-slate-500'}`}>{quando(l)}</p>
        <p className="hidden sm:block text-xs text-slate-500">{FORMAS_PAGAMENTO[l.formaPagamento] ?? l.formaPagamento ?? ''}</p>
        <div className="text-right">
          <p className={`text-sm font-bold tnum ${entrada ? 'text-emerald-700' : 'text-slate-900'} ${l.status === 'realizado' ? '' : 'opacity-70'}`}>
            {entrada ? '+' : '−'} {formatBRL(l.valor)}
          </p>
          <p className={`sm:hidden text-[11px] font-medium ${atrasado ? 'text-red-600' : 'text-slate-500'}`}>{quando(l)}</p>
        </div>
      </li>
    )
  }

  // Um grupo de botões de filtro, do mesmo jeito em todo lugar da tela.
  function Segmentos({ valor, opcoes, onChange, rotulo }) {
    return (
      <div role="group" aria-label={rotulo} className="inline-flex rounded-xl bg-slate-100 p-1">
        {opcoes.map(([v, r]) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            aria-pressed={valor === v}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold cursor-pointer transition-colors min-h-9 sm:min-h-0 ${
              valor === v ? 'ui-card bg-white text-slate-900 shadow-sm ring-1 ring-slate-300' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {r}
          </button>
        ))}
      </div>
    )
  }

  // ---- Os números do topo ----
  const passado = !painel.finalPrevisto
  const fimDoPeriodo = diaMes(periodo.ate)

  return (
    <Page>
      <PageTitle
        subtitle="O que entrou, o que saiu e como o caixa vai ficar"
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => novo('entrada')}>
              <IconEntrada size={16} className="text-emerald-600" /> Entrada
            </Button>
            <Button onClick={() => novo('saida')}>
              <IconSaida size={16} /> Saída
            </Button>
          </div>
        }
      >
        Financeiro
      </PageTitle>

      {/* O período: vale para a tela inteira. */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <Segmentos
            rotulo="Tamanho do período"
            valor={escala}
            onChange={setEscala}
            opcoes={Object.entries(ESCALAS_CURTAS)}
          />
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setAncora(andarNoRelatorio(escala, ancora, -1))}
              className="inline-flex min-h-11 min-w-11 sm:min-h-9 sm:min-w-9 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 cursor-pointer"
              aria-label="Período anterior"
            >
              <IconChevronLeft size={16} />
            </button>
            <span className="text-base font-bold text-slate-900 min-w-[9rem] text-center first-letter:uppercase">
              {rotuloPeriodo}
            </span>
            <button
              type="button"
              onClick={() => setAncora(andarNoRelatorio(escala, ancora, 1))}
              className="inline-flex min-h-11 min-w-11 sm:min-h-9 sm:min-w-9 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 cursor-pointer"
              aria-label="Próximo período"
            >
              <IconChevronRight size={16} />
            </button>
            {!noPeriodoAtual && (
              <Button variant="ghost" onClick={() => setAncora(hoje)}>Voltar para hoje</Button>
            )}
          </div>
        </div>
        <Button variant="secondary" onClick={baixarRelatorio} disabled={baixandoPdf}>
          <IconFileText size={16} /> {baixandoPdf ? 'Gerando…' : 'Relatório em PDF'}
        </Button>
      </div>

      {/* Saldo + os três números do período */}
      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] mb-6">
        <section className="ui-card bg-white rounded-2xl border border-slate-200 p-5 min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[13px] font-semibold text-slate-500">Em caixa hoje</p>
              <p className={`text-3xl font-extrabold tracking-[-0.04em] tnum mt-1 ${painel.emCaixa < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                {formatBRL(painel.emCaixa)}
              </p>
              <p className="text-xs text-slate-500 mt-1">Tudo o que já entrou menos tudo o que já saiu</p>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-slate-500">
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-4 rounded bg-[var(--accent-blue)]" /> Real
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-0 w-4 border-t-2 border-dashed border-[var(--accent-blue)] opacity-70" /> Previsto
              </span>
            </div>
          </div>
          <div className="mt-3 min-w-0 overflow-hidden">
            <GraficoSaldo
              serie={serie}
              formatar={formatBRL}
              rotuloDia={(dia) => (escala === 'anual' ? mesCurto(dia.slice(0, 7)) : diaMes(dia))}
            />
          </div>
        </section>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <CartaoNumero
            tom="verde"
            icone={<IconEntrada size={18} />}
            rotulo="Entrou"
            valor={formatBRL(painel.entrou)}
            detalhe={painel.aReceber > 0 ? `+ ${formatBRL(painel.aReceber)} a receber` : 'Nada a receber'}
          />
          <CartaoNumero
            tom="vermelho"
            icone={<IconSaida size={18} />}
            rotulo="Saiu"
            valor={formatBRL(painel.saiu)}
            detalhe={painel.aPagar > 0 ? `+ ${formatBRL(painel.aPagar)} a pagar` : 'Nada a pagar'}
          />
          <CartaoNumero
            tom="azul"
            icone={<IconWallet size={18} />}
            rotulo={passado ? `Saldo em ${fimDoPeriodo}` : `Previsto p/ ${fimDoPeriodo}`}
            valor={formatBRL(painel.saldoFinal)}
            detalhe={passado ? 'Como o caixa fechou' : 'Se tudo em aberto se confirmar'}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Abas */}
        <section className="ui-card bg-white rounded-2xl border border-slate-200 lg:col-span-2 order-2 lg:order-1 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
            <div role="tablist" aria-label="Seções do financeiro" className="flex flex-wrap gap-1">
              {ABAS.map(([v, r]) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={aba === v}
                  onClick={() => setAba(v)}
                  className={`rounded-xl px-3.5 py-2 text-sm font-semibold cursor-pointer transition-colors ${
                    aba === v ? 'bg-slate-900 text-slate-50' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
            {aba === 'salarios' && (
              <Button variant="secondary" onClick={() => abrirCadastroFuncionario()}>
                <IconPlus size={16} /> Funcionário
              </Button>
            )}
          </div>

          <div className="px-5 pb-5 pt-4">
            {aba === 'movimentos' && (
              <>
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <Segmentos
                    rotulo="Tipo"
                    valor={filtroTipo}
                    onChange={setFiltroTipo}
                    opcoes={[['todos', 'Tudo'], ['entrada', 'Entradas'], ['saida', 'Saídas']]}
                  />
                  <Segmentos
                    rotulo="Situação"
                    valor={filtroSituacao}
                    onChange={setFiltroSituacao}
                    opcoes={[['geral', 'Geral'], ['aberto', 'Em aberto'], ['pago', 'Pagos']]}
                  />
                  <div className="relative flex-1 min-w-[12rem]">
                    <IconSearch size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <input
                      className={`${inputCls} pl-9`}
                      type="search"
                      value={busca}
                      onChange={(e) => setBusca(e.target.value)}
                      placeholder="Buscar descrição, cliente, valor…"
                      aria-label="Buscar nos movimentos"
                    />
                  </div>
                </div>

                <div className="hidden sm:grid grid-cols-[2.25rem_minmax(0,1fr)_7rem_5.5rem_8.5rem] gap-x-3 pb-2 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  <span />
                  <span>Descrição</span>
                  <span>Data</span>
                  <span>Forma</span>
                  <span className="text-right">Valor</span>
                </div>

                {movimentos.length === 0 ? (
                  <Empty>
                    {termo
                      ? `Nada encontrado para “${busca.trim()}”.`
                      : filtroSituacao === 'geral'
                        ? `Nada foi lançado em ${rotuloPeriodo.toLowerCase()}.`
                        : `Nada ${filtroSituacao === 'pago' ? 'pago' : 'em aberto'} em ${rotuloPeriodo.toLowerCase()}.`}
                  </Empty>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {movimentosDaPagina.map((l, i) => {
                      const grupo = filtroSituacao === 'geral' ? rotuloDoRegistro(l) : null
                      const abreGrupo = grupo && (i === 0 || rotuloDoRegistro(movimentosDaPagina[i - 1]) !== grupo)
                      return abreGrupo ? (
                        <li key={l.id} className="!border-t-0">
                          <p className={`${i === 0 ? 'pt-3' : 'pt-5'} pb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 border-b border-slate-200`}>
                            {grupo}
                          </p>
                          <ul><LinhaMovimento l={l} /></ul>
                        </li>
                      ) : <LinhaMovimento key={l.id} l={l} />
                    })}
                  </ul>
                )}
                <Paginacao {...barra} />
              </>
            )}

            {aba === 'fluxo' && (
              <>
                <p className="text-sm text-slate-500 mb-4">
                  Começa com os <span className="font-semibold text-slate-900 tnum">{formatBRL(painel.emCaixa)}</span> em
                  caixa hoje e soma o que está em aberto em cada mês. O que já venceu e não foi pago entra no mês atual.
                </p>
                <GraficoFluxo meses={fluxo} formatar={formatBRL} rotuloMes={mesCurto} />
                <div className="flex flex-wrap gap-4 text-[11px] text-slate-500 mt-2 mb-4">
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Entra</span>
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-red-500" /> Sai</span>
                  <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-[var(--accent-blue)]" /> Saldo no fim do mês</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 border-b border-slate-200">
                        <th className="text-left font-semibold py-2">Mês</th>
                        <th className="text-right font-semibold py-2">Entra</th>
                        <th className="text-right font-semibold py-2">Sai</th>
                        <th className="text-right font-semibold py-2">Saldo no fim</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {fluxo.map((f) => (
                        <tr key={f.mes}>
                          <td className="py-2.5 font-medium text-slate-900 first-letter:uppercase">{rotuloDoMes(f.mes)}</td>
                          <td className="py-2.5 text-right tnum text-emerald-700">{formatBRL(f.entra)}</td>
                          <td className="py-2.5 text-right tnum text-slate-700">{formatBRL(f.sai)}</td>
                          <td className={`py-2.5 text-right tnum font-bold ${f.acumulado < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                            {formatBRL(f.acumulado)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {aba === 'relatorio' && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
                  {[
                    ['Entrou', relatorio.entradas.realizado, relatorioAnterior.entradas.realizado, false],
                    ['Saiu', relatorio.saidas.realizado, relatorioAnterior.saidas.realizado, true],
                    ['Resultado', relatorio.resultado, relatorioAnterior.resultado, false],
                  ].map(([rotulo, valor, anterior, invertido]) => (
                    <div key={rotulo} className="rounded-xl border border-slate-200 p-3">
                      <p className="text-[12px] font-semibold text-slate-500">{rotulo}</p>
                      <p className={`text-lg font-extrabold tnum mt-0.5 ${rotulo === 'Resultado' && valor < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                        {formatBRL(valor)}
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        <Variacao atual={valor} anterior={anterior} invertido={invertido} /> vs {rotuloDoRelatorio(escala, ancoraAnterior)}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  {[
                    ['Para onde foi o dinheiro', relatorio.categorias.saidas, relatorio.saidas.realizado, 'bg-red-500', 'Nenhuma saída paga no período.'],
                    ['De onde veio o dinheiro', relatorio.categorias.entradas, relatorio.entradas.realizado, 'bg-emerald-500', 'Nenhum recebimento no período.'],
                  ].map(([titulo, lista, total, cor, vazio]) => (
                    <div key={titulo}>
                      <p className="text-sm font-semibold text-slate-900 mb-3">{titulo}</p>
                      {lista.length === 0 ? (
                        <p className="text-xs text-slate-400">{vazio}</p>
                      ) : (
                        <ul className="space-y-3">
                          {lista.map(({ categoria, total: valor }) => (
                            <li key={categoria}>
                              <div className="flex items-center justify-between text-xs mb-1">
                                <span className="text-slate-600">{nomeCategoria(categoria)}</span>
                                <span className="tnum font-semibold text-slate-900">
                                  {formatBRL(valor)}
                                  <span className="text-slate-400 font-medium ml-1.5">
                                    {Math.round((valor / Math.max(1, total)) * 100)}%
                                  </span>
                                </span>
                              </div>
                              <div className="h-1.5 rounded-full bg-slate-100" role="presentation">
                                <div className={`h-1.5 rounded-full ${cor}`} style={{ width: `${Math.round((valor / Math.max(1, total)) * 100)}%` }} />
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            {aba === 'salarios' && (
              <>
                <p className="text-sm text-slate-500 mb-4">
                  Salários de <span className="font-semibold text-slate-900">{rotuloDoMes(competencia)}</span>
                  {folha.contas.length > 0 && (
                    <>
                      {' · '}folha de <span className="tnum font-semibold text-slate-900">{formatBRL(folha.total.salario)}</span>
                      {', '}falta pagar <span className={`tnum font-semibold ${folha.total.saldo < 0 ? 'text-red-600' : 'text-slate-900'}`}>{formatBRL(folha.total.saldo)}</span>
                    </>
                  )}
                </p>

                {folha.contas.length === 0 ? (
                  <div className="py-8 text-center">
                    <p className="text-sm text-slate-500">
                      {mostrarInativos ? 'Nenhum funcionário cadastrado ainda.' : 'Nenhum funcionário ativo neste mês.'}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      Cadastre nome e salário para o sistema calcular quanto falta pagar a cada um.
                    </p>
                    <div className="mt-4">
                      <Button onClick={() => abrirCadastroFuncionario()}>
                        <IconPlus size={16} /> Cadastrar funcionário
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="hidden sm:grid grid-cols-[minmax(0,1fr)_6.5rem_7rem_9.5rem] gap-x-3 pb-2 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      <span>Funcionário</span>
                      <span className="text-right">Já pago</span>
                      <span className="text-right">Falta</span>
                      <span />
                    </div>
                    <ul className="divide-y divide-slate-100">
                      {folha.contas.map((conta) => {
                        const f = conta.funcionario
                        const negativo = conta.saldo < -0.004
                        const fechada = Math.abs(conta.saldo) < 0.005
                        return (
                          <li
                            key={conta.funcionarioId}
                            className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_6.5rem_7rem_9.5rem] items-center gap-x-3 gap-y-2 py-3"
                          >
                            <button
                              type="button"
                              onClick={() => abrirCadastroFuncionario(f)}
                              className="min-w-0 text-left cursor-pointer rounded-lg -mx-1.5 px-1.5 py-1 hover:bg-slate-100"
                              title="Editar funcionário"
                            >
                              <p className="text-sm font-semibold text-slate-900 truncate flex items-center gap-2">
                                {f.nome || '(sem nome)'}
                                {f.ativo === false && <Badge>Desligado</Badge>}
                              </p>
                              <p className="text-xs text-slate-500 leading-relaxed">
                                {f.cargo || 'Sem função'} · salário {formatBRL(conta.salario)}
                                {conta.vales > 0 && (
                                  <span className="text-amber-700">
                                    {' · '}{conta.quantidadeVales} vale{conta.quantidadeVales === 1 ? '' : 's'} de {formatBRL(conta.vales)}
                                  </span>
                                )}
                              </p>
                            </button>
                            <span className="hidden sm:block text-right text-sm tnum text-slate-700">{formatBRL(conta.pago)}</span>
                            <span
                              className={`text-right text-sm tnum font-bold ${negativo ? 'text-red-600' : fechada ? 'text-emerald-700' : 'text-slate-900'}`}
                              title={negativo ? `Já foi lançado ${formatBRL(Math.abs(conta.saldo))} a mais do que o salário` : ''}
                            >
                              {fechada ? 'Pago' : formatBRL(conta.saldo)}
                            </span>
                            <div className="col-span-2 sm:col-span-1 flex gap-1 justify-end">
                              <Button variant="ghost" onClick={() => lancarNaFolha(f, 'vale')}>Vale</Button>
                              <Button
                                variant="secondary"
                                disabled={conta.saldo <= 0.004}
                                onClick={() => lancarNaFolha(f, 'salario', conta.saldo > 0 ? conta.saldo.toFixed(2) : '')}
                              >
                                Pagar
                              </Button>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  </>
                )}

                <label className="flex items-center gap-2 text-xs text-slate-500 mt-4 pt-3 border-t border-slate-100">
                  <input
                    type="checkbox"
                    className="w-4 h-4 accent-slate-900"
                    checked={mostrarInativos}
                    onChange={(e) => setMostrarInativos(e.target.checked)}
                  />
                  Mostrar também os desligados
                </label>
              </>
            )}
          </div>
        </section>

        {/* Precisa de atenção — o que pede ação hoje, fora de qualquer período. */}
        <section
          className={`rounded-2xl border p-5 order-1 lg:order-2 ${
            atrasadosTodos.length ? 'bg-red-50 border-red-200' : 'ui-card bg-white border-slate-200'
          }`}
        >
          <div className="flex items-start gap-3">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
              atrasadosTodos.length ? 'bg-red-500 text-[var(--btn-primary-fg)]' : 'bg-slate-100 text-slate-500'
            }`}>
              <IconAlert size={18} />
            </span>
            <div>
              <h3 className="text-base font-bold text-slate-900">Precisa de atenção</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {atencao.length === 0
                  ? 'Nada vencido nem vencendo nos próximos 7 dias.'
                  : [
                      atrasadosTodos.length ? `${atrasadosTodos.length} vencido${atrasadosTodos.length === 1 ? '' : 's'}` : '',
                      atencao.length - atrasadosTodos.length
                        ? `${atencao.length - atrasadosTodos.length} vence${atencao.length - atrasadosTodos.length === 1 ? '' : 'm'} em até 7 dias`
                        : '',
                    ].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>

          {atencao.length > 0 && (
            <ul className="mt-4 space-y-1">
              {atencao.slice(0, 8).map((l) => {
                const atrasado = l.vencimento < hoje
                return (
                  <li key={l.id} className="flex items-center gap-3 py-1.5">
                    <BotaoBaixa l={l} atrasado={atrasado} onClick={() => alternarBaixa(l)} />
                    <button type="button" onClick={() => editar(l)} className="min-w-0 flex-1 text-left cursor-pointer">
                      <p className="text-sm font-semibold text-slate-900 truncate">{l.descricao || '(sem descrição)'}</p>
                      <p className={`text-[11px] font-medium ${atrasado ? 'text-red-600' : 'text-slate-500'}`}>{quando(l)}</p>
                    </button>
                    <span className={`text-sm font-bold tnum shrink-0 ${l.tipo === 'entrada' ? 'text-emerald-700' : 'text-slate-900'}`}>
                      {l.tipo === 'entrada' ? '+' : '−'} {formatBRL(l.valor)}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
          {atencao.length > 8 && (
            <p className="text-xs text-slate-500 mt-2">
              E mais {atencao.length - 8}. Veja todos em Movimentos, filtrando por “Em aberto”.
            </p>
          )}
        </section>
      </div>

      {/* Enquanto o cadastro de funcionário (ou a confirmação de exclusão) está
          por cima, o Esc é dele: sem isto, uma tecla fecharia os dois e o
          lançamento digitado se perderia. */}
      <Modal
        title={form?.id
          ? (form.tipo === 'entrada' ? 'Editar entrada' : 'Editar saída')
          : (form?.tipo === 'entrada' ? 'Nova entrada' : 'Nova saída')}
        open={!!form}
        onClose={() => { if (!formFuncionario && !excluir) setForm(null) }}
      >
        {form && (() => {
          const vinculado = !!(form.vendaId || form.agendamentoId)
          const pago = form.status === 'realizado'
          const verbo = form.tipo === 'entrada' ? 'recebido' : 'pago'
          const mesFolha = form.competencia || competenciaDe(form)
          // Um lançamento igual a outro que já existe (tipo, valor, descrição e
          // vencimento) quase sempre é o mesmo digitado duas vezes. Avisa, mas
          // deixa salvar: duas compras iguais no mesmo dia também acontecem.
          const chave = (t) => String(t || '').trim().toUpperCase()
          const repetido = !form.id && form.descricao && Number(form.valor) > 0
            ? todos.find((l) => l.tipo === form.tipo
                && Math.round(Number(l.valor) * 100) === Math.round(Number(form.valor) * 100)
                && chave(l.descricao) === chave(form.descricao)
                && l.vencimento === form.vencimento)
            : null
          return (
            <form onSubmit={salvar} className="space-y-4">
              {/* Editar aqui vale para JÁ; a origem continua sendo a fonte de
                  verdade e recalcula valor, vencimento e parcelas na próxima vez
                  que for salva. Melhor o usuário saber disso antes de digitar. */}
              {vinculado && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 leading-relaxed">
                  Veio d{form.agendamentoId ? 'e um agendamento' : 'e uma venda'}. Se {form.agendamentoId ? 'o agendamento' : 'a venda'} for
                  salvo de novo, valor e datas voltam a ser calculados de lá.
                </p>
              )}

              {!vinculado && (
                <Segmentos
                  rotulo="Tipo do lançamento"
                  valor={form.tipo}
                  onChange={trocarTipo}
                  opcoes={[['entrada', 'Entrada'], ['saida', 'Saída']]}
                />
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Valor (R$)">
                  <InputNumero className={inputCls} step="0.01" min="0" required value={form.valor} onChange={set('valor')} autoFocus={!form.id} />
                </Field>
                <Field label="Vencimento">
                  <input className={inputCls} type="date" required value={form.vencimento} onChange={set('vencimento')} />
                </Field>
              </div>
              <Field label="Descrição">
                <input
                  className={inputCls}
                  required
                  placeholder={form.tipo === 'entrada' ? 'ex.: Manutenção avulsa — cliente X' : 'ex.: Compra de refis — fornecedor X'}
                  value={form.descricao}
                  onChange={set('descricao')}
                />
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Categoria">
                  <select className={inputCls} value={form.categoria} onChange={set('categoria')}>
                    {Object.entries(form.tipo === 'saida' ? CATEGORIAS_SAIDA : CATEGORIAS_ENTRADA)
                      .map(([v, r]) => <option key={v} value={v}>{r}</option>)}
                  </select>
                </Field>
                <Field label="Forma de pagamento">
                  <select className={inputCls} value={form.formaPagamento} onChange={set('formaPagamento')}>
                    {Object.entries(FORMAS_PAGAMENTO).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
                  </select>
                </Field>
              </div>

              {form.categoria === 'ajuste' && (
                <p className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 leading-relaxed">
                  Ajuste de saldo acerta o caixa com o extrato do banco. Ele muda o &ldquo;Em caixa&rdquo;, mas não
                  conta como {form.tipo === 'entrada' ? 'faturamento' : 'despesa'} nos relatórios.
                </p>
              )}

              {/* SALÁRIO E VALE — a saída tem dono e mês. O vale é abatido do
                  salário daquele mês em vez de virar despesa nova. */}
              {form.tipo === 'saida' && daFolha(form.categoria) && (
                <div className="rounded-xl border border-slate-200 p-3 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Funcionário">
                      <select className={inputCls} required value={form.funcionarioId || ''} onChange={escolherFuncionarioNoForm}>
                        <option value="">Selecione…</option>
                        {funcionarios
                          .list()
                          .filter((f) => f.ativo !== false || f.id === form.funcionarioId)
                          .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'))
                          .map((f) => (
                            <option key={f.id} value={f.id}>{f.nome}{f.cargo ? ` — ${f.cargo}` : ''}</option>
                          ))}
                      </select>
                    </Field>
                    <Field label="Salário de qual mês">
                      <input className={inputCls} type="month" value={mesFolha} onChange={set('competencia')} />
                    </Field>
                  </div>

                  {contaDoForm ? (() => {
                    const valor = Number(form.valor || 0)
                    const depois = contaDoForm.saldo - valor
                    const passou = depois < -0.004
                    return (
                      <p className={`text-xs leading-relaxed ${passou ? 'text-red-600' : 'text-slate-500'}`}>
                        Salário de {formatBRL(contaDoForm.salario)} em {rotuloDoMes(mesFolha)}
                        {contaDoForm.vales > 0 ? `, ${formatBRL(contaDoForm.vales)} em vales` : ''}.{' '}
                        {valor > 0
                          ? <>Depois deste, falta <span className="font-semibold tnum">{formatBRL(depois)}</span>.</>
                          : <>Falta <span className="font-semibold tnum">{formatBRL(contaDoForm.saldo)}</span>.</>}
                        {passou && ' Passa do salário do mês — dá para salvar, mas confira.'}{' '}
                        <button
                          type="button"
                          className="text-blue-700 font-semibold cursor-pointer hover:underline"
                          onClick={() => abrirCadastroFuncionario(funcionarios.get(form.funcionarioId), true)}
                        >
                          Alterar salário
                        </button>
                      </p>
                    )
                  })() : (
                    <button
                      type="button"
                      className="text-xs text-blue-700 font-semibold cursor-pointer hover:underline"
                      onClick={() => abrirCadastroFuncionario(null, true)}
                    >
                      + Cadastrar funcionário
                    </button>
                  )}
                </div>
              )}

              {/* Pago ou em aberto: um interruptor, e a data só quando importa. */}
              <div className="rounded-xl bg-slate-100 px-3 py-2.5 flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2.5 text-sm font-semibold text-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-4 h-4 accent-emerald-500"
                    checked={pago}
                    onChange={(e) => setForm({
                      ...form,
                      status: e.target.checked ? 'realizado' : 'previsto',
                      // Sem data de pagamento o caixa não saberia QUANDO o dinheiro
                      // se moveu: assume o vencimento (ou hoje).
                      dataPagamento: e.target.checked ? (form.dataPagamento || form.vencimento || hoje) : '',
                    })}
                  />
                  Já foi {verbo}
                </label>
                {pago && (
                  <label className="flex items-center gap-2 text-xs text-slate-500">
                    em
                    <input
                      className={`${inputCls} !w-auto !py-1.5`}
                      type="date"
                      value={form.dataPagamento}
                      onChange={set('dataPagamento')}
                      aria-label={`Data em que foi ${verbo}`}
                    />
                  </label>
                )}
              </div>

              <details className="group" open={!!form.observacoes || repeticao.ativo || undefined}>
                <summary className="text-sm font-semibold text-blue-700 cursor-pointer select-none list-none flex items-center gap-1">
                  <IconChevronRight size={14} className="transition-transform group-open:rotate-90" />
                  Mais opções
                  <span className="font-normal text-slate-400">{form.id ? '(observações)' : '(repetir todo mês, observações)'}</span>
                </summary>
                <div className="space-y-4 mt-3">
                  {!form.id && (
                    <div className="rounded-xl border border-slate-200 p-3 space-y-3">
                      <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                        <input
                          type="checkbox"
                          className="w-4 h-4 accent-slate-900"
                          checked={repeticao.ativo}
                          onChange={(e) => setRepeticao({ ...repeticao, ativo: e.target.checked })}
                        />
                        Repetir todo mês (parcelado ou conta fixa)
                      </label>
                      {repeticao.ativo && (
                        <>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <Field label="Quantas vezes">
                              <InputNumero
                                className={inputCls}
                                min="2" max="360" step="1"
                                value={repeticao.vezes}
                                onChange={(e) => setRepeticao({ ...repeticao, vezes: e.target.value })}
                              />
                            </Field>
                            <Field label="O valor digitado é">
                              <select
                                className={inputCls}
                                value={repeticao.dividir ? 'total' : 'parcela'}
                                onChange={(e) => setRepeticao({ ...repeticao, dividir: e.target.value === 'total' })}
                              >
                                <option value="parcela">De cada parcela</option>
                                <option value="total">O total, a dividir</option>
                              </select>
                            </Field>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <Field label="Parcelas já pagas">
                              <InputNumero
                                className={inputCls}
                                min="0" max="359" step="1"
                                value={repeticao.jaPagas}
                                onChange={(e) => setRepeticao({ ...repeticao, jaPagas: e.target.value })}
                              />
                            </Field>
                            {Number(repeticao.jaPagas) > 0 && (
                              <Field label="As já pagas">
                                <select
                                  className={inputCls}
                                  value={repeticao.lancarPagas ? 'lancar' : 'ignorar'}
                                  onChange={(e) => setRepeticao({ ...repeticao, lancarPagas: e.target.value === 'lancar' })}
                                >
                                  <option value="ignorar">Não lançar</option>
                                  <option value="lancar">Lançar como pagas</option>
                                </select>
                              </Field>
                            )}
                          </div>
                          {/* O vencimento é sempre o da 1ª parcela: é dele que sai o
                              calendário inteiro. A prévia diz as duas pontas. */}
                          <p className="text-xs text-slate-500 leading-relaxed">
                            {(() => {
                              const n = Math.max(2, Math.min(360, Number(repeticao.vezes) || 2))
                              const pagas = Math.min(Math.max(0, Number(repeticao.jaPagas) || 0), n - 1)
                              const valor = Number(form.valor || 0)
                              const cada = repeticao.dividir ? valor / n : valor
                              const total = repeticao.dividir ? valor : valor * n
                              const linhas = [
                                `${n}× de ${formatBRL(cada)} = ${formatBRL(total)}.`,
                                `A 1ª vence em ${formatData(form.vencimento)} e a ${n}ª em ${formatData(somarMeses(form.vencimento, n - 1))}.`,
                              ]
                              if (pagas > 0) {
                                linhas.push(
                                  `Em aberto: da ${pagas + 1}ª à ${n}ª (${formatBRL(cada * (n - pagas))}).`,
                                  repeticao.lancarPagas
                                    ? `As ${pagas} já pagas entram como pagas, cada uma no seu mês.`
                                    : `As ${pagas} já pagas não serão lançadas.`,
                                )
                              }
                              return linhas.join(' ')
                            })()}
                          </p>
                        </>
                      )}
                    </div>
                  )}
                  <Field label="Observações">
                    <textarea className={inputCls} rows="2" value={form.observacoes} onChange={set('observacoes')} />
                  </Field>
                </div>
              </details>

              {repetido && (
                <p className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 leading-relaxed" role="status">
                  <IconAlert size={15} className="shrink-0 mt-px" />
                  <span>
                    Já existe um lançamento igual: <span className="font-semibold">{repetido.descricao.trim()}</span>,{' '}
                    {formatBRL(repetido.valor)}, vencimento {formatData(repetido.vencimento)}
                    {repetido.status === 'realizado' ? ` (já ${repetido.tipo === 'entrada' ? 'recebido' : 'pago'})` : ''}.
                    Se não for o mesmo, pode salvar.
                  </span>
                </p>
              )}

              <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 pt-2">
                <div>
                  {form.id && (
                    <Button type="button" variant="danger" onClick={() => setExcluir(lancamentos.get(form.id) || form)}>
                      {vinculado ? 'Remover do financeiro' : 'Excluir'}
                    </Button>
                  )}
                </div>
                <div className="flex flex-col-reverse sm:flex-row gap-2">
                  <Button type="button" variant="secondary" onClick={() => { setForm(null); setRepeticao(REPETICAO_VAZIA) }}>Cancelar</Button>
                  <Button type="submit">{repetido ? 'Salvar mesmo assim' : 'Salvar'}</Button>
                </div>
              </div>
            </form>
          )
        })()}
      </Modal>

      <Modal
        title={excluir?.origem === 'manual' ? 'Excluir lançamento' : 'Remover do financeiro'}
        open={!!excluir}
        onClose={() => setExcluir(null)}
      >
        {excluir && (() => {
          const irmaos = lancamentosDaOrigem(excluir)
          const pagos = irmaos.filter((l) => l.status === 'realizado')
          const previstos = irmaos.filter((l) => l.status !== 'realizado')
          const vinculado = irmaos.length > 0
          const origem = excluir.agendamentoId ? 'este agendamento' : 'esta venda'

          return (
            <div className="space-y-4">
              {!vinculado ? (
                <p className="text-sm text-slate-600">
                  Excluir <span className="font-semibold text-slate-900">{excluir.descricao}</span>{' '}
                  ({formatBRL(excluir.valor)})? Essa ação não pode ser desfeita.
                </p>
              ) : (
                <>
                  <p className="text-sm text-slate-600">
                    Este lançamento pertence a {origem}. Remover aqui desliga o{' '}
                    <span className="font-medium text-slate-900">“Lançar no financeiro”</span> na origem —
                    senão ele voltaria na próxima vez que {origem} fosse salvo.
                  </p>
                  <ul className="text-sm text-slate-600 rounded-lg border border-slate-200 divide-y divide-slate-100">
                    <li className="px-3 py-2 flex justify-between gap-3">
                      <span>{previstos.length} parcela{previstos.length === 1 ? '' : 's'} em aberto</span>
                      <span className="font-medium text-red-600">sai{previstos.length === 1 ? '' : 'em'} do caixa</span>
                    </li>
                    {pagos.length > 0 && (
                      <li className="px-3 py-2 flex justify-between gap-3">
                        <span>{pagos.length} já recebida{pagos.length === 1 ? '' : 's'}</span>
                        <span className="font-medium text-emerald-700">continua{pagos.length === 1 ? '' : 'm'} no caixa</span>
                      </li>
                    )}
                  </ul>
                  {pagos.length > 0 && (
                    <p className="text-xs text-slate-400">
                      Dinheiro que já entrou continua no histórico e no relatório; só deixa de ser
                      recalculado a partir de {origem}.
                    </p>
                  )}
                </>
              )}
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
                <Button type="button" variant="secondary" onClick={() => setExcluir(null)} disabled={removendo}>
                  Cancelar
                </Button>
                <Button type="button" variant="danger" onClick={confirmarExcluir} disabled={removendo}>
                  {removendo ? 'Removendo…' : vinculado ? 'Remover do financeiro' : 'Excluir'}
                </Button>
              </div>
            </div>
          )
        })()}
      </Modal>

      {/* Cadastro do funcionário: quem é, o que faz e quanto ganha. O salário
          pode ser alterado a qualquer momento — passa a valer da folha em que
          for digitado em diante; os meses já lançados não mudam. */}
      <Modal
        title={formFuncionario?.id ? 'Editar funcionário' : 'Novo funcionário'}
        open={!!formFuncionario}
        onClose={() => { setFormFuncionario(null); setCadastroVoltaAoLancamento(false) }}
      >
        {formFuncionario && (
          <form onSubmit={salvarCadastroFuncionario} className="space-y-4">
            <Field label="Nome">
              <input className={inputCls} required value={formFuncionario.nome} onChange={setFunc('nome')} />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Função">
                <input
                  className={inputCls}
                  placeholder="ex.: Técnico instalador"
                  value={formFuncionario.cargo}
                  onChange={setFunc('cargo')}
                />
              </Field>
              <Field label="Salário mensal (R$)">
                <InputNumero
                  className={inputCls}
                  step="0.01" min="0" required
                  value={formFuncionario.salario}
                  onChange={setFunc('salario')}
                />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Dia do pagamento">
                <InputNumero
                  className={inputCls}
                  min="1" max="31" step="1"
                  value={formFuncionario.diaPagamento ?? ''}
                  onChange={setFunc('diaPagamento')}
                />
              </Field>
              <Field label="Telefone">
                <input className={inputCls} value={formFuncionario.telefone} onChange={setFunc('telefone')} />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Admissão">
                <input className={inputCls} type="date" value={formFuncionario.admissao} onChange={setFunc('admissao')} />
              </Field>
              <Field label="Situação">
                <select
                  className={inputCls}
                  value={formFuncionario.ativo === false ? 'inativo' : 'ativo'}
                  onChange={(e) => setFormFuncionario({ ...formFuncionario, ativo: e.target.value === 'ativo' })}
                >
                  <option value="ativo">Ativo</option>
                  <option value="inativo">Desligado</option>
                </select>
              </Field>
            </div>
            <Field label="Observações">
              <textarea className={inputCls} rows="2" value={formFuncionario.observacoes} onChange={setFunc('observacoes')} />
            </Field>
            {formFuncionario.id && (
              <p className="text-xs text-slate-500 leading-relaxed">
                Mudar o salário vale do mês atual em diante. O que já foi lançado não muda.
              </p>
            )}
            <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 pt-2">
              <div>
                {formFuncionario.id && !cadastroVoltaAoLancamento && (
                  <Button
                    type="button"
                    variant="danger"
                    onClick={() => { setExcluirFunc(formFuncionario); setFormFuncionario(null) }}
                    disabled={salvandoFuncionario}
                  >
                    Excluir
                  </Button>
                )}
              </div>
              <div className="flex flex-col-reverse sm:flex-row gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => { setFormFuncionario(null); setCadastroVoltaAoLancamento(false) }}
                  disabled={salvandoFuncionario}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={salvandoFuncionario}>
                  {salvandoFuncionario ? 'Salvando…' : 'Salvar'}
                </Button>
              </div>
            </div>
          </form>
        )}
      </Modal>

      <Modal title="Excluir funcionário" open={!!excluirFunc} onClose={() => setExcluirFunc(null)}>
        {excluirFunc && (() => {
          const doFuncionario = lancamentosDoFuncionario(excluirFunc.id)
          return (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">
                {doFuncionario.length === 0 ? (
                  <>Excluir <span className="font-semibold text-slate-900">{excluirFunc.nome}</span>? Essa ação não pode ser desfeita.</>
                ) : (
                  <>
                    <span className="font-semibold text-slate-900">{excluirFunc.nome}</span> tem{' '}
                    {doFuncionario.length} lançamento{doFuncionario.length === 1 ? '' : 's'} no caixa, então será{' '}
                    <span className="font-medium text-slate-900">desligado</span> em vez de excluído: sai da folha,
                    mas o dinheiro que já saiu continua no histórico e nos relatórios.
                  </>
                )}
              </p>
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
                <Button type="button" variant="secondary" onClick={() => setExcluirFunc(null)} disabled={removendo}>
                  Cancelar
                </Button>
                <Button type="button" variant="danger" onClick={confirmarExcluirFuncionario} disabled={removendo}>
                  {removendo ? 'Salvando…' : (doFuncionario.length === 0 ? 'Excluir' : 'Desligar')}
                </Button>
              </div>
            </div>
          )
        })()}
      </Modal>
    </Page>
  )
}
