import { useState } from 'react'
import {
  clientes, salvarAtividade,
  TIPOS_ATIVIDADE, RESULTADOS_ATIVIDADE, TIPOS_SEM_PENDENCIA,
} from '../data/repository.js'
import { hojeISO, somarDias } from '../lib/datas.js'
import { Modal, Button, Field, inputCls } from './ui.jsx'
import { IconeDoEvento } from './evento.jsx'
import TrilhaOrigem, { Desdobramentos } from './TrilhaOrigem.jsx'
import ClienteBusca from './ClienteBusca.jsx'

export const ATIVIDADE_VAZIA = {
  tipo: 'ligacao',
  data: '',
  hora: '',
  titulo: '',
  descricao: '',
  status: 'pendente',
  resultado: '',
  clienteId: '',
  origemAtividadeId: '',
}

export function atividadeNova(extra = {}) {
  return { ...ATIVIDADE_VAZIA, data: hojeISO(), ...extra }
}

// Botões de tipo: mais rápido que um <select> e deixa as opções visíveis, que é
// o que importa num formulário usado dezenas de vezes por dia.
function EscolhaTipo({ valor, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {Object.entries(TIPOS_ATIVIDADE).map(([tipo, rotulo]) => (
        <button
          key={tipo}
          type="button"
          onClick={() => onChange(tipo)}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px] font-medium cursor-pointer ${
            valor === tipo
              ? 'border-blue-600 bg-blue-50 text-blue-700'
              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          <IconeDoEvento evento={{ fonte: 'atividade', tipo }} size={14} />
          {rotulo}
        </button>
      ))}
    </div>
  )
}

// O bloco de desfecho: como terminou e, se ficou de retornar, quando.
//
// Escolher "Retornar depois" abre o campo de data já preenchido com uma semana
// à frente e obrigatório. É a regra do próximo passo — a camada de dados também
// a impõe (ver salvarAtividade), aqui ela só aparece antes do erro.
function Desfecho({ form, setForm, retorno, setRetorno }) {
  function escolherResultado(resultado) {
    setForm({ ...form, resultado })
    if (resultado === 'retornar' && !retorno.data) {
      setRetorno({ ...retorno, data: somarDias(form.data || hojeISO(), 7) })
    }
  }

  return (
    <div className="space-y-4">
      <Field label="Como terminou">
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(RESULTADOS_ATIVIDADE).map(([valor, rotulo]) => (
            <button
              key={valor}
              type="button"
              onClick={() => escolherResultado(valor)}
              className={`rounded-lg border px-2.5 py-1.5 text-[13px] font-medium cursor-pointer ${
                form.resultado === valor
                  ? 'border-blue-600 bg-blue-50 text-blue-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {rotulo}
            </button>
          ))}
        </div>
      </Field>

      {form.resultado === 'retornar' && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3">
          <p className="text-[13px] font-semibold text-amber-900">Quando você volta nesse contato?</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Data do retorno">
              <input
                className={inputCls}
                type="date"
                required
                value={retorno.data}
                onChange={(e) => setRetorno({ ...retorno, data: e.target.value })}
              />
            </Field>
            <Field label="Hora (opcional)">
              <input
                className={inputCls}
                type="time"
                value={retorno.hora}
                onChange={(e) => setRetorno({ ...retorno, hora: e.target.value })}
              />
            </Field>
          </div>
          <p className="text-xs text-amber-800">
            Uma tarefa de retorno será criada nesse dia, ligada a esta conversa — ao abri-la
            você já vê o que foi falado aqui.
          </p>
        </div>
      )}
    </div>
  )
}

// Formulário de atividade. Dois modos:
//   'edicao'    — criar ou editar (mostra tipo, cliente, data, hora…)
//   'conclusao' — registrar o desfecho de uma tarefa que já existe
export default function AtividadeModal({ atividade, modo = 'edicao', onFechar, onSalvo }) {
  const [form, setForm] = useState(() => {
    const base = { ...ATIVIDADE_VAZIA, ...atividade }
    if (modo === 'conclusao') return { ...base, status: 'concluida', resultado: base.resultado || 'sucesso' }
    if (base.tipo === 'nota') return { ...base, status: 'concluida' }
    return base
  })
  const [retorno, setRetorno] = useState({ data: '', hora: '' })
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)

  const ehEdicao = modo === 'edicao'
  const semPendencia = TIPOS_SEM_PENDENCIA.includes(form.tipo)
  const vaiRetornar = form.status === 'concluida' && form.resultado === 'retornar'

  const set = (campo) => (e) => setForm({ ...form, [campo]: e.target.value })

  // Trocar para "Anotação" força concluída: uma anotação registra algo que já
  // aconteceu, não é uma tarefa esperando por você.
  function escolherTipo(tipo) {
    setForm({
      ...form,
      tipo,
      status: TIPOS_SEM_PENDENCIA.includes(tipo) ? 'concluida' : form.status,
    })
  }

  async function enviar(e) {
    e.preventDefault()
    setErro('')
    setSalvando(true)
    try {
      const salva = await salvarAtividade(form, vaiRetornar ? retorno : null)
      onSalvo?.(salva)
      onFechar?.()
    } catch (problema) {
      setErro(problema?.message || String(problema))
    } finally {
      setSalvando(false)
    }
  }

  const titulo = ehEdicao
    ? (form.id ? 'Editar atividade' : 'Nova atividade')
    : 'Registrar o que aconteceu'

  return (
    <Modal title={titulo} open onClose={onFechar}>
      <form onSubmit={enviar} className="space-y-4">
        {/* Abrir uma tarefa de retorno tem que mostrar a conversa que a gerou —
            é o que evita ligar no escuro três semanas depois. */}
        <TrilhaOrigem registro={form} />

        {!ehEdicao && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5">
            <p className="text-sm font-medium text-slate-900">{form.titulo}</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {TIPOS_ATIVIDADE[form.tipo]}
              {clientes.get(form.clienteId) ? ` · ${clientes.get(form.clienteId).nome}` : ''}
            </p>
          </div>
        )}

        {ehEdicao && (
          <>
            <Field label="Tipo">
              <EscolhaTipo valor={form.tipo} onChange={escolherTipo} />
            </Field>

            <Field label="Cliente (opcional)">
              <ClienteBusca
                clientes={clientes.list()}
                value={form.clienteId}
                onChange={(id) => setForm({ ...form, clienteId: id })}
                placeholder="Deixe vazio para uma tarefa interna…"
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Data">
                <input className={inputCls} type="date" required value={form.data} onChange={set('data')} />
              </Field>
              <Field label="Hora (opcional)">
                <input className={inputCls} type="time" value={form.hora} onChange={set('hora')} />
              </Field>
            </div>

            <Field label="Título">
              <input
                className={inputCls}
                type="text"
                value={form.titulo}
                onChange={set('titulo')}
                placeholder="Deixe vazio para usar o tipo e o nome do cliente"
              />
            </Field>
          </>
        )}

        <Field label={ehEdicao ? 'Descrição' : 'O que foi conversado'}>
          <textarea
            className={inputCls}
            rows={ehEdicao ? 2 : 3}
            value={form.descricao}
            onChange={set('descricao')}
            placeholder={ehEdicao ? '' : 'Ex.: pediu para ligar depois do dia 10, está viajando.'}
          />
        </Field>

        {ehEdicao && !semPendencia && (
          <Field label="Situação">
            <div className="flex gap-1.5">
              {[['pendente', 'A fazer'], ['concluida', 'Já fiz']].map(([valor, rotulo]) => (
                <button
                  key={valor}
                  type="button"
                  onClick={() => setForm({ ...form, status: valor, resultado: valor === 'concluida' ? (form.resultado || 'sucesso') : '' })}
                  className={`rounded-lg border px-3 py-1.5 text-[13px] font-medium cursor-pointer ${
                    form.status === valor
                      ? 'border-blue-600 bg-blue-50 text-blue-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {rotulo}
                </button>
              ))}
            </div>
          </Field>
        )}

        {form.status === 'concluida' && !semPendencia && (
          <Desfecho form={form} setForm={setForm} retorno={retorno} setRetorno={setRetorno} />
        )}

        {form.id && <Desdobramentos atividadeId={form.id} />}

        {erro && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onFechar} disabled={salvando}>Cancelar</Button>
          <Button type="submit" disabled={salvando}>
            {salvando ? 'Salvando…' : (vaiRetornar ? 'Registrar e agendar retorno' : 'Salvar')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
