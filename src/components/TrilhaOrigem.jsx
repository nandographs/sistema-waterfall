import { trilhaDeOrigem, desdobramentosDe, TIPOS_ATIVIDADE, TIPOS_AGENDAMENTO, formatData } from '../data/repository.js'
import { IconOrigem } from './icons.jsx'

// "De onde isso veio" e "no que isso deu".
//
// É a corrente que responde a pergunta que sempre aparece três semanas depois:
// por que essa instalação foi marcada mesmo? Cada registro guarda apenas quem o
// originou (origem_atividade_id); a trilha inteira é reconstruída subindo esse
// vínculo até a raiz — ver trilhaDeOrigem no repositório.
export default function TrilhaOrigem({ registro, onAbrirAtividade }) {
  const trilha = trilhaDeOrigem(registro)
  if (trilha.length === 0) return null

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
        <IconOrigem size={13} /> Veio de
      </p>
      <ol className="space-y-1">
        {trilha.map((atividade, i) => (
          <li key={atividade.id} className="flex items-start gap-1.5 text-[13px]">
            <span className="text-slate-300 shrink-0" style={{ paddingLeft: `${i * 10}px` }}>↳</span>
            <button
              type="button"
              onClick={() => onAbrirAtividade?.(atividade)}
              className="text-left min-w-0 cursor-pointer hover:text-blue-600"
              disabled={!onAbrirAtividade}
            >
              <span className="font-medium text-slate-700">
                {TIPOS_ATIVIDADE[atividade.tipo] ?? 'Atividade'} em {formatData(atividade.data)}
              </span>
              {atividade.descricao && (
                <span className="text-slate-500"> — “{atividade.descricao}”</span>
              )}
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}

// O inverso: o que nasceu desta atividade.
export function Desdobramentos({ atividadeId, onAbrirAtividade }) {
  const { atividades, agendamentos, vendas } = desdobramentosDe(atividadeId)
  const total = atividades.length + agendamentos.length + vendas.length
  if (total === 0) return null

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
        Desdobramentos
      </p>
      <ul className="space-y-1 text-[13px]">
        {atividades.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => onAbrirAtividade?.(a)}
              className="text-left cursor-pointer text-slate-700 hover:text-blue-600"
              disabled={!onAbrirAtividade}
            >
              {TIPOS_ATIVIDADE[a.tipo] ?? 'Atividade'} em {formatData(a.data)}
              {a.status === 'pendente' && <span className="text-amber-600"> · em aberto</span>}
            </button>
          </li>
        ))}
        {agendamentos.map((ag) => (
          <li key={ag.id} className="text-slate-700">
            {TIPOS_AGENDAMENTO[ag.tipo] ?? ag.tipo} em {formatData(ag.data)}
          </li>
        ))}
        {vendas.map((v) => (
          <li key={v.id} className="text-slate-700">
            Venda {v.numero || ''} em {formatData(v.data)}
          </li>
        ))}
      </ul>
    </div>
  )
}
