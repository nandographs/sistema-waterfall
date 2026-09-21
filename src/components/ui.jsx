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

// ---------------------------------------------------------------- números
//
// O campo de número do sistema inteiro. Existe porque o <input type="number">
// do navegador não entende a vírgula: "3,5" (ou a tecla decimal do teclado
// numérico em pt-BR) vira um valor INVÁLIDO, que ele entrega como "" — e o
// React, vendo "" de novo, nem avisa das teclas seguintes. O resultado era a
// conta presa no número anterior até outro campo forçar a tela a redesenhar.
//
// Aqui o campo é texto: aceita vírgula OU ponto, e a cada tecla entrega ao
// onChange o número já normalizado com ponto ("1.500,50" → "1500.50"), no mesmo
// formato { target: { value } } de um input comum. Quem usa não muda nada.

// "1.500,50" → "1500.50"; "3,5" → "3.5"; "3.5" → "3.5"; "3," → "3."
export function normalizarNumero(texto, { inteiro = false, negativo = false } = {}) {
  let t = String(texto ?? '').replace(/\s/g, '')
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  t = t.replace(negativo ? /[^\d.-]/g : /[^\d.]/g, '')
  const [int, ...resto] = t.split('.')
  t = resto.length ? `${int}.${resto.join('')}` : int
  if (inteiro) t = t.split('.')[0]
  return t
}

const mostrarNumero = (valor) => String(valor ?? '').replace('.', ',')

export function InputNumero({ value, onChange, step, min, max, name, ...props }) {
  const inteiro = Number(step) === 1
  const negativo = min !== undefined && Number(min) < 0
  // O que está escrito no campo (com vírgula, do jeito que foi digitado). Só é
  // substituído quando o valor muda POR FORA — senão digitar "3," viraria "3"
  // no meio da digitação.
  const [texto, setTexto] = useState(() => mostrarNumero(value))
  const valorAtual = String(value ?? '')
  if (Number(normalizarNumero(texto)) !== Number(valorAtual) || (valorAtual === '') !== (texto === '')) {
    const externo = mostrarNumero(valorAtual)
    if (externo !== texto) setTexto(externo)
  }

  return (
    <input
      {...props}
      name={name}
      type="text"
      inputMode={inteiro ? 'numeric' : 'decimal'}
      autoComplete="off"
      value={texto}
      onChange={(e) => {
        // Letra não entra nem na tela: só dígito, vírgula, ponto (e o sinal).
        const digitado = e.target.value.replace(negativo ? /[^\d.,-]/g : /[^\d.,]/g, '')
        setTexto(digitado)
        let normalizado = normalizarNumero(digitado, { inteiro, negativo })
        if (normalizado !== '' && max !== undefined && Number(normalizado) > Number(max)) normalizado = String(max)
        onChange?.({ target: { value: normalizado, name, type: 'text' }, currentTarget: e.currentTarget })
      }}
    />
  )
}

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

// ---- Paginação ----
//
// As listas do sistema nasceram pequenas e eram desenhadas inteiras. Com 2.600
// clientes na base isso vira 2.600 linhas de uma vez: a rolagem não acaba mais
// e o navegador engasga a cada tecla digitada na busca.
//
// A fatia é só do DESENHO. Busca, filtros, ordenação, contagem e PDF continuam
// enxergando a lista inteira — quem pagina é a última etapa, nunca a conta.
export const POR_PAGINA = 50

// Devolve a fatia visível e o que a barra de navegação precisa saber.
//
// A página mora aqui e não na tela porque ela tem uma regra que é fácil de
// esquecer: filtrou, volta para a primeira. Sem isso, quem está na página 12 e
// digita uma busca com 3 resultados cai numa página vazia e conclui que o
// sistema não achou nada.
export function usePaginacao(itens, porPagina = POR_PAGINA) {
  const [pagina, setPagina] = useState(1)
  const total = itens.length
  const paginas = Math.max(1, Math.ceil(total / porPagina))

  // Clamp em vez de efeito: o filtro encurtou a lista debaixo dos pés e a
  // página atual não existe mais. Corrigir aqui evita o quadro vazio que um
  // useEffect deixaria aparecer por um instante antes de recolocar na página 1.
  const atual = Math.min(pagina, paginas)
  const de = (atual - 1) * porPagina

  return {
    visiveis: itens.slice(de, de + porPagina),
    barra: { pagina: atual, paginas, total, de, porPagina, irPara: setPagina },
  }
}

// A barra em si. Some sozinha quando tudo cabe numa página só.
export function Paginacao({ pagina, paginas, total, de, porPagina, irPara }) {
  if (paginas <= 1) return null
  const ate = Math.min(de + porPagina, total)
  const ir = (p) => {
    irPara(Math.min(paginas, Math.max(1, p)))
    // Trocar de página mantendo a rolagem no fim deixa o usuário no rodapé de
    // uma lista que ele ainda não viu começar.
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Uma janela em volta da página atual, com primeira e última sempre à mão.
  // Sem isso, 2.600 clientes viram 53 botões de página.
  const janela = []
  for (let p = Math.max(1, pagina - 2); p <= Math.min(paginas, pagina + 2); p++) janela.push(p)
  if (janela[0] > 1) janela.unshift(...(janela[0] > 2 ? [1, '…'] : [1]))
  if (janela[janela.length - 1] < paginas) {
    janela.push(...(janela[janela.length - 1] < paginas - 1 ? ['…', paginas] : [paginas]))
  }

  return (
    <nav
      className="flex flex-wrap items-center justify-between gap-3 pt-4 mt-2 border-t border-slate-100"
      aria-label="Paginação"
    >
      <p className="text-xs text-slate-400">
        {de + 1}–{ate} de {total}
      </p>
      <div className="flex items-center gap-1">
        <Button variant="secondary" onClick={() => ir(pagina - 1)} disabled={pagina === 1}>
          Anterior
        </Button>
        {janela.map((p, i) =>
          p === '…' ? (
            <span key={`e${i}`} className="px-1.5 text-xs text-slate-400">…</span>
          ) : (
            <button
              key={p}
              onClick={() => ir(p)}
              aria-current={p === pagina ? 'page' : undefined}
              className={`min-w-[34px] h-[34px] px-2 rounded-lg text-sm border transition-colors ${
                p === pagina
                  ? 'border-sky-600 bg-sky-600 text-white font-semibold'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {p}
            </button>
          ),
        )}
        <Button variant="secondary" onClick={() => ir(pagina + 1)} disabled={pagina === paginas}>
          Próxima
        </Button>
      </div>
    </nav>
  )
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

  // onClose costuma ser uma arrow criada no render do pai; guardar em ref
  // mantem o efeito preso so ao `open`. Sem isso, cada tecla digitada
  // re-rodava o efeito e o foco voltava pro X do cabecalho.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

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
        onCloseRef.current()
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
  }, [open])

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
