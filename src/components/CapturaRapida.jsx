import { useState } from 'react'
import {
  clientes, salvarAtividade, TIPOS_ATIVIDADE, RESULTADOS_ATIVIDADE,
} from '../data/repository.js'
import { hojeISO, somarDias } from '../lib/datas.js'
import { Button, inputCls } from './ui.jsx'
import { IconeDoEvento } from './evento.jsx'
import ClienteBusca from './ClienteBusca.jsx'

// Os tipos que valem um atalho: o resto vive no formulário completo.
const ATALHOS = ['ligacao', 'whatsapp', 'visita', 'tarefa']

const VAZIO = { tipo: 'ligacao', clienteId: '', descricao: '', resultado: 'sucesso' }

// Registro em um gesto: o que acabou de acontecer e o que fica marcado por
// causa disso.
//
// Este componente é a razão de o sistema ser usado ou não. Se registrar uma
// ligação custar três cliques e uma navegação, ninguém registra — e sem
// registro a agenda vira uma tela bonita e vazia. Por isso ele fica na home,
// já aberto, com o dia de hoje implícito.
export default function CapturaRapida({ onRegistrado }) {
  const [form, setForm] = useState(VAZIO)
  const [retorno, setRetorno] = useState({ data: '', hora: '' })
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)

  const vaiRetornar = form.resultado === 'retornar'

  function escolherResultado(resultado) {
    setForm({ ...form, resultado })
    if (resultado === 'retornar' && !retorno.data) {
      setRetorno({ data: somarDias(hojeISO(), 7), hora: '' })
    }
  }

  async function registrar(e) {
    e.preventDefault()
    setErro('')
    setSalvando(true)
    try {
      await salvarAtividade(
        {
          ...form,
          data: hojeISO(),
          hora: '',
          titulo: '',
          status: 'concluida',
        },
        vaiRetornar ? retorno : null,
      )
      setForm(VAZIO)
      setRetorno({ data: '', hora: '' })
      onRegistrado?.()
    } catch (problema) {
      setErro(problema?.message || String(problema))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <form onSubmit={registrar} className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {ATALHOS.map((tipo) => (
          <button
            key={tipo}
            type="button"
            onClick={() => setForm({ ...form, tipo })}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px] font-medium cursor-pointer ${
              form.tipo === tipo
                ? 'border-blue-600 bg-blue-50 text-blue-700'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            <IconeDoEvento evento={{ fonte: 'atividade', tipo }} size={14} />
            {TIPOS_ATIVIDADE[tipo]}
          </button>
        ))}
      </div>

      <ClienteBusca
        clientes={clientes.list()}
        value={form.clienteId}
        onChange={(id) => setForm({ ...form, clienteId: id })}
        placeholder="Cliente (opcional)…"
      />

      <textarea
        className={inputCls}
        rows="2"
        value={form.descricao}
        onChange={(e) => setForm({ ...form, descricao: e.target.value })}
        placeholder="O que aconteceu? Ex.: pediu para ligar semana que vem."
      />

      <div className="flex flex-wrap gap-1.5">
        {Object.entries(RESULTADOS_ATIVIDADE).map(([valor, rotulo]) => (
          <button
            key={valor}
            type="button"
            onClick={() => escolherResultado(valor)}
            className={`rounded-lg border px-2.5 py-1 text-xs font-medium cursor-pointer ${
              form.resultado === valor
                ? 'border-blue-600 bg-blue-50 text-blue-700'
                : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
            }`}
          >
            {rotulo}
          </button>
        ))}
      </div>

      {vaiRetornar && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium text-amber-900">Retornar em</span>
          <input
            className="rounded-lg border border-amber-300 px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:border-amber-500"
            type="date"
            required
            value={retorno.data}
            onChange={(e) => setRetorno({ ...retorno, data: e.target.value })}
          />
          <input
            className="rounded-lg border border-amber-300 px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:border-amber-500"
            type="time"
            value={retorno.hora}
            onChange={(e) => setRetorno({ ...retorno, hora: e.target.value })}
          />
        </div>
      )}

      {erro && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>
      )}

      <Button type="submit" disabled={salvando} className="w-full justify-center">
        {salvando ? 'Registrando…' : (vaiRetornar ? 'Registrar e agendar retorno' : 'Registrar')}
      </Button>
    </form>
  )
}
