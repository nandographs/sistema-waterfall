import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { IconLogOut, IconUser, IconMais, IconX, IconSol, IconLua } from './icons.jsx'
import { NA_BARRA, NO_MAIS, tituloDaRota } from './navegacao.js'
import { usuarioAtual } from '../lib/auth.js'
import logo from '../assets/logo.svg'

// Topbar no formato do template: barra sticky com borda inferior, o nome da
// tela atual à esquerda e as ações à direita. Os destinos NÃO vivem aqui — no
// desktop estão na Sidebar, no mobile na BottomNav.
export default function TopNav({ tema, onAlternarTema }) {
  const { pathname } = useLocation()
  const rotuloTema = tema === 'claro' ? 'Mudar para o modo escuro' : 'Mudar para o modo claro'

  return (
    <header className="sticky top-0 z-30 flex h-16 lg:h-20 items-center gap-3 border-b border-slate-200 bg-[var(--topnav-bg)] backdrop-blur-sm px-4 lg:pl-7 lg:pr-8">
      {/* A logo só aparece no mobile: no desktop ela já está no topo da sidebar */}
      <NavLink to="/" aria-label="Início" className="lg:hidden shrink-0">
        <img src={logo} alt="Waterfall" className="h-6 w-auto logo-mark" />
      </NavLink>

      <h1 className="mr-auto truncate text-base lg:text-xl font-semibold tracking-[-0.025em] text-slate-900">
        {tituloDaRota(pathname)}
      </h1>

      {usuarioAtual() && (
        <span
          className="hidden lg:inline-flex items-center gap-2 rounded-xl bg-slate-100 border border-slate-200 px-3.5 py-2 text-sm font-semibold text-slate-700"
          title="Usuário logado"
        >
          <IconUser size={15} /> {usuarioAtual()}
        </span>
      )}

      <button
        type="button"
        onClick={onAlternarTema}
        title={rotuloTema}
        aria-label={rotuloTema}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
      >
        {tema === 'claro' ? <IconLua size={18} /> : <IconSol size={18} />}
      </button>
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
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 grid grid-cols-6 bg-[var(--nav-blur-bg)] backdrop-blur-md border-t border-slate-200 pb-[env(safe-area-inset-bottom)]"
        aria-label="Navegação principal"
      >
        {NA_BARRA.map(({ to, label, Icon }) => (
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
          className="lg:hidden fixed inset-0 z-50 flex items-end bg-black/60"
          onClick={() => setMaisAberto(false)}
        >
          <div
          className="w-full bg-slate-100 border-t border-slate-300 rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))]"
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
            {NO_MAIS.map(({ to, label, Icon }) => (
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
