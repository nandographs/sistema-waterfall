// A superfície do calendário: grade do mês, faixa da semana e linha do tempo
// do dia. São três formas de olhar para os mesmos eventos, e por isso moram
// juntas — mudar a cor de um ponto aqui muda as três ao mesmo tempo.
//
// O desenho é o do aplicativo de agenda que serviu de referência: sem grade de
// linhas, sem caixas. O que marca um dia é o número; o que diz que existe algo
// nele é um ponto. A moldura só aparece onde ela carrega informação — no cartão
// do evento, que tem a cor do tipo.

import { gradeDoMes, semanaDe, mesDe, diaDaSemana, ehHoje, DIAS_CURTOS } from '../lib/datas.js'
import { CartaoEvento, estiloDoEvento } from './evento.jsx'

// O número do dia. Selecionado vira pílula sólida (o contraste invertido do
// tema); hoje, quando não é o selecionado, fica no azul da marca.
function numeroDoDia(dia, { ativo, doMes }) {
  if (ativo) return 'bg-slate-900 text-slate-50 font-semibold'
  if (ehHoje(dia)) return 'text-blue-600 font-semibold'
  if (!doMes) return 'text-slate-400/70'
  return 'text-slate-700 font-medium'
}

function Pontos({ eventos, max = 3 }) {
  return (
    <span className="flex h-1.5 items-center justify-center gap-[3px]">
      {eventos.slice(0, max).map((evento) => (
        <span key={evento.id} className={`h-1.5 w-1.5 rounded-full ${estiloDoEvento(evento).ponto}`} />
      ))}
    </span>
  )
}

export function GradeDoMes({ mes, selecionado, porDia, onSelecionar }) {
  const dias = gradeDoMes(mes)

  return (
    <div>
      <div className="grid grid-cols-7">
        {DIAS_CURTOS.map((dia) => (
          <span key={dia} className="py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            {dia}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {dias.map((dia) => {
          const doMes = mesDe(dia) === mes
          const eventos = porDia.get(dia) ?? []
          const ativo = dia === selecionado

          return (
            <button
              key={dia}
              type="button"
              onClick={() => onSelecionar(dia)}
              aria-current={ativo ? 'date' : undefined}
              className="group flex flex-col items-center gap-1 rounded-xl py-1.5 lg:py-2.5 cursor-pointer hover:bg-slate-100"
            >
              <span
                className={`inline-flex h-9 w-9 items-center justify-center rounded-full text-sm tnum lg:h-10 lg:w-10 lg:text-[15px] ${numeroDoDia(dia, { ativo, doMes })}`}
              >
                {Number(dia.slice(8, 10))}
              </span>
              <Pontos eventos={eventos} />
            </button>
          )
        })}
      </div>
    </div>
  )
}

// A faixa da semana que abre o painel do dia: sete colunas, o dia escolhido em
// pílula sólida. É o cabeçalho de navegação de quem já está olhando um dia — no
// celular ela substitui a grade inteira do mês.
export function FaixaDaSemana({ selecionado, porDia, onSelecionar }) {
  const dias = semanaDe(selecionado)

  return (
    <div className="grid grid-cols-7 gap-1">
      {dias.map((dia) => {
        const ativo = dia === selecionado
        const eventos = porDia.get(dia) ?? []
        return (
          <button
            key={dia}
            type="button"
            onClick={() => onSelecionar(dia)}
            aria-current={ativo ? 'date' : undefined}
            className="flex flex-col items-center gap-1.5 rounded-xl py-1.5 cursor-pointer hover:bg-slate-100"
          >
            <span className={`text-[11px] font-semibold uppercase ${ehHoje(dia) ? 'text-blue-600' : 'text-slate-400'}`}>
              {DIAS_CURTOS[diaDaSemana(dia)]}
            </span>
            <span
              className={`inline-flex h-9 w-9 items-center justify-center rounded-full text-sm tnum ${numeroDoDia(dia, { ativo, doMes: true })}`}
            >
              {Number(dia.slice(8, 10))}
            </span>
            <Pontos eventos={eventos} max={2} />
          </button>
        )
      })}
    </div>
  )
}

// ---- Linha do tempo ----

const horaDoEvento = (evento) => {
  const h = Number(String(evento.hora || '').slice(0, 2))
  return Number.isFinite(h) && String(evento.hora || '').includes(':') ? h : null
}

// A faixa de horas desenhada: uma hora de folga antes do primeiro compromisso e
// uma depois do último. Uma coluna fixa das 7h às 19h gastaria meia tela com
// horas vazias no celular — e horas vazias não dizem nada.
function faixaDeHoras(eventos) {
  const horas = eventos.map(horaDoEvento).filter((h) => h !== null)
  if (horas.length === 0) return []
  const inicio = Math.max(0, Math.min(...horas) - 1)
  const fim = Math.min(23, Math.max(...horas) + 1)
  return Array.from({ length: fim - inicio + 1 }, (_, i) => inicio + i)
}

// A posição do "agora" dentro da sua hora, em porcentagem. É o traço pontilhado
// da referência: diz onde você está no dia sem precisar ler o relógio.
function agoraNaHora(hora) {
  const agora = new Date()
  if (agora.getHours() !== hora) return null
  return (agora.getMinutes() / 60) * 100
}

export function LinhaDoTempo({ eventos, mostrarAgora, onAbrir, onConcluir }) {
  const semHora = eventos.filter((e) => horaDoEvento(e) === null)
  const comHora = eventos.filter((e) => horaDoEvento(e) !== null)
  const horas = faixaDeHoras(comHora)

  return (
    <div className="space-y-3">
      {semHora.length > 0 && (
        <div className="space-y-2">
          {/* O rótulo só faz sentido quando há um "com horário" do outro lado:
              num dia em que nada tem hora marcada, ele seria uma legenda para a
              única coisa que existe na tela. */}
          {horas.length > 0 && (
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Sem horário</p>
          )}
          {semHora.map((evento) => (
            <CartaoEvento key={evento.id} evento={evento} onAbrir={onAbrir} onConcluir={onConcluir} />
          ))}
        </div>
      )}

      <div>
        {horas.map((hora) => {
          const doHorario = comHora.filter((e) => horaDoEvento(e) === hora)
          const agora = mostrarAgora ? agoraNaHora(hora) : null

          return (
            <div key={hora} className="relative flex gap-3 border-t border-slate-200/70 py-2 first:border-t-0">
              <span className="w-10 shrink-0 pt-1 text-right text-[11px] font-semibold tnum text-slate-400">
                {String(hora).padStart(2, '0')}h
              </span>
              <div className="min-h-[44px] flex-1 space-y-2">
                {doHorario.map((evento) => (
                  <CartaoEvento key={evento.id} evento={evento} onAbrir={onAbrir} onConcluir={onConcluir} />
                ))}
              </div>
              {agora !== null && (
                <span
                  className="pointer-events-none absolute inset-x-0 flex items-center"
                  style={{ top: `${agora}%` }}
                  aria-hidden="true"
                >
                  <span className="ml-8 h-2 w-2 shrink-0 rounded-full bg-red-500" />
                  <span className="h-px flex-1 bg-red-500/60" />
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
