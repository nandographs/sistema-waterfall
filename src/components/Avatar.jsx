import { fotoDoContato } from '../data/repository.js'
import { IconUser } from './icons.jsx'

// O rosto de uma pessoa no sistema, em três degraus: a foto, as iniciais, o
// ícone genérico.
//
// Está num arquivo próprio porque aparece em lugares que não têm nada a ver
// entre si — a caixa de entrada do WhatsApp, os cartões do funil, a ficha do
// cliente. Cada tela desenhando o seu é como três círculos de tamanhos
// diferentes acabam na mesma página.

// "Marina Alves" -> "MA". Duas letras no máximo, porque três já não se lê num
// círculo de 40px.
export function iniciais(nome) {
  const partes = String(nome || '').trim().split(/\s+/).filter(Boolean)
  if (!partes.length) return ''
  const primeira = partes[0][0]
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : ''
  return (primeira + ultima).toUpperCase()
}

// props: foto (URL pronta), nome, size (px), className
export function Avatar({ foto, nome, size = 40, className = '' }) {
  const estilo = { width: size, height: size }
  const letras = iniciais(nome)

  if (foto) {
    return (
      <img
        src={foto}
        alt=""
        style={estilo}
        className={`shrink-0 rounded-full object-cover border border-slate-200 bg-slate-100 ${className}`}
      />
    )
  }

  return (
    <span
      style={estilo}
      aria-hidden="true"
      className={`shrink-0 inline-flex items-center justify-center rounded-full bg-slate-100 border border-slate-200 text-slate-500 font-semibold ${className}`}
    >
      {letras ? (
        <span style={{ fontSize: Math.round(size * 0.36) }}>{letras}</span>
      ) : (
        // Sem nome — o número que escreveu e não está no cadastro. O ícone
        // genérico aqui diz algo de útil: "não sei quem é".
        <IconUser size={Math.round(size * 0.45)} />
      )}
    </span>
  )
}

// O mesmo, resolvendo a foto sozinho a partir de quem a pessoa é. É a forma
// usada em quase todo lugar: a regra de qual foto vence (cadastro, depois
// WhatsApp) mora no repositório, e não se repete por tela.
export function AvatarContato({ clienteId, conversaId, telefone, nome, size = 40, className = '' }) {
  return (
    <Avatar
      foto={fotoDoContato({ clienteId, conversaId, telefone })}
      nome={nome}
      size={size}
      className={className}
    />
  )
}

export default Avatar
