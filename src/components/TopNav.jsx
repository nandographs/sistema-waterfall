import { NavLink } from 'react-router-dom'
import {
  IconImage, IconLogOut, IconDashboard, IconUsers, IconDroplet, IconCalendar, IconUser,
} from './icons.jsx'
import { usuarioAtual } from '../lib/auth.js'
import logo from '../assets/logo.svg'

const links = [
  { to: '/', label: 'Dashboard', Icon: IconDashboard },
  { to: '/clientes', label: 'Clientes', Icon: IconUsers },
  { to: '/produtos', label: 'Produtos', Icon: IconDroplet },
  { to: '/agendamentos', label: 'Agendamentos', Icon: IconCalendar },
]

// Menu horizontal no topo (pílula central), com as ações à direita.
// Fundo sólido (branco) — sem efeito translúcido — para ler bem tanto sobre
// o wallpaper escuro do dashboard quanto sobre as páginas claras.
// No mobile (< sm) mostra apenas os ícones; no desktop, apenas os textos.
export default function TopNav({ naDashboard, onMudarWallpaper, onSair }) {
  const acao =
    'inline-flex items-center gap-1.5 rounded-full bg-white border border-slate-200 px-3 sm:px-3.5 py-2 ' +
    'text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer shadow-sm'

  return (
    <header className="relative z-20 flex items-center justify-center gap-2 sm:gap-3 px-4 sm:px-6 py-4">
      <NavLink to="/" aria-label="Início" className="hidden lg:flex lg:absolute lg:left-6 items-center">
        <img
          src={logo}
          alt="Waterfall"
          className={`h-8 w-auto ${naDashboard ? 'brightness-0 invert' : ''}`}
        />
      </NavLink>

      <nav className="inline-flex items-center gap-1 rounded-full bg-white border border-slate-200 p-1 shadow-sm">
        {links.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            title={label}
            aria-label={label}
            className={({ isActive }) =>
              `flex items-center rounded-full px-3 sm:px-4 py-1.5 text-sm font-medium ${
                isActive ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`
            }
          >
            <Icon size={18} className="sm:hidden" />
            <span className="hidden sm:inline">{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="flex items-center gap-2 lg:absolute lg:right-6">
        {usuarioAtual() && (
          <span className={acao + ' cursor-default hover:bg-white max-sm:hidden'} title="Usuário logado">
            <IconUser size={15} /> <span className="hidden sm:inline">{usuarioAtual()}</span>
          </span>
        )}
        {naDashboard && (
          <button type="button" onClick={onMudarWallpaper} className={acao} title="Mudar wallpaper" aria-label="Mudar wallpaper">
            <IconImage size={15} /> <span className="hidden sm:inline">Mudar wallpaper</span>
          </button>
        )}
        <button type="button" onClick={onSair} className={acao} title="Sair" aria-label="Sair">
          <IconLogOut size={15} /> <span className="hidden sm:inline">Sair</span>
        </button>
      </div>
    </header>
  )
}
