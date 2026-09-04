import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  lancamentos, clientes,
  salvarLancamento, salvarLancamentosRepetidos, excluirLancamento, darBaixa, estornarLancamento,
  removerDoFinanceiro, lancamentosDaOrigem,
  formatBRL, formatData, hojeISO, somarMeses,
  resumoDoMes, resumoDoPeriodo, variacao, somarMesesNoMes, mesDe,
  FORMAS_PAGAMENTO, CATEGORIAS_SAIDA,
} from '../data/repository.js'
import {
  ESCALAS_RELATORIO, intervaloDoRelatorio, andarNoRelatorio,
  rotuloDoRelatorio, periodoEmCurso,
} from '../lib/datas.js'
import { gerarRelatorioPdf } from '../relatorio/gerarPdf.js'
import { Card, Page, PageTitle, Button, Field, inputCls, Empty, Modal, Badge, notificar } from '../components/ui.jsx'
import {
  IconPlus, IconPencil, IconTrash, IconWallet, IconClock, IconAlert,
  IconChevronLeft, IconChevronRight, IconSearch, IconFileText,
} from '../components/icons.jsx'

const CATEGORIAS_ENTRADA = { venda: 'Venda', servico: 'Serviço', outros: 'Outros' }
const nomeCategoria = (c) => CATEGORIAS_SAIDA[c] ?? CATEGORIAS_ENTRADA[c] ?? c

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

const REPETICAO_VAZIA = { ativo: false, vezes: 12, dividir: false, jaPagas: 0, lancarPagas: false }

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
  const [busca, setBusca] = useState('')
  const [form, setForm] = useState(null)
  const [excluir, setExcluir] = useState(null)
  // Repetição fica FORA do form porque não é campo do lançamento: é instrução
  // de como criá-lo. Vai para o banco a consequência (N lançamentos), não a regra.
  const [repeticao, setRepeticao] = useState(REPETICAO_VAZIA)
  const [removendo, setRemovendo] = useState(false)

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

  // ---- Relatório (com o período anterior lado a lado) ----
  //
  // O par (escala, âncora): a escala diz o tamanho da janela — semana, mês, ano
  // — e a âncora é um dia qualquer dentro dela. Navegar é mexer só na âncora.
  const [escala, setEscala] = useState('mensal')
  const [ancora, setAncora] = useState(() => hojeISO())

  const periodo = intervaloDoRelatorio(escala, ancora)
  const ancoraAnterior = andarNoRelatorio(escala, ancora, -1)
  const periodoAnterior = intervaloDoRelatorio(escala, ancoraAnterior)

  const relatorio = useMemo(() => resumoDoPeriodo(todos, periodo), [todos, periodo.de, periodo.ate])
  const relatorioAnterior = useMemo(
    () => resumoDoPeriodo(todos, periodoAnterior),
    [todos, periodoAnterior.de, periodoAnterior.ate],
  )
  const noPeriodoAtual = periodoEmCurso(escala, ancora, hoje)
  const [baixandoPdf, setBaixandoPdf] = useState(false)

  // Trocar de escala NÃO mexe na âncora, de propósito. Normalizá-la para o
  // início do período novo parece inofensivo e não é: ir de Setembro para Anual
  // levaria a âncora para 1º de janeiro, e voltar para Mensal cairia em Janeiro
  // em vez de Setembro — você perde o lugar só de espiar o ano.
  //
  // Mantendo o dia, as três escalas são três janelas sobre o MESMO ponto no
  // tempo, e ir e voltar entre elas não muda nada.
  const trocarEscala = setEscala

  async function baixarRelatorio() {
    setBaixandoPdf(true)
    try {
      await gerarRelatorioPdf({
        rotuloEscala: ESCALAS_RELATORIO[escala],
        rotuloPeriodo: rotuloDoRelatorio(escala, ancora),
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
    } catch (erro) {
      notificar('Não foi possível remover do financeiro: ' + (erro?.message || erro), 'erro')
    } finally {
      setRemovendo(false)
      refresh()
    }
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  // Abre o mesmo formulário do "Novo lançamento", já preenchido. Campos que só
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
    })
  }

  // Busca simples nas contas: descrição, categoria, forma, cliente e valor.
  const termo = busca.trim().toLowerCase()
  const combina = (l) => {
    if (!termo) return true
    const cliente = l.clienteId ? clientes.get(l.clienteId)?.nome : ''
    return [
      l.descricao,
      nomeCategoria(l.categoria),
      FORMAS_PAGAMENTO[l.formaPagamento] ?? l.formaPagamento,
      cliente,
      l.observacoes,
      formatBRL(l.valor),
      String(l.valor ?? ''),
    ].some((campo) => (campo || '').toString().toLowerCase().includes(termo))
  }

  const listaDaAba = {
    receber: aReceber,
    pagar: aPagar,
    realizados: [...recebido, ...pago],
  }[aba]
    .filter(combina)
    .sort((a, b) => (a.vencimento || '').localeCompare(b.vencimento || ''))

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
          <Button variant="ghost" onClick={() => editar(l)} title="Editar lançamento" aria-label="Editar lançamento">
            <IconPencil size={15} />
          </Button>
          {/* Lançamentos vinculados também podem sair, mas a remoção age na
              ORIGEM (desliga "Lançar no financeiro" lá) — apagar só a linha aqui
              não adiantaria: a próxima gravação da venda/agendamento a recria. */}
          <Button variant="danger" onClick={() => setExcluir(l)} title="Remover do financeiro">
            <IconTrash size={15} />
          </Button>
        </div>
      </li>
    )
  }

  return (
    <Page>
      <PageTitle
        subtitle="Entradas, saídas e o caixa dos próximos meses"
        action={
          <Button onClick={() => { setRepeticao(REPETICAO_VAZIA); setForm({ ...FORM_VAZIO }) }}>
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

      {/* Relatório — semanal, mensal ou anual, com download em PDF */}
      <Card
        className="mb-6"
        title="Relatório"
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="w-28 shrink-0">
              <select
                className={inputCls + ' cursor-pointer'}
                value={escala}
                onChange={(e) => trocarEscala(e.target.value)}
                aria-label="Escala do relatório"
              >
                {Object.entries(ESCALAS_RELATORIO).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
              </select>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setAncora(andarNoRelatorio(escala, ancora, -1))}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 cursor-pointer"
                aria-label="Período anterior"
                title="Período anterior"
              >
                <IconChevronLeft size={16} />
              </button>
              <span className="text-sm font-semibold text-slate-900 min-w-[11rem] text-center first-letter:uppercase">
                {rotuloDoRelatorio(escala, ancora)}
              </span>
              <button
                type="button"
                onClick={() => setAncora(andarNoRelatorio(escala, ancora, 1))}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 cursor-pointer"
                aria-label="Próximo período"
                title="Próximo período"
              >
                <IconChevronRight size={16} />
              </button>
              {!noPeriodoAtual && (
                <Button variant="ghost" onClick={() => setAncora(hoje)}>Hoje</Button>
              )}
            </div>

            <Button variant="secondary" onClick={baixarRelatorio} disabled={baixandoPdf}>
              <IconFileText size={16} /> {baixandoPdf ? 'Gerando…' : 'Baixar PDF'}
            </Button>
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
                label={noPeriodoAtual ? 'Projeção de fechamento' : 'Resultado com o previsto'}
                valor={relatorio.projetado}
                anterior={relatorioAnterior.projetado}
                cor="text-slate-500"
              />
              <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
                O resultado conta o dinheiro que de fato se moveu no período (pela data da baixa).
                O previsto conta o que vence nele e ainda está em aberto.
                A comparação é com {rotuloDoRelatorio(escala, ancoraAnterior)}.
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

          <div className="relative mb-4">
            <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              className={`${inputCls} pl-9`}
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por descrição, cliente, categoria ou valor"
              aria-label="Buscar nas contas"
            />
          </div>

          <Card>
            {listaDaAba.length === 0 && (
              <Empty>{termo ? `Nada encontrado para “${busca.trim()}”.` : 'Nada por aqui.'}</Empty>
            )}
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
                        <span className="font-medium text-emerald-700">vira{pagos.length === 1 ? '' : 'm'} lançamento manual</span>
                      </li>
                    )}
                  </ul>
                  {pagos.length > 0 && (
                    <p className="text-xs text-slate-400">
                      Dinheiro que já entrou continua no histórico e no relatório do mês; só deixa de ser
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

      <Modal title={form?.id ? 'Editar lançamento' : 'Novo lançamento'} open={!!form} onClose={() => setForm(null)}>
        {form && (
          <form onSubmit={salvar} className="space-y-4">
            {/* Editar aqui vale para JÁ; a origem continua sendo a fonte de
                verdade e recalcula valor, vencimento e parcelas na próxima vez
                que for salva. Melhor o usuário saber disso antes de digitar. */}
            {(form.vendaId || form.agendamentoId) && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 leading-relaxed">
                Este lançamento vem d{form.agendamentoId ? 'e um agendamento' : 'e uma venda'}.
                A edição vale agora, mas se {form.agendamentoId ? 'o agendamento' : 'a venda'} for
                salvo de novo, valor, vencimento e parcelas voltam a ser calculados de lá.
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Tipo">
                <select
                  className={inputCls}
                  value={form.tipo}
                  onChange={set('tipo')}
                  disabled={!!(form.vendaId || form.agendamentoId)}
                >
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
            {!form.id && (
              <div className="rounded-lg border border-slate-200 p-3 space-y-3">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    className="w-4 h-4 accent-slate-900"
                    checked={repeticao.ativo}
                    onChange={(e) => setRepeticao({ ...repeticao, ativo: e.target.checked })}
                  />
                  Repetir todo mês (parcelado / conta fixa)
                </label>
                {repeticao.ativo && (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <Field label="Quantas vezes">
                        <input
                          className={inputCls}
                          type="number" min="2" max="360" step="1"
                          value={repeticao.vezes}
                          onChange={(e) => setRepeticao({ ...repeticao, vezes: e.target.value })}
                        />
                      </Field>
                      <Field label="O valor informado é">
                        <select
                          className={inputCls}
                          value={repeticao.dividir ? 'total' : 'parcela'}
                          onChange={(e) => setRepeticao({ ...repeticao, dividir: e.target.value === 'total' })}
                        >
                          <option value="parcela">O valor de cada parcela</option>
                          <option value="total">O total, a dividir entre as parcelas</option>
                        </select>
                      </Field>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <Field label="Parcelas já pagas">
                        <input
                          className={inputCls}
                          type="number" min="0" max="359" step="1"
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
                            <option value="ignorar">Não lançar — só o que falta pagar</option>
                            <option value="lancar">Lançar como pagas (entra no histórico)</option>
                          </select>
                        </Field>
                      )}
                    </div>
                    {/* O vencimento é sempre o da 1ª parcela: é dele que sai o
                        calendário inteiro. Como isso não é óbvio numa dívida que
                        já vinha correndo, a prévia diz as duas datas. */}
                    <p className="text-xs text-slate-500 leading-relaxed">
                      {(() => {
                        const n = Math.max(2, Math.min(360, Number(repeticao.vezes) || 2))
                        const pagas = Math.min(Math.max(0, Number(repeticao.jaPagas) || 0), n - 1)
                        const valor = Number(form.valor || 0)
                        const cada = repeticao.dividir ? valor / n : valor
                        const total = repeticao.dividir ? valor : valor * n
                        const linhas = [
                          `${n}× de ${formatBRL(cada)} = ${formatBRL(total)}.`,
                          `A 1ª parcela vence em ${formatData(form.vencimento)} e a ${n}ª em ${formatData(somarMeses(form.vencimento, n - 1))}.`,
                        ]
                        if (pagas > 0) {
                          linhas.push(
                            `Em aberto: da ${pagas + 1}ª à ${n}ª (${n - pagas} lançamentos, ${formatBRL(cada * (n - pagas))}), a partir de ${formatData(somarMeses(form.vencimento, pagas))}.`,
                            repeticao.lancarPagas
                              ? `As ${pagas} já pagas entram como realizadas, cada uma no mês em que venceu.`
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
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => { setForm(null); setRepeticao(REPETICAO_VAZIA) }}>Cancelar</Button>
              <Button type="submit">Salvar</Button>
            </div>
          </form>
        )}
      </Modal>
    </Page>
  )
}
