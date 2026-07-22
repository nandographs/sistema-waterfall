import { useEffect, useRef, useState } from 'react'
import { listarFotos, adicionarFoto, atualizarLegenda, removerFoto } from '../data/fotos.js'
import { formatData, TIPOS_AGENDAMENTO } from '../data/repository.js'
import { Card, Button, Field, inputCls, Empty, Modal } from './ui.jsx'
import { IconCamera, IconTrash, IconImage } from './icons.jsx'

// Rótulo de uma visita para os seletores ("12/07/2026 · Instalação")
function rotuloAgendamento(ag) {
  return `${formatData(ag.data)} · ${TIPOS_AGENDAMENTO[ag.tipo] ?? ag.tipo}`
}

export default function FotosCliente({ clienteId, agendamentos = [] }) {
  const [fotos, setFotos] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  // Fluxo de adicionar: guarda o arquivo escolhido e abre um modal para
  // legenda + visita antes de enviar.
  const inputRef = useRef(null)
  const [pendente, setPendente] = useState(null) // { arquivo, previewUrl }
  const [legenda, setLegenda] = useState('')
  const [agendamentoId, setAgendamentoId] = useState('')
  const [enviando, setEnviando] = useState(false)

  // Visualização ampliada
  const [ampliada, setAmpliada] = useState(null)

  useEffect(() => {
    let ativo = true
    listarFotos(clienteId)
      .then((lista) => ativo && setFotos(lista))
      .catch((e) => ativo && setErro(e.message || String(e)))
      .finally(() => ativo && setCarregando(false))
    return () => { ativo = false }
  }, [clienteId])

  function escolherArquivo(e) {
    const arquivo = e.target.files?.[0]
    e.target.value = '' // permite escolher o mesmo arquivo de novo depois
    if (!arquivo) return
    setPendente({ arquivo, previewUrl: URL.createObjectURL(arquivo) })
    setLegenda('')
    setAgendamentoId('')
    setErro('')
  }

  function fecharPendente() {
    if (pendente) URL.revokeObjectURL(pendente.previewUrl)
    setPendente(null)
  }

  async function enviar(e) {
    e.preventDefault()
    setEnviando(true)
    setErro('')
    try {
      const foto = await adicionarFoto(clienteId, pendente.arquivo, { legenda, agendamentoId })
      setFotos((atual) => [foto, ...atual])
      fecharPendente()
    } catch (ex) {
      setErro(ex.message || String(ex))
    } finally {
      setEnviando(false)
    }
  }

  async function salvarLegenda(id, novaLegenda) {
    await atualizarLegenda(id, novaLegenda)
    setFotos((atual) => atual.map((f) => (f.id === id ? { ...f, legenda: novaLegenda } : f)))
    setAmpliada((a) => (a && a.id === id ? { ...a, legenda: novaLegenda } : a))
  }

  async function excluir(foto) {
    if (!confirm('Excluir esta foto? Esta ação não pode ser desfeita.')) return
    try {
      await removerFoto(foto)
      setFotos((atual) => atual.filter((f) => f.id !== foto.id))
      setAmpliada((a) => (a && a.id === foto.id ? null : a))
    } catch (ex) {
      setErro(ex.message || String(ex))
    }
  }

  const acaoAdicionar = (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={escolherArquivo}
      />
      <Button variant="secondary" onClick={() => inputRef.current?.click()}>
        <IconCamera size={16} /> Adicionar foto
      </Button>
    </>
  )

  return (
    <Card title="Fotos do cliente" action={acaoAdicionar}>
      {erro && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{erro}</p>
      )}

      {carregando ? (
        <Empty>Carregando fotos…</Empty>
      ) : fotos.length === 0 ? (
        <Empty>Nenhuma foto ainda. Use “Adicionar foto” para registrar o produto do cliente.</Empty>
      ) : (
        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {fotos.map((foto) => (
            <li key={foto.id}>
              <button
                type="button"
                onClick={() => setAmpliada(foto)}
                className="block w-full aspect-square rounded-lg overflow-hidden border border-slate-200 bg-slate-50 cursor-pointer hover:opacity-90"
              >
                <img src={foto.url} alt={foto.legenda || 'Foto do cliente'} className="h-full w-full object-cover" />
              </button>
              <p className="text-xs text-slate-600 mt-1.5 truncate" title={foto.legenda}>
                {foto.legenda || <span className="text-slate-400">Sem legenda</span>}
              </p>
            </li>
          ))}
        </ul>
      )}

      {/* Modal: nova foto (legenda + visita antes de enviar) */}
      <Modal title="Nova foto" open={!!pendente} onClose={enviando ? () => {} : fecharPendente}>
        {pendente && (
          <form onSubmit={enviar} className="space-y-4">
            <div className="rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
              <img src={pendente.previewUrl} alt="Pré-visualização" className="w-full max-h-72 object-contain" />
            </div>
            <Field label="Legenda (opcional)">
              <input
                className={inputCls}
                placeholder="ex.: Purificador na cozinha — produto atual"
                value={legenda}
                onChange={(e) => setLegenda(e.target.value)}
                maxLength={120}
              />
            </Field>
            {agendamentos.length > 0 && (
              <Field label="Tirada durante qual visita? (opcional)">
                <select className={inputCls} value={agendamentoId} onChange={(e) => setAgendamentoId(e.target.value)}>
                  <option value="">Não vincular a uma visita</option>
                  {agendamentos
                    .slice()
                    .sort((a, b) => (b.data || '').localeCompare(a.data || ''))
                    .map((ag) => (
                      <option key={ag.id} value={ag.id}>{rotuloAgendamento(ag)}</option>
                    ))}
                </select>
              </Field>
            )}
            <p className="text-xs text-slate-400">
              A imagem é comprimida automaticamente antes de subir, para economizar dados e espaço.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={fecharPendente} disabled={enviando}>Cancelar</Button>
              <Button type="submit" disabled={enviando}>
                <IconImage size={16} /> {enviando ? 'Enviando…' : 'Enviar foto'}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Modal: visualização ampliada com legenda */}
      <Modal title="Foto do cliente" open={!!ampliada} onClose={() => setAmpliada(null)} size="wide">
        {ampliada && (
          <div className="space-y-4">
            <div className="rounded-lg overflow-hidden border border-slate-200 bg-slate-900/5 flex items-center justify-center">
              <img src={ampliada.url} alt={ampliada.legenda || 'Foto do cliente'} className="max-h-[65vh] w-auto object-contain" />
            </div>
            <Field label="Legenda">
              <input
                className={inputCls}
                placeholder="Sem legenda"
                defaultValue={ampliada.legenda}
                maxLength={120}
                onBlur={(e) => {
                  const nova = e.target.value.trim()
                  if (nova !== (ampliada.legenda || '')) salvarLegenda(ampliada.id, nova)
                }}
              />
            </Field>
            {ampliada.agendamentoId && (() => {
              const ag = agendamentos.find((a) => a.id === ampliada.agendamentoId)
              return ag ? <p className="text-xs text-slate-500">Registrada na visita: {rotuloAgendamento(ag)}</p> : null
            })()}
            <div className="flex justify-between items-center pt-2 border-t border-slate-100">
              <span className="text-xs text-slate-400">A legenda salva automaticamente ao sair do campo.</span>
              <Button variant="danger" onClick={() => excluir(ampliada)}>
                <IconTrash size={16} /> Excluir foto
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </Card>
  )
}
