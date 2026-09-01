// Componentes visuais compartilhados — estilo flat: bordas sutis, sem sombras pesadas,
// sem gradientes e sem animações.

import { useEffect, useId, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { IconX } from './icons.jsx'
import { tituloDaRota } from './navegacao.js'

export function notificar(mensagem, tipo = 'sucesso') {
  window.dispatchEvent(new CustomEvent('waterfall:toast', { detail: { mensagem, tipo } }))
}

export function Toasts() {
  const [avisos, setAvisos] = useState([])

  useEffect(() => {
    function receber(evento) {
      const id = crypto.randomUUID()
      setAvisos((atuais) => [...atuais, { id, ...evento.detail }].slice(-3))
      window.setTimeout(() => setAvisos((atuais) => atuais.filter((aviso) => aviso.id !== id)), 4200)
    }
    window.addEventListener('waterfall:toast', receber)
    return () => window.removeEventListener('waterfall:toast', receber)
  }, [])

  if (!avisos.length) return null

  return (
    <div className="fixed inset-x-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] lg:left-auto lg:right-6 lg:bottom-6 z-[70] flex flex-col gap-2 lg:w-[360px] pointer-events-none">
      {avisos.map((aviso) => (
        <div
          key={aviso.id}
          role={aviso.tipo === 'erro' ? 'alert' : 'status'}
          aria-live={aviso.tipo === 'erro' ? 'assertive' : 'polite'}
          className={`rounded-xl border px-4 py-3 text-sm font-semibold shadow-xl shadow-black/35 ${
            aviso.tipo === 'erro'
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700'
          }`}
        >
          {aviso.mensagem}
        </div>
      ))}
    </div>
  )
}

// Espaçamento padrão das páginas internas.
// pb-28 reserva a altura da barra de navegação inferior fixa (56px + safe area)
// para o último item da lista não ficar embaixo dela. O corte é `lg`, não `sm`:
// a barra inferior vive até 1023px, que é onde a sidebar assume.
export function Page({ children }) {
  return (
    <div className="px-4 sm:px-6 py-5 lg:px-8 lg:py-7 pb-28 lg:pb-8 max-w-[1480px] mx-auto w-full">
      {children}
    </div>
  )
}

// O nome da tela agora vive na topbar. Repetir "Serviços" na topbar e de novo
// como h2 logo abaixo é ruído puro — então o h2 só aparece quando diz algo
// diferente do que a topbar já disse (ex.: o nome do cliente em ClienteDetalhe).
// O subtítulo e a ação continuam sempre, porque explicam e não repetem.
export function PageTitle({ children, subtitle, action }) {
  const { pathname } = useLocation()
  const repeteTopbar =
    typeof children === 'string' && children.trim() === tituloDaRota(pathname)

  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-5 lg:mb-7">
      <div>
        {!repeteTopbar && (
          <h2 className="text-2xl lg:text-[2rem] font-semibold tracking-[-0.03em] text-slate-900">{children}</h2>
        )}
        {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

export function Card({ title, action, children, className = '', ...props }) {
  return (
    <section className={`ui-card bg-white rounded-2xl border border-slate-200 ${className}`} {...props}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 px-5 lg:px-6 pt-5 lg:pt-6 pb-4">
          <h3 className="text-base font-semibold tracking-[-0.015em] text-slate-900">{title}</h3>
          {action}
        </header>
      )}
      <div className="px-5 lg:px-6 pb-5 lg:pb-6 pt-0 [&:first-child]:pt-5 lg:[&:first-child]:pt-6">{children}</div>
    </section>
  )
}

export function Button({ children, variant = 'primary', className = '', ...props }) {
  const styles = {
    primary: 'bg-blue-500 text-[var(--btn-primary-fg)] hover:bg-blue-600',
    secondary: 'bg-slate-100 text-slate-800 border border-slate-300 hover:bg-slate-200',
    danger: 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100',
    ghost: 'text-blue-700 hover:bg-blue-50',
    // Para uso sobre fundos escuros (hero)
    hero: 'bg-white/8 text-white border border-white/20 hover:bg-white/14',
  }
  // min-h-11 (44px) no mobile atende o alvo mínimo de toque; no desktop volta
  // aos 36px originais para não inchar as barras de ação densas.
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold cursor-pointer min-h-11 sm:min-h-9 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 ${styles[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-[13px] font-semibold text-slate-700 mb-1.5">{label}</span>
      {children}
    </label>
  )
}

// Campo preenchido e sem borda, como no template (bg-input + border-none): o
// contraste com o branco do card já delimita o campo, e sem a borda a tela fica
// visivelmente mais calma num formulário de 40 campos.
//
// text-base (16px) no mobile é obrigatório: abaixo disso o Safari do iPhone dá
// zoom automático ao focar o campo e desloca o layout inteiro. No desktop volta
// para 14px. O py maior no mobile leva o campo aos 44px mínimos de toque.
export const inputCls =
  'w-full rounded-xl border border-slate-200 bg-slate-100 px-3.5 py-2.5 sm:py-2 text-base sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-500 focus:bg-slate-100 focus:ring-2 focus:ring-blue-100 transition-colors'

export function Badge({ children, color = 'slate' }) {
  const colors = {
    slate: 'bg-slate-100 text-slate-600 border border-slate-200',
    green: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    amber: 'bg-amber-50 text-amber-700 border border-amber-200',
    red: 'bg-red-50 text-red-700 border border-red-200',
    sky: 'bg-blue-50 text-blue-700 border border-blue-200',
  }
  return (
    <span className={`inline-flex items-center rounded-lg px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap ${colors[color]}`}>
      {children}
    </span>
  )
}

export function Empty({ children }) {
  return <p className="text-sm text-slate-500 py-8 text-center">{children}</p>
}

// No mobile o modal vira bottom sheet: nasce colado embaixo, onde o polegar
// alcança, e o cabeçalho fica grudado no topo para o "Fechar" continuar ao
// alcance mesmo num formulário de 40 campos.
//
// `fecharNoFundo` é false por padrão de propósito. Antes, um toque de 4px fora
// do card descartava o formulário inteiro sem aviso — no OrdemServicoModal isso
// são 40 campos perdidos. Agora só fecha pelo X ou pelo Esc; modais leves
// (confirmação, leitura) podem reativar o toque no fundo passando a prop.
export function Modal({ title, open, onClose, children, size = 'md', fecharNoFundo = false }) {
  const painelRef = useRef(null)
  const tituloId = useId()

  // Esc fecha, e o fundo trava de rolar enquanto o modal está aberto — sem isso
  // o scroll do modal "vaza" para a página atrás no iOS.
  useEffect(() => {
    if (!open) return
    const focoAnterior = document.activeElement
    const seletorFocavel = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    requestAnimationFrame(() => painelRef.current?.querySelector(seletorFocavel)?.focus())

    function aoTeclar(e) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
      if (e.key === 'Tab' && painelRef.current) {
        const focaveis = [...painelRef.current.querySelectorAll(seletorFocavel)]
        if (!focaveis.length) return
        const primeiro = focaveis[0]
        const ultimo = focaveis[focaveis.length - 1]
        if (e.shiftKey && document.activeElement === primeiro) {
          e.preventDefault()
          ultimo.focus()
        } else if (!e.shiftKey && document.activeElement === ultimo) {
          e.preventDefault()
          primeiro.focus()
        }
      }
    }
    document.addEventListener('keydown', aoTeclar)
    const overflowAnterior = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', aoTeclar)
      document.body.style.overflow = overflowAnterior
      focoAnterior?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null
  const width = size === 'wide' ? 'max-w-3xl' : 'max-w-lg'
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 sm:p-4"
      onClick={fecharNoFundo ? onClose : undefined}
      role="dialog"
      aria-modal="true"
      aria-labelledby={tituloId}
    >
      <div
        ref={painelRef}
        // dvh em vez de vh: no iOS o vh não encolhe quando o teclado abre, e o
        // modal ficava centrado atrás do teclado com o campo focado invisível.
        className={`bg-slate-100 border border-slate-300 w-full ${width} max-h-[92dvh] overflow-y-auto rounded-t-2xl rounded-b-none sm:rounded-2xl shadow-2xl shadow-black/30`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-slate-100 flex items-center justify-between gap-3 px-4 sm:px-6 pt-4 sm:pt-5 pb-3 sm:pb-4 border-b border-slate-200 rounded-t-2xl">
          <h3 id={tituloId} className="text-base font-semibold text-slate-900">{title}</h3>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-600 cursor-pointer inline-flex items-center justify-center min-h-11 min-w-11 -mr-2 shrink-0"
            onClick={onClose}
            aria-label="Fechar"
          >
            <IconX size={18} />
          </button>
        </div>
        <div className="px-4 sm:px-6 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  )
}
