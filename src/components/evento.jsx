// Vocabulário visual da agenda.
//
// Atividades, serviços e vencimentos dividem o mesmo calendário, então dividem
// também o mesmo desenho: uma cor, um ícone e uma linha. Concentrar isso aqui é
// o que faz a grade do mês, o painel do dia e o bloco "Hoje" do dashboard
// parecerem a mesma coisa em tamanhos diferentes.

import { Link } from 'react-router-dom'
import {
  IconPhone, IconMessage, IconMail, IconCheckSquare, IconNote,
  IconUser, IconUsersRound, IconCalendar, IconWallet, IconCheck,
} from './icons.jsx'
import { formatHora, ehPassado } from '../lib/datas.js'
import { formatBRL } from '../data/repository.js'

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

// Um evento atrasado é vermelho ANTES de ser qualquer outra coisa: essa é a
// informação que muda o que você faz agora.
export function estiloDoEvento(evento) {
  if (evento.cancelado) return { ponto: 'bg-slate-200', texto: 'text-slate-400 line-through', icone: 'text-slate-300' }
  if (evento.concluido) return { ponto: 'bg-slate-300', texto: 'text-slate-400', icone: 'text-slate-400' }
  if (evento.pendente && ehPassado(evento.data)) return { ponto: 'bg-red-500', texto: 'text-slate-900', icone: 'text-red-500' }
  if (evento.fonte === 'agendamento') return { ponto: 'bg-blue-500', texto: 'text-slate-900', icone: 'text-blue-600' }
  if (evento.fonte === 'vencimento') return { ponto: 'bg-violet-500', texto: 'text-slate-900', icone: 'text-violet-600' }
  return { ponto: 'bg-emerald-500', texto: 'text-slate-900', icone: 'text-emerald-600' }
}

// A hora ocupa uma coluna de largura fixa para os itens do dia se alinharem
// mesmo quando alguns não têm horário marcado.
function Horario({ evento }) {
  const hora = formatHora(evento.hora)
  return (
    <span className={`w-11 shrink-0 text-xs tnum pt-0.5 ${hora ? 'text-slate-500 font-medium' : 'text-slate-300'}`}>
      {hora || '—'}
    </span>
  )
}

// Uma linha do painel do dia. `acoes` recebe os botões que fazem sentido no
// contexto de quem chamou (o dashboard mostra menos que a página da agenda).
export function LinhaEvento({ evento, onAbrir, onConcluir, acoes }) {
  const estilo = estiloDoEvento(evento)
  const atrasado = evento.pendente && ehPassado(evento.data)

  return (
    <li className="py-2.5 flex items-start gap-2.5">
      <Horario evento={evento} />

      <IconeDoEvento evento={evento} className={`mt-0.5 shrink-0 ${estilo.icone}`} />

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => onAbrir?.(evento)}
          className={`block text-left text-sm font-medium hover:text-blue-600 cursor-pointer ${estilo.texto}`}
        >
          {evento.titulo}
        </button>
        <p className="text-xs text-slate-500 mt-0.5 truncate">
          {evento.clienteId ? (
            <Link to={`/clientes/${evento.clienteId}`} className="hover:text-blue-600">
              {evento.detalhe}
            </Link>
          ) : (
            evento.detalhe
          )}
          {evento.fonte === 'vencimento' && (
            <span className="tnum"> · {formatBRL(evento.valor)}</span>
          )}
          {atrasado && <span className="text-red-600 font-medium"> · atrasado</span>}
        </p>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {onConcluir && evento.pendente && (
          <button
            type="button"
            onClick={() => onConcluir(evento)}
            title="Concluir"
            aria-label={`Concluir: ${evento.titulo}`}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 cursor-pointer"
          >
            <IconCheck size={16} />
          </button>
        )}
        {acoes}
      </div>
    </li>
  )
}
