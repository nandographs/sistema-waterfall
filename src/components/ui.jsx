// Componentes visuais compartilhados — estilo flat: bordas sutis, sem sombras pesadas,
// sem gradientes e sem animações.

import { IconX } from './icons.jsx'

// Espaçamento padrão das páginas internas
export function Page({ children }) {
  return <div className="px-6 py-8 lg:px-10 max-w-[1600px] mx-auto w-full">{children}</div>
}

export function PageTitle({ children, subtitle, action }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">{children}</h2>
        {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

export function Card({ title, action, children, className = '' }) {
  return (
    <section className={`bg-white rounded-xl border border-slate-200 ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          {action}
        </header>
      )}
      <div className="px-5 py-4">{children}</div>
    </section>
  )
}

export function Button({ children, variant = 'primary', className = '', ...props }) {
  const styles = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700',
    secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50',
    danger: 'bg-white text-red-600 border border-red-200 hover:bg-red-50',
    ghost: 'text-blue-600 hover:bg-blue-50',
    // Para uso sobre fundos escuros (hero)
    hero: 'bg-white/10 text-white border border-white/25 hover:bg-white/20',
  }
  return (
    <button
      className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${styles[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-[13px] font-medium text-slate-700 mb-1.5">{label}</span>
      {children}
    </label>
  )
}

export const inputCls =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white placeholder:text-slate-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100'

export function Badge({ children, color = 'slate' }) {
  const colors = {
    slate: 'bg-slate-100 text-slate-600',
    green: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    amber: 'bg-amber-50 text-amber-700 border border-amber-200',
    red: 'bg-red-50 text-red-700 border border-red-200',
    sky: 'bg-blue-50 text-blue-700 border border-blue-200',
  }
  return (
    <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ${colors[color]}`}>
      {children}
    </span>
  )
}

export function Empty({ children }) {
  return <p className="text-sm text-slate-400 py-8 text-center">{children}</p>
}

export function Modal({ title, open, onClose, children, size = 'md' }) {
  if (!open) return null
  const width = size === 'wide' ? 'max-w-3xl' : 'max-w-lg'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      <div
        className={`bg-white rounded-xl border border-slate-200 w-full ${width} max-h-[90vh] overflow-y-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button
            className="text-slate-400 hover:text-slate-600 cursor-pointer p-1"
            onClick={onClose}
            aria-label="Fechar"
          >
            <IconX size={18} />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  )
}
