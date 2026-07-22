import { useRef, useState } from 'react'
import { IconCamera } from './icons.jsx'

// Foto única com botão de câmera para trocar e opção de remover.
// Quando não há foto, mostra o placeholder recebido (ícone padrão).
// props: url, onEnviar(arquivo), onRemover(), placeholder, formato ('circulo'|'quadrado'), tamanho(px)
export default function FotoUnica({ url, onEnviar, onRemover, placeholder, formato = 'circulo', tamanho = 96 }) {
  const inputRef = useRef(null)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  const raio = formato === 'circulo' ? 'rounded-full' : 'rounded-xl'

  async function escolher(e) {
    const arquivo = e.target.files?.[0]
    e.target.value = ''
    if (!arquivo) return
    setOcupado(true)
    setErro('')
    try {
      await onEnviar(arquivo)
    } catch (ex) {
      setErro(ex.message || String(ex))
    } finally {
      setOcupado(false)
    }
  }

  async function remover() {
    if (!confirm('Remover esta foto?')) return
    setOcupado(true)
    setErro('')
    try {
      await onRemover()
    } catch (ex) {
      setErro(ex.message || String(ex))
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: tamanho, height: tamanho }}>
        <div className={`w-full h-full ${raio} overflow-hidden border border-slate-200 bg-slate-100 flex items-center justify-center text-slate-300`}>
          {url ? (
            <img src={url} alt="" className="w-full h-full object-cover" />
          ) : (
            placeholder
          )}
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={ocupado}
          className="absolute -bottom-1 -right-1 bg-blue-600 text-white rounded-full p-1.5 border-2 border-white hover:bg-blue-700 cursor-pointer disabled:opacity-60"
          aria-label="Alterar foto"
          title="Alterar foto"
        >
          <IconCamera size={14} />
        </button>
        <input ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={escolher} />
      </div>
      {ocupado && <span className="text-xs text-slate-400">Enviando…</span>}
      {!ocupado && url && (
        <button type="button" onClick={remover} className="text-xs text-red-600 hover:underline cursor-pointer">
          Remover foto
        </button>
      )}
      {erro && <span className="text-xs text-red-600 text-center">{erro}</span>}
    </div>
  )
}
