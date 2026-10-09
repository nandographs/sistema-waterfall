import { useState } from 'react'
import {
  agendamentos, clientes, produtos, salvarAgendamento, editarEReagendar,
  formatData, formatBRL, TIPOS_AGENDAMENTO, FORMAS_PAGAMENTO,
} from '../data/repository.js'
import { formatHora } from '../lib/datas.js'
import { Button, Field, inputCls, InputNumero, Modal, notificar } from './ui.jsx'
import ClienteBusca from './ClienteBusca.jsx'
import ProdutoBusca from './ProdutoBusca.jsx'
import { CampoTaxa, aoMudarForma } from './PagamentosVenda.jsx'

const FORM_VAZIO = {
  clienteId: '', data: '', hora: '', tipo: 'visita', observacoes: '', status: 'agendado',
  produtoIds: [], produtoQuantidades: {},
  valor: '', formaPagamento: 'pix', parcelas: 1, statusPagamento: 'pendente',
  lancarFinanceiro: true,
}

// As duas leituras de "troquei a data". Uma é conserto de digitação — o serviço
// só muda de dia. A outra é o cliente que não pôde receber, e essa precisa
// deixar o dia original na agenda, encerrado como reagendado, senão a terceira
// vez que ele adia some da história (ver reagendarAgendamento).
const MUDANCAS_DE_DATA = [
  {
    valor: 'reagendamento',
    rotulo: 'Reagendamento',
    descricao: (dia) => `O cliente não pôde. O dia ${dia} fica registrado como reagendado.`,
  },
  {
    valor: 'correcao',
    rotulo: 'Só corrigir a data',
    descricao: () => 'A data estava errada. O serviço muda de dia sem deixar rastro.',
  },
]

// Criar ou editar um agendamento. Mora fora da página de Serviços porque o
// perfil do cliente edita o mesmo serviço — e as duas telas precisam fazer a
// mesma pergunta quando a data muda.
export default function AgendamentoFormModal({ agendamento, onFechar, onSalvo }) {
  const [form, setForm] = useState(() => ({ ...FORM_VAZIO, ...agendamento }))
  const [mudancaDeData, setMudancaDeData] = useState('')
  const [motivo, setMotivo] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  const listaClientes = clientes.list()
  const listaProdutos = produtos.list()

  // A pergunta só existe para um serviço que já estava marcado e cuja DATA
  // mudou. Mudar só o horário no mesmo dia é ajuste, não reagendamento.
  const original = form.id ? agendamentos.get(form.id) : null
  const dataMudou = !!original && original.status === 'agendado' && !!form.data && form.data !== original.data

  // Sem try/catch, uma recusa do banco (coluna faltando, RLS, rede) rejeitava a
  // promise em silêncio: o modal ficava aberto, nada era gravado e o Salvar
  // parecia não ter sido clicado. O erro aparece dentro do próprio modal, onde
  // a pessoa está olhando — mesmo padrão do formulário de venda.
  async function salvar(e) {
    e.preventDefault()
    setErro('')
    if (dataMudou && !mudancaDeData) {
      return setErro('A data mudou: diga se é um reagendamento ou só uma correção.')
    }
    setSalvando(true)
    try {
      let salvo
      if (dataMudou && mudancaDeData === 'reagendamento') {
        salvo = await editarEReagendar(form, motivo.trim())
        notificar(`Reagendado para ${formatData(form.data)}.`)
      } else {
        salvo = await salvarAgendamento(form)
        notificar(form.id ? 'Agendamento atualizado.' : 'Agendamento salvo.')
      }
      onSalvo?.(salvo)
    } catch (ex) {
      setErro(ex?.message || String(ex))
    } finally {
      setSalvando(false)
    }
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  // Ausente ou inválida = 1: é assim que se comporta todo serviço anterior à
  // migração 025, que não tinha quantidade nenhuma.
  const quantidadeDe = (quantidades, id) => {
    const n = Number(quantidades?.[id])
    return Number.isFinite(n) && n > 0 ? n : 1
  }

  // O valor do serviço é a tabela dos produtos escolhidos VEZES a quantidade de
  // cada um — quatro refis custam quatro refis. Continua editável à mão depois.
  const somaDosProdutos = (ids, quantidades) =>
    ids.reduce((s, pid) => s + Number(produtos.get(pid)?.valor || 0) * quantidadeDe(quantidades, pid), 0)

  // Marca/desmarca um produto do serviço e recalcula o valor.
  function alternarProduto(id) {
    const atuais = Array.isArray(form.produtoIds) ? form.produtoIds : []
    const novos = atuais.includes(id) ? atuais.filter((x) => x !== id) : [...atuais, id]
    const quantidades = { ...form.produtoQuantidades }
    if (novos.includes(id)) quantidades[id] = quantidades[id] || 1
    else delete quantidades[id]
    setForm({
      ...form,
      produtoIds: novos,
      produtoQuantidades: quantidades,
      valor: somaDosProdutos(novos, quantidades) || '',
    })
  }

  // Trocar a quantidade refaz o valor pela mesma conta. O campo pode ficar
  // vazio enquanto se digita — aí vale 1, e o valor acompanha.
  function mudarQuantidade(id, valorDigitado) {
    const quantidades = { ...form.produtoQuantidades, [id]: valorDigitado }
    setForm({
      ...form,
      produtoQuantidades: quantidades,
      valor: somaDosProdutos(form.produtoIds || [], quantidades) || '',
    })
  }

  return (
    <Modal title={form.id ? 'Editar agendamento' : 'Novo agendamento'} open onClose={onFechar}>
      <form onSubmit={salvar} className="space-y-4">
        <Field label="Cliente">
          <ClienteBusca
            clientes={listaClientes}
            value={form.clienteId}
            onChange={(id) => setForm({ ...form, clienteId: id })}
            required
          />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Data">
            <input className={inputCls} type="date" required value={form.data} onChange={set('data')} />
          </Field>
          <Field label="Hora">
            <input className={inputCls} type="time" value={form.hora} onChange={set('hora')} />
          </Field>
          <Field label="Tipo de serviço">
            <select className={inputCls} value={form.tipo} onChange={set('tipo')}>
              {Object.entries(TIPOS_AGENDAMENTO).map(([v, r]) => (
                <option key={v} value={v}>{r}</option>
              ))}
            </select>
          </Field>
        </div>

        {dataMudou && (
          <fieldset className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
            <legend className="sr-only">Por que a data mudou</legend>
            <p className="text-[13px] font-semibold text-slate-700">
              Estava marcado para {formatData(original.data)}
              {formatHora(original.hora) && ` · ${formatHora(original.hora)}`}. O que aconteceu?
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {MUDANCAS_DE_DATA.map((op) => {
                const ativo = mudancaDeData === op.valor
                return (
                  <label
                    key={op.valor}
                    className={`flex items-start gap-2.5 cursor-pointer rounded-lg bg-white border p-3 ${
                      ativo ? 'border-blue-600' : 'border-slate-200'
                    }`}
                  >
                    <input
                      type="radio"
                      name="mudancaDeData"
                      className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600 cursor-pointer"
                      checked={ativo}
                      onChange={() => { setMudancaDeData(op.valor); setErro('') }}
                    />
                    <span>
                      <span className="block text-[13px] font-medium text-slate-900">{op.rotulo}</span>
                      <span className="block text-xs text-slate-500 mt-0.5">{op.descricao(formatData(original.data))}</span>
                    </span>
                  </label>
                )
              })}
            </div>
            {mudancaDeData === 'reagendamento' && (
              <Field label="Motivo (opcional)">
                <input
                  className={inputCls}
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Ex.: cliente pediu para adiar"
                />
              </Field>
            )}
          </fieldset>
        )}

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-4">
          <p className="text-[13px] font-semibold text-slate-700">Financeiro do serviço</p>
          <Field label="Produtos / serviços">
            {listaProdutos.length === 0 ? (
              <p className="text-xs text-slate-400">Nenhum produto cadastrado.</p>
            ) : (
              <>
                <ProdutoBusca
                  produtos={listaProdutos}
                  onChange={alternarProduto}
                  ocultarIds={form.produtoIds || []}
                  limparAoSelecionar
                  placeholder="Busque por nome ou código e tecle Enter…"
                />
                {(form.produtoIds || []).length > 0 && (
                  <ul className="mt-2 rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
                    {(form.produtoIds || []).map((id) => {
                      const p = produtos.get(id)
                      const quantidade = quantidadeDe(form.produtoQuantidades, id)
                      return (
                        <li key={id} className="flex items-center gap-2.5 px-3 py-2">
                          {p?.codigo && (
                            <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500 tnum">
                              {p.codigo}
                            </span>
                          )}
                          <span className="text-sm text-slate-700 flex-1 truncate">
                            {p?.nome ?? '(produto removido)'}
                          </span>
                          {/* Quatro refis na mesma visita são UMA linha com
                              quantidade 4 — é ela que a Ordem de Serviço
                              cobra e que a instalação dá baixa.
                              A largura mora no wrapper: inputCls já traz
                              w-full, e entre duas classes de mesma
                              especificidade quem manda é a ordem do CSS. */}
                          <div className="w-14 shrink-0">
                            <InputNumero
                              className={`${inputCls} px-2 py-1.5 text-sm text-center`}
                              min="1"
                              step="1"
                              value={form.produtoQuantidades?.[id] ?? 1}
                              onChange={(e) => mudarQuantidade(id, e.target.value)}
                              aria-label={`Quantidade de ${p?.nome ?? 'produto'}`}
                            />
                          </div>
                          <span className="text-xs text-slate-400 tnum w-20 text-right">
                            {formatBRL(Number(p?.valor || 0) * quantidade)}
                          </span>
                          <button
                            type="button"
                            onClick={() => alternarProduto(id)}
                            className="text-red-500 hover:text-red-600 text-lg leading-none cursor-pointer px-1"
                            title="Remover produto"
                            aria-label={`Remover ${p?.nome ?? 'produto'}`}
                          >
                            ×
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </>
            )}
            <p className="text-xs text-slate-400 mt-1">
              Deixe a lista vazia para uma visita sem produto.
            </p>
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Valor do serviço (R$)">
              <InputNumero
                className={inputCls}
                step="0.01"
                min="0"
                placeholder="0,00"
                value={form.valor}
                onChange={set('valor')}
              />
            </Field>
            <Field label="Parcelas">
              <InputNumero className={inputCls} min="1" step="1" value={form.parcelas} onChange={set('parcelas')} />
            </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Forma de pagamento">
              <select
                className={inputCls}
                value={form.formaPagamento}
                onChange={(e) => {
                  const { forma, taxa } = aoMudarForma(e.target.value, { taxa: form.taxaCartao || '' })
                  setForm({ ...form, formaPagamento: forma, ...(taxa !== undefined ? { taxaCartao: taxa } : {}) })
                }}
              >
                {Object.entries(FORMAS_PAGAMENTO).map(([v, r]) => (
                  <option key={v} value={v}>{r}</option>
                ))}
              </select>
            </Field>
            <Field label="Situação do pagamento">
              <select className={inputCls} value={form.statusPagamento} onChange={set('statusPagamento')}>
                <option value="pendente">A receber</option>
                <option value="pago">Pago</option>
              </select>
            </Field>
          </div>
          {form.formaPagamento === 'cartao' && Number(form.valor) > 0 && (
            <CampoTaxa
              pagamento={{ forma: 'cartao', taxa: form.taxaCartao || '', parcelas: form.parcelas }}
              valorResolvido={form.valor}
              onChange={({ taxa }) => setForm({ ...form, taxaCartao: taxa })}
            />
          )}
          {/* Só aparece quando há valor: sem cobrança, não há o que lançar
              e a pergunta seria ruído. */}
          {Number(form.valor) > 0 && (
            <label className="flex items-start gap-2.5 cursor-pointer rounded-lg bg-white border border-slate-200 p-3">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600 cursor-pointer"
                checked={form.lancarFinanceiro !== false}
                onChange={(e) => setForm({ ...form, lancarFinanceiro: e.target.checked })}
              />
              <span>
                <span className="block text-[13px] font-medium text-slate-700">
                  Lançar no financeiro
                </span>
                <span className="block text-xs text-slate-400 mt-0.5">
                  {form.lancarFinanceiro === false
                    ? 'Este serviço não gera parcelas a receber. Use para cortesia, garantia ou acerto por fora.'
                    : `Gera ${Math.max(1, Number(form.parcelas) || 1)} parcela${Math.max(1, Number(form.parcelas) || 1) > 1 ? 's' : ''} a receber, somando ${formatBRL(form.valor)}.`}
                </span>
              </span>
            </label>
          )}

          <p className="text-xs text-slate-400">
            Deixe o valor em branco para agendamentos sem cobrança.
          </p>
        </div>

        <Field label="Observações">
          <textarea className={inputCls} rows="2" value={form.observacoes} onChange={set('observacoes')} />
        </Field>
        {erro && (
          <p role="alert" aria-live="polite" className="text-sm text-red-600 bg-slate-100 border border-slate-200 rounded-xl px-3 py-2">{erro}</p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onFechar} disabled={salvando}>Cancelar</Button>
          <Button type="submit" disabled={salvando}>
            {salvando ? 'Salvando…' : dataMudou && mudancaDeData === 'reagendamento' ? 'Reagendar' : 'Salvar'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
