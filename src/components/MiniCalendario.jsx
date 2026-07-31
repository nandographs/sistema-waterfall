import { gradeDoMes, mesDe, rotuloMes, mudarMes, DIAS_CURTOS, ehHoje, diaCurto } from '../lib/datas.js'
import { IconChevronLeft, IconChevronRight } from './icons.jsx'
import { estiloDoEvento } from './evento.jsx'

// Grade compacta de um mês, com um pontinho por evento no dia.
//
// Sem biblioteca de calendário de propósito: a grade é aritmética de datas
// (lib/datas.js) e um grid de 7 colunas. Uma dependência traria 200kb e um
// sistema de estilos brigando com o resto do sistema, para resolver isto aqui.
export default function MiniCalendario({
  mes,
  selecionado,
  eventosPorDia,
  onMudarMes,
  onSelecionar,
  compacto = false,
}) {
  const dias = gradeDoMes(mes)

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => onMudarMes?.(mudarMes(mes, -1))}
          className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
          aria-label="Mês anterior"
        >
          <IconChevronLeft size={16} />
        </button>
        <span className="text-[13px] font-semibold text-slate-900">{rotuloMes(mes)}</span>
        <button
          type="button"
          onClick={() => onMudarMes?.(mudarMes(mes, 1))}
          className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
          aria-label="Próximo mês"
        >
          <IconChevronRight size={16} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {DIAS_CURTOS.map((dia) => (
          <span key={dia} className="text-center text-[10px] font-medium text-slate-400 py-1">
            {dia.charAt(0)}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {dias.map((dia) => {
          const doMes = mesDe(dia) === mes
          const eventos = eventosPorDia?.get(dia) ?? []
          const ativo = dia === selecionado
          const hoje = ehHoje(dia)

          // No máximo 3 pontinhos: além disso viram ruído e o dia fica ilegível.
          const pontos = eventos.slice(0, 3)

          return (
            <button
              key={dia}
              type="button"
              onClick={() => onSelecionar?.(dia)}
              aria-label={diaCurto(dia)}
              aria-current={ativo ? 'date' : undefined}
              className={`flex flex-col items-center rounded-lg py-1 cursor-pointer ${compacto ? 'gap-0.5' : 'gap-1'} ${
                ativo
                  ? 'bg-blue-600 text-white'
                  : doMes
                    ? 'text-slate-700 hover:bg-slate-100'
                    : 'text-slate-300 hover:bg-slate-50'
              }`}
            >
              <span className={`text-xs tnum ${hoje && !ativo ? 'font-bold text-blue-600' : ''}`}>
                {Number(dia.slice(8, 10))}
              </span>
              <span className="flex items-center gap-0.5 h-1">
                {pontos.map((evento) => (
                  <span
                    key={evento.id}
                    className={`h-1 w-1 rounded-full ${ativo ? 'bg-white/80' : estiloDoEvento(evento).ponto}`}
                  />
                ))}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
