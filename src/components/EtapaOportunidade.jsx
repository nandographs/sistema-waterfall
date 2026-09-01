import { useState } from 'react'
import {
  oportunidadesDoCliente, moverOportunidade, reabrirOportunidade,
  ETAPAS_FUNIL, ETAPAS_ABERTAS, ETAPAS_FECHADAS,
} from '../data/repository.js'
import { Badge, notificar } from './ui.jsx'
import { IconPlus } from './icons.jsx'
import OportunidadeModal, { FecharOportunidadeModal, oportunidadeNova } from './OportunidadeModal.jsx'

const COR_DA_ETAPA = (etapa) =>
  etapa === 'ganho' ? 'green' : (etapa === 'perdido' ? 'red' : 'sky')

// A etapa do funil onde este cliente está, editável no lugar em que você
// estiver.
//
// CRM e WhatsApp são a mesma operação vista de dois ângulos: quem está lendo a
// conversa acabou de descobrir se o negócio andou ou não, e é ali — não depois,
// em outra tela — que a etapa deveria mudar. Por isso este controle vive fora
// do quadro e escreve no mesmo lugar que ele.
//
// Fechar (ganho/perdido) continua passando pelo modal de fechamento: a regra do
// motivo obrigatório e a oferta de abrir a venda valem venha de onde vier.
export default function EtapaOportunidade({ clienteId, oportunidade: fixa, onMudou, className = '' }) {
  const [form, setForm] = useState(null)
  const [fechando, setFechando] = useState(null)

  const doCliente = oportunidadesDoCliente(clienteId)
  // `fixa` vem de quem já sabe de qual negociação está falando — o cartão do
  // funil, inclusive quando ela é um lead e não tem cliente para procurar.
  // Sem ela, a negociação que importa é a aberta; sem nenhuma aberta, a última
  // fechada, que ainda conta a história ("perdido em agosto").
  const oportunidade =
    fixa ?? doCliente.find((o) => ETAPAS_ABERTAS.includes(o.etapa)) ?? doCliente[0] ?? null

  async function escolher(etapa, e) {
    e.currentTarget.closest('details')?.removeAttribute('open')
    if (etapa === oportunidade.etapa) return

    if (ETAPAS_FECHADAS.includes(etapa)) {
      setFechando({ oportunidade, etapa })
      return
    }
    try {
      if (ETAPAS_FECHADAS.includes(oportunidade.etapa)) {
        await reabrirOportunidade(oportunidade.id, etapa)
      }
      await moverOportunidade(oportunidade.id, etapa, null)
      notificar(`Negociação movida para "${ETAPAS_FUNIL[etapa]}".`)
      onMudou?.()
    } catch (ex) {
      notificar(ex?.message || String(ex), 'erro')
    }
  }

  const itemMenu =
    'flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-200'

  return (
    <div className={`shrink-0 ${className}`}>
      {oportunidade ? (
        <details className="relative">
          <summary
            title={`Etapa no CRM: ${ETAPAS_FUNIL[oportunidade.etapa]} — clique para mudar`}
            className="list-none cursor-pointer [&::-webkit-details-marker]:hidden"
          >
            <Badge color={COR_DA_ETAPA(oportunidade.etapa)}>
              {ETAPAS_FUNIL[oportunidade.etapa] ?? oportunidade.etapa} ▾
            </Badge>
          </summary>
          <div className="absolute right-0 z-30 mt-1.5 w-56 rounded-xl border border-slate-300 bg-slate-100 p-1.5 shadow-xl shadow-black/30">
            <p className="px-3 pt-1 pb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
              Mover no CRM
            </p>
            {[...ETAPAS_ABERTAS, ...ETAPAS_FECHADAS].map((etapa) => (
              <button
                key={etapa}
                type="button"
                className={`${itemMenu} ${etapa === oportunidade.etapa ? 'text-blue-600' : ''}`}
                onClick={(e) => escolher(etapa, e)}
              >
                {ETAPAS_FUNIL[etapa]}
                {etapa === oportunidade.etapa && <span className="ml-auto text-xs">atual</span>}
              </button>
            ))}
            <button
              type="button"
              className={`${itemMenu} border-t border-slate-200 mt-1 pt-1`}
              onClick={(e) => {
                e.currentTarget.closest('details')?.removeAttribute('open')
                setForm(oportunidade)
              }}
            >
              Abrir negociação
            </button>
          </div>
        </details>
      ) : (
        <button
          type="button"
          onClick={() => setForm(oportunidadeNova({ clienteId, canal: 'whatsapp' }))}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-200 cursor-pointer"
          title="Este cliente não tem negociação aberta"
        >
          <IconPlus size={12} /> Negociação
        </button>
      )}

      {form && (
        <OportunidadeModal
          key={form.id || 'nova'}
          oportunidade={form}
          onFechar={() => setForm(null)}
          onSalvo={onMudou}
        />
      )}

      {fechando && (
        <FecharOportunidadeModal
          oportunidade={fechando.oportunidade}
          etapa={fechando.etapa}
          onFechar={() => setFechando(null)}
          onSalvo={onMudou}
        />
      )}
    </div>
  )
}
