import { hexDaCor } from '../lib/funis.js'

// A bolinha da cor do funil. É a única marca de cor do funil no sistema — nas
// abas do quadro, no filtro e na etiqueta da conversa — para que a cor queira
// dizer a mesma coisa em todo lugar.
export function BolinhaFunil({ cor, tamanho = 8, className = '' }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 rounded-full ${className}`}
      style={{ width: tamanho, height: tamanho, backgroundColor: hexDaCor(cor) }}
    />
  )
}

// "Vendas · Proposta enviada", com a bolinha do funil.
//
// O fundo é a própria cor bem diluída, e o texto continua na cor do texto: o
// amarelo e a menta, como texto, somem sobre o branco — como bolinha e como
// tinta de fundo, não.
export default function EtiquetaFunil({ cor, funil, etapa, titulo, className = '', children }) {
  const hex = hexDaCor(cor)
  return (
    <span
      title={titulo ?? [funil, etapa].filter(Boolean).join(' · ')}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium text-slate-700 ${className}`}
      style={{ backgroundColor: `color-mix(in srgb, ${hex} 14%, transparent)` }}
    >
      <BolinhaFunil cor={cor} tamanho={7} />
      <span className="truncate">
        {funil && <span className="font-semibold">{funil}</span>}
        {funil && etapa && <span className="opacity-60"> · </span>}
        {etapa}
      </span>
      {children}
    </span>
  )
}
