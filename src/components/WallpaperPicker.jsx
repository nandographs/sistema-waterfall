import { Modal } from './ui.jsx'
import { IconCheck } from './icons.jsx'
import { WALLPAPERS } from '../data/wallpapers.js'

export default function WallpaperPicker({ open, onClose, atual, onSelecionar }) {
  return (
    <Modal title="Mudar wallpaper" open={open} onClose={onClose}>
      <p className="text-sm text-slate-500 mb-4">
        Escolha a imagem de fundo do painel. A escolha vale para esta sessão.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {WALLPAPERS.map((w) => {
          const selecionado = w.id === atual
          return (
            <button
              key={w.id}
              type="button"
              onClick={() => onSelecionar(w.id)}
              aria-pressed={selecionado}
              className={`relative rounded-lg overflow-hidden border-2 cursor-pointer text-left ${
                selecionado ? 'border-blue-600' : 'border-transparent hover:border-slate-300'
              }`}
            >
              <img src={w.thumb} alt="" className="w-full h-20 object-cover block" />
              {selecionado && (
                <span className="absolute top-1.5 right-1.5 flex items-center justify-center w-6 h-6 rounded-full bg-blue-600 text-white">
                  <IconCheck size={14} />
                </span>
              )}
              <span className="block px-2 py-1.5 text-xs font-medium text-slate-700 bg-white">
                {w.nome}
              </span>
            </button>
          )
        })}
      </div>
    </Modal>
  )
}
