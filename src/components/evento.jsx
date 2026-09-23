// Vocabulário visual da agenda.
//
// Atividades, serviços e vencimentos dividem o mesmo calendário, então dividem
// também o mesmo desenho: uma cor, um ícone e uma linha. Concentrar isso aqui é
// o que faz a grade do mês, o painel do dia e o bloco "Hoje" do dashboard
// parecerem a mesma coisa em tamanhos diferentes.

import { Link } from 'react-router-dom'
import {
  IconPhone, IconMessage, IconMail, IconCheckSquare, IconNote,
  IconUser, IconUsersRound, IconCalendar, IconWallet, IconCheck, IconClock,
} from './icons.jsx'
import { formatHora, ehPassado } from '../lib/datas.js'
import { formatBRL, TIPOS_ATIVIDADE } from '../data/repository.js'

const ICONES_ATIVIDADE = {
  ligacao: IconPhone,
  whatsapp: IconMessage,
  email: IconMail,
  visita: IconUser,
  reuniao: IconUsersRound,
  tarefa: IconCheckSquare,
  nota: IconNote,
}

export function IconeDoEvento({ evento, size = 15, className = '' }) {
  if (evento.fonte === 'agendamento') return <IconCalendar size={size} className={className} />
  if (evento.fonte === 'vencimento') return <IconWallet size={size} className={className} />
  const Icone = ICONES_ATIVIDADE[evento.tipo] ?? IconCheckSquare
  return <Icone size={size} className={className} />
}

// As paletas são escritas por extenso, e não montadas com template string, para
// o Tailwind conseguir enxergá-las ao varrer o código — classe gerada em tempo
// de execução simplesmente não existe no CSS final.
//
// Na galeria branca a cor saiu do FUNDO e foi para o traço. Antes cada tipo de
// evento tingia a bolha do ícone e o cartão inteiro (`bg-emerald-50`,
// `bg-blue-50`, `bg-red-50`): numa agenda cheia isso vira uma coluna de
// retângulos coloridos onde nada tem prioridade sobre nada. Agora a superfície
// é sempre neutra e a cor aparece só no ponto, no glifo e na etiqueta — que é
// exatamente a regra da referência para o rótulo de status.
const PALETAS = {
  emerald: {
    ponto: 'bg-emerald-500',
    icone: 'text-emerald-600',
    texto: 'text-slate-900',
    bolha: 'bg-slate-100 text-emerald-600',
    cartao: 'bg-[var(--surface-card)] border-slate-200',
    etiqueta: 'text-emerald-600',
  },
  blue: {
    ponto: 'bg-blue-500',
    icone: 'text-blue-600',
    texto: 'text-slate-900',
    bolha: 'bg-slate-100 text-blue-600',
    cartao: 'bg-[var(--surface-card)] border-slate-200',
    etiqueta: 'text-blue-600',
  },
  violet: {
    ponto: 'bg-violet-500',
    icone: 'text-violet-500',
    texto: 'text-slate-900',
    bolha: 'bg-slate-100 text-violet-500',
    cartao: 'bg-[var(--surface-card)] border-slate-200',
    etiqueta: 'text-violet-500',
  },
  red: {
    ponto: 'bg-red-500',
    icone: 'text-red-600',
    texto: 'text-slate-900',
    // O atrasado é o único que ainda se distingue pela SUPERFÍCIE, e mesmo
    // assim só pela borda: é a informação que muda o que se faz agora.
    bolha: 'bg-slate-100 text-red-600',
    cartao: 'bg-[var(--surface-card)] border-red-200',
    etiqueta: 'text-red-600',
  },
  cinza: {
    ponto: 'bg-slate-300',
    icone: 'text-slate-400',
    texto: 'text-slate-400',
    bolha: 'bg-slate-100 text-slate-400',
    cartao: 'bg-slate-100 border-slate-200',
    etiqueta: 'text-slate-400',
  },
}

// Um evento atrasado é vermelho ANTES de ser qualquer outra coisa: essa é a
// informação que muda o que você faz agora.
export function estiloDoEvento(evento) {
  if (evento.cancelado) return { ...PALETAS.cinza, texto: 'text-slate-400 line-through' }
  // Reagendado não é riscado: o serviço não foi desfeito, mudou de dia. Cinza
  // basta para tirá-lo da fila do que ainda se faz hoje.
  if (evento.reagendado) return PALETAS.cinza
  if (evento.concluido) return PALETAS.cinza
  if (evento.pendente && ehPassado(evento.data)) return PALETAS.red
  if (evento.fonte === 'agendamento') return PALETAS.blue
  if (evento.fonte === 'vencimento') return PALETAS.violet
  return PALETAS.emerald
}

// A etiqueta que diz QUE COISA é esta — "Serviço", "Ligação", "A receber". Na
// referência ela vem acima do título, em cinza pequeno: o olho lê a categoria
// antes do conteúdo e só desce nas linhas que interessam.
export function etiquetaDoEvento(evento) {
  if (evento.fonte === 'agendamento') return 'Serviço'
  if (evento.fonte === 'vencimento') return evento.tipo === 'entrada' ? 'A receber' : 'A pagar'
  return TIPOS_ATIVIDADE[evento.tipo] ?? 'Atividade'
}

function Concluir({ evento, onConcluir, className = '' }) {
  if (!onConcluir || !evento.pendente) return null
  return (
    <button
      type="button"
      onClick={() => onConcluir(evento)}
      title="Concluir"
      aria-label={`Concluir: ${evento.titulo}`}
      className={`inline-flex h-11 w-11 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 text-slate-400 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-600 cursor-pointer transition-colors ${className}`}
    >
      <IconCheck size={16} />
    </button>
  )
}

// Uma linha da lista do dia. O desenho segue a referência: ícone em bolha
// colorida, etiqueta do tipo por cima, título em destaque e horário embaixo.
// `acoes` recebe os botões que fazem sentido no contexto de quem chamou (o
// dashboard mostra menos que a página da agenda).
export function LinhaEvento({ evento, onAbrir, onConcluir, acoes }) {
  const estilo = estiloDoEvento(evento)
  const atrasado = evento.pendente && ehPassado(evento.data)
  const hora = formatHora(evento.hora)

  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${estilo.bolha}`}>
        <IconeDoEvento evento={evento} size={17} />
      </span>

      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[12px] text-slate-500">
          <span className="truncate">{etiquetaDoEvento(evento)}</span>
          {atrasado && <span className="font-medium text-red-600">· atrasado</span>}
          {evento.concluido && <span className="text-emerald-600">· concluído</span>}
          {evento.reagendado && <span className="text-slate-500">· reagendado</span>}
        </p>
        <button
          type="button"
          onClick={() => onAbrir?.(evento)}
          className={`block max-w-full truncate text-left text-[15px] font-medium leading-snug hover:text-blue-600 cursor-pointer ${estilo.texto}`}
        >
          {evento.titulo}
        </button>
        <p className="mt-0.5 truncate text-xs text-slate-500">
          <span className="tnum">{hora || 'Sem horário'}</span>
          {evento.detalhe && ' · '}
          {evento.clienteId ? (
            <Link to={`/clientes/${evento.clienteId}`} className="hover:text-blue-600">
              {evento.detalhe}
            </Link>
          ) : (
            evento.detalhe
          )}
          {evento.fonte === 'vencimento' && <span className="tnum"> · {formatBRL(evento.valor)}</span>}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Concluir evento={evento} onConcluir={onConcluir} />
        {acoes}
      </div>
    </li>
  )
}

// O cartão da linha do tempo: o mesmo evento, agora ancorado numa hora. A
// superfície é Gallery White como qualquer outro card; quem diz de que tipo ele
// é são o glifo e a etiqueta, não um retângulo tingido.
export function CartaoEvento({ evento, onAbrir, onConcluir }) {
  const estilo = estiloDoEvento(evento)
  const hora = formatHora(evento.hora)

  return (
    <article className={`rounded-2xl border p-3 ${estilo.cartao}`}>
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => onAbrir?.(evento)}
          className="min-w-0 flex-1 text-left cursor-pointer"
        >
          <p className={`truncate text-[15px] font-semibold leading-snug ${estilo.texto}`}>
            {evento.titulo}
          </p>
          <p className={`mt-0.5 text-[11px] font-medium ${estilo.etiqueta}`}>
            {etiquetaDoEvento(evento)}
          </p>
        </button>
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${estilo.bolha}`}>
          <IconeDoEvento evento={evento} size={15} />
        </span>
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-slate-500">
          <IconClock size={13} className="shrink-0" />
          <span className="tnum shrink-0">{hora || 'Sem horário'}</span>
          {evento.detalhe && <span className="truncate">· {evento.detalhe}</span>}
          {evento.fonte === 'vencimento' && <span className="tnum shrink-0">· {formatBRL(evento.valor)}</span>}
        </p>
        <Concluir evento={evento} onConcluir={onConcluir} className="h-8 w-8 sm:h-8 sm:w-8" />
      </div>
    </article>
  )
}
