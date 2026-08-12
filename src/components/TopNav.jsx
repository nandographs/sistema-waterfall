import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  IconImage, IconLogOut, IconDashboard, IconUsers, IconDroplet, IconCalendar, IconUser,
  IconFileText, IconWallet, IconCheckSquare, IconMais, IconX,
} from './icons.jsx'
import { usuarioAtual } from '../lib/auth.js'
import logo from '../assets/logo.svg'

// "Agenda" é o seu dia (contatos, tarefas, o calendário); "Serviços" são as
// ordens de serviço em campo — o que antes se chamava "Agendamentos". Os dois
// nomes juntos no menu confundiriam, e "Serviços" descreve melhor o que a
// tela sempre foi. Rota e tabela seguem com o nome antigo.
const links = [
  { to: '/', label: 'Dashboard', Icon: IconDashboard },
  { to: '/agenda', label: 'Agenda', Icon: IconCalendar },
  { to: '/clientes', label: 'Clientes', Icon: IconUsers },
  { to: '/produtos', label: 'Produtos', Icon: IconDroplet },
  { to: '/agendamentos', label: 'Serviços', Icon: IconCheckSquare },
  { to: '/vendas', label: 'Vendas', Icon: IconFileText },
  { to: '/financeiro', label: 'Financeiro', Icon: IconWallet },
]

// No celular só cabem 5 destinos com rótulo legível; os outros dois vão para o
// "Mais". A escolha dos 5 segue a frequência de uso em campo, não a ordem do
// menu de desktop — Produtos e Vendas são tarefas de escritório.
const ROTAS_BARRA = ['/', '/agenda', '/clientes', '/agendamentos', '/financeiro']
const naBarra = links.filter((l) => ROTAS_BARRA.includes(l.to))
const noMais = links.filter((l) => !ROTAS_BARRA.includes(l.to))

const acao =
  'inline-flex items-center justify-center gap-1.5 rounded-full bg-white border border-slate-200 px-3 sm:px-3.5 ' +
  'min-h-11 sm:min-h-0 sm:py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer shadow-sm'

// Cabeçalho: no desktop, a pílula central com os 7 destinos e as ações à direita.
// No mobile a pílula sai daqui — os 7 links somavam ~460px numa tela de 375px e
// estouravam a viewport — e vira a barra inferior fixa (BottomNav abaixo).
export default function TopNav({ naDashboard, onMudarWallpaper, onSair }) {
  return (
    <header className="relative z-20 flex items-center justify-between sm:justify-center gap-2 sm:gap-3 px-4 sm:px-6 py-3 sm:py-4">
      <NavLink to="/" aria-label="Início" className="flex lg:absolute lg:left-6 items-center shrink-0">
        <img
          src={logo}
          alt="Waterfall"
          className={`h-7 sm:h-8 w-auto ${naDashboard ? 'brightness-0 invert' : ''}`}
        />
      </NavLink>

      <nav className="hidden sm:inline-flex items-center gap-1 rounded-full bg-white border border-slate-200 p-1 shadow-sm">
        {links.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center rounded-full px-4 py-1.5 text-sm font-medium ${
                isActive ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`
            }
          >
            {label}
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
          <button type="button" onClick={onMudarWallpaper} className={acao + ' max-sm:w-11'} title="Mudar wallpaper" aria-label="Mudar wallpaper">
            <IconImage size={16} /> <span className="hidden sm:inline">Mudar wallpaper</span>
          </button>
        )}
        {/* Sair vive no "Mais" da barra inferior no mobile — ação destrutiva não
            deve dividir espaço com a navegação principal. */}
        <button type="button" onClick={onSair} className={acao + ' max-sm:hidden'} title="Sair" aria-label="Sair">
          <IconLogOut size={16} /> Sair
        </button>
      </div>
    </header>
  )
}

// Barra inferior fixa, só no mobile. Fica na zona do polegar, cada célula tem
// 56px de altura e ícone + rótulo — nav só de ícone destrói a descoberta.
export function BottomNav({ onSair }) {
  const [maisAberto, setMaisAberto] = useState(false)

  const celula = ({ isActive }) =>
    `flex flex-col items-center justify-center gap-0.5 min-h-14 px-1 text-[10px] font-medium ${
      isActive ? 'text-blue-600' : 'text-slate-500'
    }`

  return (
    <>
      <nav
        className="sm:hidden fixed bottom-0 inset-x-0 z-40 grid grid-cols-6 bg-white border-t border-slate-200 pb-[env(safe-area-inset-bottom)]"
        aria-label="Navegação principal"
      >
        {naBarra.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} end={to === '/'} className={celula}>
            <Icon size={20} />
            <span>{label}</span>
          </NavLink>
        ))}
        <button
          type="button"
          onClick={() => setMaisAberto(true)}
          className="flex flex-col items-center justify-center gap-0.5 min-h-14 px-1 text-[10px] font-medium text-slate-500 cursor-pointer"
          aria-expanded={maisAberto}
        >
          <IconMais size={20} />
          <span>Mais</span>
        </button>
      </nav>

      {maisAberto && (
        <div
          className="sm:hidden fixed inset-0 z-50 flex items-end bg-slate-900/50"
          onClick={() => setMaisAberto(false)}
        >
          <div
            className="w-full bg-white rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <span className="text-sm font-semibold text-slate-900">
                {usuarioAtual() ? `Conectado como ${usuarioAtual()}` : 'Mais'}
              </span>
              <button
                type="button"
                className="text-slate-400 p-3 -m-1.5 cursor-pointer"
                onClick={() => setMaisAberto(false)}
                aria-label="Fechar"
              >
                <IconX size={18} />
              </button>
            </div>
            {noMais.map(({ to, label, Icon }) => (
              <NavLink
                key={to}
                to={to}
                onClick={() => setMaisAberto(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 min-h-14 text-sm font-medium border-t border-slate-100 ${
                    isActive ? 'text-blue-600' : 'text-slate-700'
                  }`
                }
              >
                <Icon size={20} /> {label}
              </NavLink>
            ))}
            <button
              type="button"
              onClick={() => { setMaisAberto(false); onSair() }}
              className="flex items-center gap-3 px-4 min-h-14 w-full text-sm font-medium text-red-600 border-t border-slate-100 cursor-pointer"
            >
              <IconLogOut size={20} /> Sair
            </button>
          </div>
        </div>
      )}
    </>
  )
}
