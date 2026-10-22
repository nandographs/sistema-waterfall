import { useState } from 'react'
import {
  clientes, itensDaVenda, lancamentosDaVenda, salvarVenda, resolverPagamentos,
  formatBRL, hojeISO, quantidadeComUnidade,
} from '../data/repository.js'
import { Modal, Button, Field, inputCls, notificar } from './ui.jsx'
import { IconCheck } from './icons.jsx'
import PagamentosVenda, { pagamentosIniciais } from './PagamentosVenda.jsx'

// Fecha uma proposta: ela vira venda confirmada, com financeiro e agenda.
//
// Existe porque confirmar era só trocar o status — e a proposta não sabe como o
// cliente vai pagar. O orçamento nem pergunta (ver OrcamentoModal) e nasce com
// `lancarFinanceiro: false`; confirmado assim, virava venda sem conta a receber
// nenhuma. Aqui a pergunta que falta é feita no único momento em que ela tem
// resposta: na hora do "fechou".
//
// Produtos e preços NÃO se editam aqui de propósito: quem precisa mudar o que
// foi proposto edita a proposta. Este passo só responde "quando" e "como paga".
export default function ConfirmarVendaModal({ venda, onClose, onConfirmada }) {
  const itens = itensDaVenda(venda.id)
  const total = Number(venda.total || 0)
  const cliente = clientes.get(venda.clienteId)

  // A venda é de hoje, não do dia em que a proposta foi mandada: é daqui que
  // contam a entrada e os vencimentos.
  const [data, setData] = useState(hojeISO())
  const [entregaPrevisao, setEntregaPrevisao] = useState(venda.entregaPrevisao || '')
  const [pagamentos, setPagamentos] = useState(() => pagamentosIniciais(venda, total))
  // Proposta (sobretudo o orçamento) costuma vir com o financeiro desligado só
  // porque ainda não era venda. Confirmar é justamente o momento de ligar.
  const [lancarFinanceiro, setLancarFinanceiro] = useState(true)
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)

  async function confirmar(e) {
    e.preventDefault()
    setErro('')
    setSalvando(true)
    try {
      await salvarVenda(
        {
          ...venda,
          // Orçamento confirmado deixa de ser orçamento: é venda.
          tipo: 'venda',
          status: 'confirmada',
          data,
          entregaPrevisao,
          lancarFinanceiro,
          pagamentos: resolverPagamentos(pagamentos, total),
        },
        itens,
      )
      notificar(
        lancarFinanceiro
          ? 'Venda confirmada. Contas a receber e agenda foram atualizadas.'
          : 'Venda confirmada, sem lançar no financeiro.',
      )
      onConfirmada?.()
      onClose()
    } catch (ex) {
      setErro(ex?.message || String(ex))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal title="Confirmar venda" open onClose={onClose} size="wide">
      <form onSubmit={confirmar} className="space-y-5 pb-20 sm:pb-0">
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-sm font-semibold text-slate-900">{cliente?.nome ?? '(cliente removido)'}</p>
          {itens.length > 0 ? (
            <ul className="mt-2 space-y-1 text-sm">
              {itens.map((i) => (
                <li key={i.id} className="flex justify-between gap-3">
                  <span className="text-slate-700">
                    {i.descricao}{' '}
                    <span className="text-slate-400">× {quantidadeComUnidade(i.quantidade, i.unidade)}</span>
                  </span>
                  <span className="tnum text-slate-900">{formatBRL(i.valorTotal)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-amber-600">
              Esta proposta não tem produtos. Edite a proposta e inclua o que foi vendido antes de confirmar.
            </p>
          )}
          <p className="mt-2 pt-2 border-t border-slate-200 flex justify-between text-sm font-semibold text-slate-900">
            <span>Total</span>
            <span className="tnum">{formatBRL(total)}</span>
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Data da venda">
            <input className={inputCls} type="date" required value={data} onChange={(e) => setData(e.target.value)} />
          </Field>
          <Field label="Previsão de entrega / instalação">
            <input
              className={inputCls} type="date"
              value={entregaPrevisao}
              onChange={(e) => setEntregaPrevisao(e.target.value)}
            />
          </Field>
        </div>

        <div className="rounded-lg border border-slate-200 p-4 space-y-3">
          <p className="text-[13px] font-semibold text-slate-700">Pagamento</p>
          <PagamentosVenda
            pagamentos={pagamentos}
            onChange={setPagamentos}
            total={total}
            antecipacaoTravada={lancamentosDaVenda(venda.id).some((l) => l.status === 'realizado')}
          />
          <label className="flex items-start gap-2.5 cursor-pointer rounded-lg bg-slate-100 border border-slate-200 p-3">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600 cursor-pointer"
              checked={lancarFinanceiro}
              onChange={(e) => setLancarFinanceiro(e.target.checked)}
            />
            <span>
              <span className="block text-[13px] font-medium text-slate-700">Lançar no financeiro</span>
              <span className="block text-xs text-slate-400 mt-0.5">
                {lancarFinanceiro
                  ? 'Cada parcela vira uma conta a receber com a forma e o vencimento dela.'
                  : 'Esta venda não gera contas a receber.'}
              </span>
            </span>
          </label>
        </div>

        <p className="text-xs text-slate-500">
          A instalação (se houver aparelho) ou a troca de refil entra na agenda na data da
          previsão — ou na data da venda, se a previsão ficar em branco.
        </p>

        {erro && (
          <p role="alert" aria-live="polite" className="text-sm text-red-600 bg-slate-100 border border-slate-200 rounded-xl px-3 py-2">{erro}</p>
        )}

        <div className="sticky bottom-0 z-10 -mx-4 sm:-mx-6 flex flex-wrap items-center justify-end gap-2 border-t border-slate-300 bg-slate-100/95 px-4 sm:px-6 py-3 backdrop-blur-md">
          <Button type="button" variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button type="submit" disabled={salvando || itens.length === 0}>
            <IconCheck size={16} /> {salvando ? 'Confirmando…' : 'Confirmar venda'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
