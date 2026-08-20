import { NavLink } from 'react-router-dom'
import {
  IconLogOut, IconUser, IconChevronLeft, IconChevronRight, IconImage,
} from './icons.jsx'
import { LINKS } from './navegacao.js'
import { usuarioAtual } from '../lib/auth.js'
import logo from '../assets/logo.svg'

// Sidebar do desktop, no formato do template: 290px, colapsa para 80px só com
// ícones, item ativo em superfície azulada com texto na cor da marca.
//
// Só existe a partir de `lg`. Abaixo disso quem navega é a barra inferior
// (ver BottomNav) — ela fica na zona do polegar e já foi medida em 375px.
export default function Sidebar({ colapsada, onAlternar, naDashboard, onMudarWallpaper, onSair }) {
  const largura = colapsada ? 'w-20' : 'w-[18.125rem]'

  return (
    <aside
      className={`hidden lg:flex ${largura} shrink-0 flex-col border-r border-slate-200 bg-white h-svh sticky top-0`}
    >
      <div className={`flex items-center h-21 shrink-0 border-b border-slate-200 ${colapsada ? 'justify-center px-2' : 'px-6'}`}>
        <NavLink to="/" aria-label="Início" className="flex items-center min-w-0">
          <img src={logo} alt="Waterfall" className={colapsada ? 'h-7 w-7 object-contain object-left shrink-0' : 'h-8 w-auto'} />
        </NavLink>
      </div>

      <nav className="flex-1 overflow-y-auto sem-barra py-4 px-3 space-y-1">
        {LINKS.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            // aria-label sempre, não só quando recolhida: o ícone é aria-hidden
            // e o rótulo visível some no modo estreito, o que deixaria o link
            // sem nome nenhum para leitor de tela.
            aria-label={label}
            title={colapsada ? label : undefined}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg min-h-11 text-sm font-medium ${
                colapsada ? 'justify-center px-0' : 'px-3'
              } ${
                isActive
                  ? 'bg-accent-suave text-blue-700'
                  : 'text-slate-700 hover:bg-slate-50'
              }`
            }
          >
            <Icon size={20} className="shrink-0" />
            {!colapsada && <span className="truncate">{label}</span>}
          </NavLink>
        ))}
      </nav>

      <div className="shrink-0 border-t border-slate-200 p-3 space-y-1">
        {usuarioAtual() && !colapsada && (
          <div className="flex items-center gap-2.5 px-3 py-2 min-w-0">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-suave text-blue-700">
              <IconUser size={16} />
            </span>
            <span className="min-w-0">
              <span className="block text-[11px] text-slate-500 leading-tight">Conectado como</span>
              <span className="block text-sm font-medium text-slate-900 truncate leading-tight">
                {usuarioAtual()}
              </span>
            </span>
          </div>
        )}

        {naDashboard && (
          <button
            type="button"
            onClick={onMudarWallpaper}
            title="Mudar wallpaper"
            className={`flex items-center gap-3 w-full rounded-lg min-h-11 text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer ${
              colapsada ? 'justify-center px-0' : 'px-3'
            }`}
          >
            <IconImage size={20} className="shrink-0" />
            {!colapsada && <span>Mudar wallpaper</span>}
          </button>
        )}

        <button
          type="button"
          onClick={onSair}
          title="Sair"
          className={`flex items-center gap-3 w-full rounded-lg min-h-11 text-sm font-medium text-red-600 hover:bg-red-50 cursor-pointer ${
            colapsada ? 'justify-center px-0' : 'px-3'
          }`}
        >
          <IconLogOut size={20} className="shrink-0" />
          {!colapsada && <span>Sair</span>}
        </button>

        <button
          type="button"
          onClick={onAlternar}
          aria-label={colapsada ? 'Expandir menu' : 'Recolher menu'}
          title={colapsada ? 'Expandir menu' : 'Recolher menu'}
          className={`flex items-center gap-3 w-full rounded-lg min-h-11 text-sm font-medium text-slate-500 hover:bg-slate-50 cursor-pointer ${
            colapsada ? 'justify-center px-0' : 'px-3'
          }`}
        >
          {colapsada ? <IconChevronRight size={20} /> : <IconChevronLeft size={20} />}
          {!colapsada && <span>Recolher menu</span>}
        </button>
      </div>
    </aside>
  )
}
