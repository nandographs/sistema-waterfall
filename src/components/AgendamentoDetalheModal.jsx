import { Link } from 'react-router-dom'
import {
  clientes, produtos, autorDoAgendamento, reagendamentoDe, agendamentoEncerrado,
  badgeDoAgendamento, formatData, formatBRL, TIPOS_AGENDAMENTO, FORMAS_PAGAMENTO,
} from '../data/repository.js'
import { formatHora } from '../lib/datas.js'
import { Modal, Button, Badge } from './ui.jsx'
import { IconUser, IconPlus, IconCalendar } from './icons.jsx'
import TrilhaOrigem from './TrilhaOrigem.jsx'

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
// de Serviços, na agenda e no perfil do cliente. Passe `onEditar` para exibir o
// atalho de edição (só faz sentido onde existe o formulário de agendamento) e
// `onCriarTarefa` para o atalho de lembrete (ex.: "confirmar na véspera") e
// `onReagendar` para mover o serviço de dia guardando o rastro do dia original.
export default function AgendamentoDetalheModal({ agendamento, onClose, onEditar, onCriarTarefa, onReagendar }) {
  if (!agendamento) return null
  const a = agendamento
  const cliente = clientes.get(a.clienteId)
  const [cor, rotulo] = badgeDoAgendamento(a)

  const idsProdutos = a.produtoIds?.length ? a.produtoIds : (a.produtoId ? [a.produtoId] : [])
  const nomesProdutos = idsProdutos.map((id) => produtos.get(id)?.nome).filter(Boolean).join(', ')

  const temValor = Number(a.valor) > 0
  const autor = autorDoAgendamento(a)
  const reag = reagendamentoDe(a)
  const podeReagendar = !!onReagendar && a.status === 'agendado'

  return (
    <Modal title="Detalhes do agendamento" open onClose={onClose}>
      <div className="space-y-5">
        <TrilhaOrigem registro={a} />

        {/* Os dois lados do reagendamento. É esta faixa que transforma dois
            registros soltos numa história: de onde o serviço veio, para onde
            foi, e por quê. */}
        {reag && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 space-y-1">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <IconCalendar size={13} /> Reagendamento
            </p>
            {reag.anterior && (
              <p className="text-[13px] text-slate-700">
                Veio do dia {formatData(reag.anterior.data)}.
              </p>
            )}
            {reag.seguinte && (
              <p className="text-[13px] text-slate-700">
                Foi para o dia {formatData(reag.seguinte.data)}
                {reag.seguinte.status === 'cancelado' && <span className="text-slate-500"> (e lá foi cancelado)</span>}.
              </p>
            )}
            {reag.motivo && <p className="text-[13px] text-slate-500">“{reag.motivo}”</p>}
          </div>
        )}

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
          <Linha rotulo="Data">
            {formatData(a.data)}
            {formatHora(a.hora) && <span className="text-slate-500"> · {formatHora(a.hora)}</span>}
          </Linha>
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
                {!agendamentoEncerrado(a) ? (
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
          <Linha rotulo="Agendado por">
            {!autor && <span className="text-slate-400">Não registrado</span>}
            {autor?.automatico && (
              <span className="inline-flex flex-col items-end gap-0.5">
                <Badge color="slate">Automático</Badge>
                {autor.usuario && (
                  <span className="text-xs text-slate-500">a partir de uma ação de {autor.usuario}</span>
                )}
              </span>
            )}
            {autor && !autor.automatico && autor.usuario}
          </Linha>
        </dl>

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Fechar</Button>
          {onCriarTarefa && (
            <Button variant="ghost" onClick={() => onCriarTarefa(a)}>
              <IconPlus size={15} /> Criar tarefa
            </Button>
          )}
          {podeReagendar && (
            <Button variant="secondary" onClick={() => onReagendar(a)}>
              <IconCalendar size={15} /> Reagendar
            </Button>
          )}
          {onEditar && (
            <Button onClick={() => onEditar(a)}>Editar</Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
