// Componentes visuais compartilhados — a galeria branca: superfície Gallery
// White sobre canvas Studio Mist, filete de 1px no lugar de sombra, cards de
// 28px, pílula para ação e tinta Ink no texto. Ver docs/referencia-apple/.

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
          // Cápsula branca com filete, no formato do "Floating Pricing Callout":
          // a cor fica no ponto e no texto, não no fundo.
          className={`ui-card superficie-flutuante rounded-2xl px-4 py-3 text-sm font-medium flex items-center gap-2.5 ${
            aviso.tipo === 'erro' ? 'text-red-600' : 'text-slate-900'
          }`}
        >
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${aviso.tipo === 'erro' ? 'bg-red-500' : 'bg-emerald-500'}`}
          />
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
          <h2 className="texto-heroi text-[1.75rem] lg:text-[2.5rem] text-slate-900">{children}</h2>
        )}
        {/* 17px é o corpo da referência, com o tracking dela. */}
        {subtitle && <p className="text-[15px] lg:text-[17px] text-slate-500 mt-2 tracking-[-0.022em]">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

// A "Feature Media Card" da referência: Gallery White, 28px de raio (o
// rounded-2xl do projeto vale 28px — ver os overrides de --radius-* em
// index.css), sem sombra. O filete de 1px fica porque no tema escuro branco
// sobre branco não existe: lá a separação PRECISA do traço.
export function Card({ title, action, children, className = '', ...props }) {
  return (
    <section className={`ui-card bg-white rounded-2xl border border-slate-200 ${className}`} {...props}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 px-5 lg:px-7 pt-5 lg:pt-6 pb-4">
          <h3 className="text-[17px] font-semibold text-slate-900">{title}</h3>
          {action}
        </header>
      )}
      <div className="px-5 lg:px-7 pb-5 lg:pb-7 pt-0 [&:first-child]:pt-5 lg:[&:first-child]:pt-6">{children}</div>
    </section>
  )
}

// Todo botão é pílula — é a forma da referência, e a única que ela admite.
//
// A hierarquia é a da Apple, e ela é mais estreita do que parece: Pricing Blue
// preenchido é reservado à ação de conversão (uma por tela, em geral), o resto
// é a "Outlined Explore Pill" — fundo transparente, tinta Ink, filete Steel.
// Por isso `secondary` não tem preenchimento cinza: fundo cinza em botão é o
// que fazia a barra de ações virar um bloco de caixinhas.
export function Button({ children, variant = 'primary', className = '', ...props }) {
  const styles = {
    primary: 'bg-blue-500 text-[var(--btn-primary-fg)] border border-transparent hover:opacity-85',
    secondary: 'bg-transparent text-slate-900 border border-slate-400 hover:bg-slate-100',
    danger: 'bg-transparent text-red-600 border border-red-200 hover:bg-red-50',
    ghost: 'text-blue-600 border border-transparent hover:bg-slate-100',
  }
  // min-h-11 (44px) no mobile atende o alvo mínimo de toque; no desktop volta
  // aos 36px originais para não inchar as barras de ação densas.
  //
  // O anel de foco some: o *:focus-visible global do index.css já desenha o
  // contorno, e o ring com offset pregado no canvas ficava com a cor errada
  // sobre card e dentro de modal.
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium cursor-pointer min-h-11 sm:min-h-9 disabled:opacity-40 disabled:cursor-not-allowed transition-[background-color,opacity,border-color] ${styles[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-[13px] font-medium text-slate-500 mb-1.5">{label}</span>
      {children}
    </label>
  )
}

// O campo da referência é branco com contorno de 1px Steel — não preenchido.
// Sobre o branco do card o contorno é o que delimita, e é ele que mantém o
// formulário parecendo parte da galeria em vez de uma grade de caixas cinzas.
//
// O raio é 12px (rounded-xl), não os 980px da referência: aqueles 980px são a
// busca da barra de navegação da Apple, um campo isolado. Num formulário de 40
// campos a cápsula come o espaço útil e descola o texto do rótulo.
//
// text-base (16px) no mobile é obrigatório: abaixo disso o Safari do iPhone dá
// zoom automático ao focar o campo e desloca o layout inteiro. No desktop volta
// para 14px. O py maior no mobile leva o campo aos 44px mínimos de toque.
export const inputCls =
  'w-full rounded-xl border border-slate-400 bg-[var(--surface-campo)] px-3.5 py-2.5 sm:py-2 text-base sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors'

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
  // Sem vírgula, ponto seguido de grupos de 3 dígitos é MILHAR: "1.500" é mil e
  // quinhentos, não 1,5 (que se escreve "1,5" — ou "1.5", que continua valendo).
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '')
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
      // Clicar seleciona o número inteiro: o que se digita SUBSTITUI o que
      // estava (uma taxa já preenchida, um "1" de parcelas), em vez de grudar
      // no fim e virar "3,53,5".
      onFocus={(e) => { e.target.select(); props.onFocus?.(e) }}
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

// A "Launch Status Label" da referência: texto colorido puro, sem preenchimento
// e sem borda — ela proíbe explicitamente a pílula de status colorida.
//
// O ponto de 6px não está na referência e é uma adaptação necessária: numa
// página de produto existe UM rótulo de status; numa lista de 2.600 linhas o
// status é uma coluna que se lê varrendo a vertical, e cor de texto sozinha não
// se acha nessa varredura. O ponto devolve o ponto de fixação sem trazer de
// volta o bloco tingido.
export function Badge({ children, color = 'slate' }) {
  const colors = {
    slate: ['text-slate-500', 'bg-slate-400'],
    green: ['text-emerald-600', 'bg-emerald-500'],
    amber: ['text-amber-600', 'bg-amber-500'],
    red: ['text-red-600', 'bg-red-500'],
    sky: ['text-blue-600', 'bg-blue-500'],
  }
  const [texto, ponto] = colors[color] ?? colors.slate
  return (
    <span className={`inline-flex items-center gap-1.5 text-[12px] font-medium whitespace-nowrap tracking-[-0.012em] ${texto}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${ponto}`} />
      {children}
    </span>
  )
}

// ---- O número de um painel ----
//
// "27" e "R$ 1.249.072,63" moram no mesmo quadro. Qualquer corpo de tipo FIXO
// serve um e estoura o outro — era o que acontecia com "Vendido no mês", que
// pedia 251px numa caixa de 232px e vazava para fora do card.
//
// Então o corpo não é escolhido, é derivado. `100cqi` é a largura ÚTIL do
// próprio card — ele é declarado `.painel-numero` em index.css, o que o torna
// um contêiner de consulta, e `cqi` já mede a caixa de conteúdo, com o padding
// descontado. Dividida pelo espaço que aquele texto ocupa, dá o maior corpo que
// ainda cabe. O `min()` com o teto do desenho impede o caminho contrário: "27"
// crescendo até virar outra coisa.
//
// (O `respiro` é só uma folga fina contra arredondamento; descontar o padding
// aqui seria descontá-lo duas vezes, e no celular isso derrubava o número para
// 11px dentro de um card de 164px.)
//
// 0.56 é a largura de um caractere em fração do corpo, medida na SF Pro/Inter
// semibold com algarismos tabulares. Dinheiro em BRL fica entre 0.52 e 0.545;
// a folga cobre a fonte substituta, que é um pouco mais larga.
const LARGURA_DO_CARACTERE = 0.56

export function corpoDoNumero(valor, teto = '2rem', respiro = '0.25rem') {
  const largura = (String(valor ?? '').length * LARGURA_DO_CARACTERE).toFixed(2)
  return { fontSize: `min(${teto}, calc((100cqi - ${respiro}) / ${largura}))` }
}

export function Empty({ children }) {
  return <p className="text-[15px] text-slate-500 py-10 text-center tracking-[-0.022em]">{children}</p>
}

// ---- Aviso ----
//
// A faixa de alerta inline existia em ~18 cópias à mão pelo sistema, cada uma
// com o seu raio (`rounded-lg` ou `rounded-xl`) e o seu tom (`-600` ou `-700`).
// Aqui ela é uma só, e no idioma da galeria: superfície neutra, filete de 1px,
// e a cor só no ponto e no texto — nunca um retângulo tingido.
export function Aviso({ children, tipo = 'info', className = '' }) {
  const tons = {
    info: ['text-slate-600', 'bg-slate-400'],
    erro: ['text-red-600', 'bg-red-500'],
    alerta: ['text-amber-600', 'bg-amber-500'],
    ok: ['text-emerald-600', 'bg-emerald-500'],
  }
  const [texto, ponto] = tons[tipo] ?? tons.info
  return (
    <div
      role={tipo === 'erro' ? 'alert' : undefined}
      className={`flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-100 px-3.5 py-2.5 text-[13px] leading-relaxed ${texto} ${className}`}
    >
      <span aria-hidden="true" className={`mt-[0.4em] h-1.5 w-1.5 shrink-0 rounded-full ${ponto}`} />
      <span className="min-w-0">{children}</span>
    </div>
  )
}

// ---- Segmentos ----
//
// Havia CINCO desenhos concorrentes de aba/segmento no sistema (bandeja cinza,
// pílula azul preenchida, sólido invertido, bandeja arredondada, pílula
// fantasma) — às vezes dois deles na mesma tela. Este é o único.
//
// A forma é a da referência: bandeja discreta, e o ativo é uma pílula branca
// com filete, marcada por SUPERFÍCIE e peso, não por tinta azul.
//
// `opcoes` aceita as três formas que já existiam espalhadas pelo sistema:
// 'mes', ['mes', 'Mês'] ou { valor: 'mes', rotulo: 'Mês' }. É o que permite
// trocar os cinco desenhos antigos sem reescrever nenhuma chamada.
export function Segmentos({ opcoes, valor, onChange, className = '', rotulo, 'aria-label': aria }) {
  const itens = opcoes.map((o) => {
    if (typeof o === 'string') return { valor: o, rotulo: o }
    if (Array.isArray(o)) return { valor: o[0], rotulo: o[1] }
    return o
  })
  return (
    <div role="tablist" aria-label={aria ?? rotulo} className={`inline-flex items-center gap-1 rounded-full bg-slate-100 p-1 ${className}`}>
      {itens.map(({ valor: v, rotulo }) => {
        const ativo = v === valor
        return (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={ativo}
            onClick={() => onChange(v)}
            className={`rounded-full px-3.5 min-h-9 text-[13px] font-medium whitespace-nowrap cursor-pointer transition-colors ${
              ativo
                ? 'ui-card bg-white text-slate-900 border border-slate-300'
                : 'border border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            {rotulo}
          </button>
        )
      })}
    </div>
  )
}

// A superfície de qualquer coisa que flutua sobre o conteúdo — menu, popover,
// listbox de autocomplete. Uma receita só: Gallery White com contorno de 1px, o
// `0 0 0 1px` que a referência chama de única marca de elevação. Sem sombra.
export const menuFlutuante =
  'ui-card superficie-flutuante rounded-2xl border-0 p-1.5 z-30'

// O item dentro desse menu. O texto estava duplicado em quatro arquivos.
export const itemMenu =
  'flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-100 cursor-pointer'

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
      className="flex flex-wrap items-center justify-between gap-3 pt-4 mt-2 border-t border-slate-200"
      aria-label="Paginação"
    >
      <p className="text-xs text-slate-400 tnum">
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
              className={`min-w-[34px] h-[34px] px-2 rounded-full text-sm border cursor-pointer transition-colors tnum ${
                p === pagina
                  ? 'border-transparent bg-blue-500 text-[var(--btn-primary-fg)] font-medium'
                  : 'border-transparent text-slate-500 hover:text-slate-900 hover-superficie'
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
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[var(--scrim)] sm:p-4"
      onClick={fecharNoFundo ? onClose : undefined}
      role="dialog"
      aria-modal="true"
      aria-labelledby={tituloId}
    >
      <div
        ref={painelRef}
        // dvh em vez de vh: no iOS o vh não encolhe quando o teclado abre, e o
        // modal ficava centrado atrás do teclado com o campo focado invisível.
        className={`ui-card bg-white border border-slate-200 w-full ${width} max-h-[92dvh] overflow-y-auto rounded-t-2xl rounded-b-none sm:rounded-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-[var(--surface-card)] flex items-center justify-between gap-3 px-4 sm:px-6 pt-4 sm:pt-5 pb-3 sm:pb-4 border-b border-slate-200 rounded-t-2xl">
          <h3 id={tituloId} className="text-[17px] font-semibold text-slate-900">{title}</h3>
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
