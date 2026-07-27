import { Link } from 'react-router-dom'
import {
  clientes, produtos,
  formatData, formatBRL, TIPOS_AGENDAMENTO, FORMAS_PAGAMENTO,
} from '../data/repository.js'
import { Modal, Button, Badge } from './ui.jsx'
import { IconUser } from './icons.jsx'

const STATUS_BADGE = {
  agendado: ['sky', 'Agendado'],
  concluido: ['green', 'Concluído'],
  cancelado: ['red', 'Cancelado'],
}

// Linha rótulo → valor, no estilo flat do sistema.
function Linha({ rotulo, children }) {
  return (
    <div className="py-2.5 flex items-start justify-between gap-4 border-b border-slate-100 last:border-0">
      <dt className="text-xs text-slate-500 shrink-0 pt-0.5">{rotulo}</dt>
      <dd className="text-sm text-slate-900 text-right">{children}</dd>
    </div>
  )
}

// Pop-up somente leitura com os dados de um agendamento. Reutilizado na página
// de Agendamentos e no perfil do cliente. Passe `onEditar` para exibir o atalho
// de edição (só faz sentido onde existe o formulário de agendamento).
export default function AgendamentoDetalheModal({ agendamento, onClose, onEditar }) {
  if (!agendamento) return null
  const a = agendamento
  const cliente = clientes.get(a.clienteId)
  const [cor, rotulo] = STATUS_BADGE[a.status] ?? ['slate', a.status]

  const idsProdutos = a.produtoIds?.length ? a.produtoIds : (a.produtoId ? [a.produtoId] : [])
  const nomesProdutos = idsProdutos.map((id) => produtos.get(id)?.nome).filter(Boolean).join(', ')

  const temValor = Number(a.valor) > 0

  return (
    <Modal title="Detalhes do agendamento" open onClose={onClose}>
      <div className="space-y-5">
        <dl>
          <Linha rotulo="Cliente">
            {cliente ? (
              <Link to={`/clientes/${a.clienteId}`} className="font-medium text-blue-600 hover:underline inline-flex items-center gap-1">
                <IconUser size={14} /> {cliente.nome}
              </Link>
            ) : (
              <span className="text-slate-400">(cliente removido)</span>
            )}
          </Linha>
          <Linha rotulo="Data">{formatData(a.data)}</Linha>
          <Linha rotulo="Tipo de serviço">{TIPOS_AGENDAMENTO[a.tipo] ?? a.tipo}</Linha>
          <Linha rotulo="Status">
            <Badge color={cor}>{rotulo}</Badge>
          </Linha>
          <Linha rotulo="Produtos / serviços">
            {nomesProdutos || <span className="text-slate-400">Sem produto</span>}
          </Linha>
          <Linha rotulo="Valor">
            {temValor ? formatBRL(a.valor) : <span className="text-slate-400">—</span>}
          </Linha>
          {temValor && (
            <>
              <Linha rotulo="Pagamento">
                {FORMAS_PAGAMENTO[a.formaPagamento] ?? a.formaPagamento}
                {Number(a.parcelas) > 1 ? ` · ${a.parcelas}x` : ''}
              </Linha>
              <Linha rotulo="Situação do pagamento">
                {a.status !== 'cancelado' ? (
                  <Badge color={a.statusPagamento === 'pago' ? 'green' : 'amber'}>
                    {a.statusPagamento === 'pago' ? 'Pago' : 'A receber'}
                  </Badge>
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </Linha>
            </>
          )}
          {a.osNumero && (
            <Linha rotulo="Ordem de serviço">
              <Badge color="slate">OS Nº {a.osNumero}</Badge>
            </Linha>
          )}
          <Linha rotulo="Observações">
            {a.observacoes || <span className="text-slate-400">—</span>}
          </Linha>
        </dl>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Fechar</Button>
          {onEditar && (
            <Button onClick={() => onEditar(a)}>Editar</Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
