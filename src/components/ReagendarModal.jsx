import { useState } from 'react'
import { clientes, reagendarAgendamento, formatData, TIPOS_AGENDAMENTO } from '../data/repository.js'
import { somarDias, formatHora } from '../lib/datas.js'
import { Modal, Button, Field, inputCls, notificar } from '../components/ui.jsx'

// Reagendar um serviço.
//
// A diferença para "remarcar" está toda na frase do topo, e ela é o motivo do
// pop-up existir: o dia original NÃO some. Ele fica lá, encerrado como
// reagendado, e o serviço novo nasce na data combinada. Três semanas depois,
// quando alguém perguntar quantas vezes aquele cliente adiou, a agenda tem a
// resposta — coisa que mover o registro de lugar apagava.
export default function ReagendarModal({ agendamento, onFechar, onReagendado }) {
  const a = agendamento
  const [data, setData] = useState(() => somarDias(a?.data || '', 1))
  const [hora, setHora] = useState(a?.hora || '')
  const [motivo, setMotivo] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  if (!a) return null

  const cliente = clientes.get(a.clienteId)
  const servico = TIPOS_AGENDAMENTO[a.tipo] ?? a.tipo

  async function salvar(e) {
    e.preventDefault()
    setErro('')
    if (!data) return setErro('Escolha a nova data.')
    if (data === a.data) {
      return setErro('A nova data é a mesma de hoje. Para trocar só o horário, use Editar.')
    }
    setSalvando(true)
    try {
      const novo = await reagendarAgendamento(a.id, { data, hora, motivo })
      notificar(`Reagendado para ${formatData(data)}.`)
      onReagendado?.(novo)
    } catch (e) {
      setErro(e?.message || String(e))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal title="Reagendar serviço" open onClose={onFechar}>
      <form onSubmit={salvar} className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
          <p className="text-sm font-medium text-slate-900">
            {servico}
            {cliente && <span className="font-normal text-slate-500"> · {cliente.nome}</span>}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Hoje marcado para {formatData(a.data)}
            {formatHora(a.hora) && ` · ${formatHora(a.hora)}`}
          </p>
        </div>

        <p className="text-[13px] text-slate-600">
          O dia {formatData(a.data)} fica registrado como <strong className="font-medium text-slate-900">reagendado</strong>,
          e um serviço novo é criado na data escolhida. A cobrança vai junto: as parcelas passam a
          vencer pela data nova, e o que já foi recebido continua recebido.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Nova data">
            <input className={inputCls} type="date" value={data} onChange={(e) => setData(e.target.value)} required />
          </Field>
          <Field label="Horário">
            <input className={inputCls} type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
          </Field>
        </div>

        <Field label="Motivo (opcional)">
          <input
            className={inputCls}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ex.: cliente pediu para adiar"
          />
        </Field>

        {erro && <p className="text-sm text-red-600">{erro}</p>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onFechar}>Cancelar</Button>
          <Button type="submit" disabled={salvando}>
            {salvando ? 'Reagendando…' : 'Reagendar'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
