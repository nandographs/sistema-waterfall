import { useState } from 'react'
import {
  oportunidadesDoCliente, moverOportunidade, reabrirOportunidade,
  gruposDeEtapas, rotularNegocio, funis,
  negocioAberto, etapaFechada,
} from '../data/repository.js'
import { notificar } from './ui.jsx'
import { IconPlus } from './icons.jsx'
import EtiquetaFunil, { BolinhaFunil } from './EtiquetaFunil.jsx'
import OportunidadeModal, { FecharOportunidadeModal, oportunidadeNova } from './OportunidadeModal.jsx'

// A etapa do funil onde este cliente está, editável no lugar em que você
// estiver.
//
// CRM e WhatsApp são a mesma operação vista de dois ângulos: quem está lendo a
// conversa acabou de descobrir se o negócio andou ou não, e é ali — não depois,
// em outra tela — que a etapa deveria mudar. Por isso este controle vive fora
// do quadro e escreve no mesmo lugar que ele.
//
// O botão mostra a cor e o nome do funil junto da etapa ("Vendas · Proposta"),
// e o menu lista as etapas de todos os funis: dá para levar o cliente de um
// funil para outro daqui mesmo.
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
  const oportunidade = fixa ?? doCliente.find(negocioAberto) ?? doCliente[0] ?? null
  const rotulo = oportunidade ? rotularNegocio(oportunidade) : null
  const grupos = gruposDeEtapas({ primeiro: oportunidade?.funilId })
  const variosFunis = funis.list().length > 1

  async function escolher(funilId, etapa, e) {
    e.currentTarget.closest('details')?.removeAttribute('open')
    if (funilId === oportunidade.funilId && etapa === oportunidade.etapa) return

    if (etapaFechada(etapa)) {
      setFechando({ oportunidade, etapa, funilId })
      return
    }
    try {
      if (etapaFechada(oportunidade.etapa)) {
        await reabrirOportunidade(oportunidade.id, etapa, funilId)
      }
      await moverOportunidade(oportunidade.id, etapa, null, funilId)
      const destino = rotularNegocio({ funilId, etapa })
      notificar(`Negociação movida para "${variosFunis ? `${destino?.funil} › ` : ''}${destino?.etapa}".`)
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
            title={`No CRM: ${rotulo ? `${rotulo.funil} · ${rotulo.etapa}` : oportunidade.etapa} — clique para mudar`}
            className="list-none cursor-pointer [&::-webkit-details-marker]:hidden"
          >
            {rotulo ? (
              <EtiquetaFunil cor={rotulo.cor} funil={variosFunis ? rotulo.funil : ''} etapa={rotulo.etapa} className="hover:brightness-95">
                <span aria-hidden="true" className="opacity-60">▾</span>
              </EtiquetaFunil>
            ) : (
              <span className="text-[12px] font-medium text-slate-500">{oportunidade.etapa} ▾</span>
            )}
          </summary>
          <div className="absolute right-0 z-30 mt-1.5 w-60 max-h-[24rem] overflow-y-auto rounded-2xl superficie-flutuante p-1.5">
            {grupos.map(({ funil, etapas }) => (
              <div key={funil.id}>
                <p className="flex items-center gap-1.5 px-3 pt-1.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {variosFunis && <BolinhaFunil cor={funil.cor} tamanho={7} />}
                  {variosFunis ? funil.nome : 'Mover no CRM'}
                </p>
                {etapas.map((etapa) => {
                  const atual = funil.id === oportunidade.funilId && etapa.chave === oportunidade.etapa
                  return (
                    <button
                      key={etapa.id}
                      type="button"
                      className={`${itemMenu} ${atual ? 'text-blue-600' : ''}`}
                      onClick={(e) => escolher(funil.id, etapa.chave, e)}
                    >
                      {etapa.nome}
                      {atual && <span className="ml-auto text-xs">atual</span>}
                    </button>
                  )
                })}
              </div>
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
          funilId={fechando.funilId}
          onFechar={() => setFechando(null)}
          onSalvo={onMudou}
        />
      )}
    </div>
  )
}
