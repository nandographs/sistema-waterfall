import { useEffect, useState } from 'react'
import { Page, PageTitle, Badge, Empty, Button, Modal, notificar } from '../components/ui.jsx'
import { IconMessage, IconAlert } from '../components/icons.jsx'
import { formatHora, rotuloRelativo, diaCurto } from '../lib/datas.js'
import {
  clientes, conversasRecentes, carregarMensagens, mensagensDaConversa,
  marcarConversaLida, enviarMensagemWhatsapp, assinarWhatsapp, statusWhatsapp,
  vincularConversaACliente, oportunidadesDoCliente,
  ETAPAS_FUNIL, ETAPAS_ABERTAS,
} from '../data/repository.js'
import ConversaWhatsApp, { CabecalhoConversa, AvatarConversa } from '../components/ConversaWhatsApp.jsx'
import EtapaOportunidade from '../components/EtapaOportunidade.jsx'
import ClienteBusca from '../components/ClienteBusca.jsx'

// A caixa de entrada do WhatsApp.
//
// As mensagens chegam pela Edge Function `wa-webhook` (a Evolution Go avisa o
// servidor, não o navegador), e a tela descobre pelo Realtime — ver
// `assinarWhatsapp` no repositório. É a única tela do sistema em que o conteúdo
// muda sem ninguém ter clicado em nada.

// Rótulo de quando foi a última mensagem: hora se foi hoje, "Ontem", ou a data.
function quando(iso) {
  if (!iso) return ''
  const dia = String(iso).slice(0, 10)
  const relativo = rotuloRelativo(dia)
  if (relativo === 'Hoje') return formatHora(String(iso).slice(11, 16))
  return relativo || diaCurto(dia)
}

// Etapa do funil de um cliente, para mostrar na lista sem poder editar — na
// lista o que se quer é varrer, não mexer. Editar é no cabeçalho da conversa.
function etapaDoCliente(clienteId) {
  if (!clienteId) return null
  const doCliente = oportunidadesDoCliente(clienteId)
  const oportunidade = doCliente.find((o) => ETAPAS_ABERTAS.includes(o.etapa)) ?? doCliente[0]
  return oportunidade?.etapa ?? null
}

export default function WhatsApp() {
  const [, forcarRender] = useState(0)
  const recarregar = () => forcarRender((n) => n + 1)

  const [abertaId, setAbertaId] = useState(null)
  const [carregando, setCarregando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [conexao, setConexao] = useState(null)
  const [vincular, setVincular] = useState(null)

  const lista = conversasRecentes()
  const aberta = abertaId ? lista.find((c) => c.id === abertaId) ?? null : null
  const totalNaoLidas = lista.reduce((soma, c) => soma + Number(c.naoLidas || 0), 0)

  useEffect(() => assinarWhatsapp(recarregar), [])

  // O estado da conexão é consultado uma vez ao abrir a tela: é informação de
  // rodapé, não vale ficar batendo na Evolution a cada segundo.
  useEffect(() => {
    statusWhatsapp()
      .then(setConexao)
      // Falha ao PERGUNTAR não é o mesmo que estar desconectado, e tratar as
      // duas como iguais esconde o problema real — foi exatamente o que
      // aconteceu quando faltava CORS nas funções: o número estava conectado e
      // a tela dizia o contrário.
      .catch((falha) => setConexao({ indisponivel: true, erro: falha?.message || String(falha) }))
  }, [])

  // Abrir uma conversa é lê-la: busca o histórico e zera o contador.
  useEffect(() => {
    if (!abertaId) return
    let ativo = true
    setCarregando(true)
    ;(async () => {
      try {
        await carregarMensagens(abertaId)
        await marcarConversaLida(abertaId)
      } catch (falha) {
        notificar(falha?.message || String(falha), 'erro')
      } finally {
        if (ativo) { setCarregando(false); recarregar() }
      }
    })()
    return () => { ativo = false }
  }, [abertaId])

  async function enviar(texto) {
    setEnviando(true)
    try {
      await enviarMensagemWhatsapp({ conversaId: aberta.id, texto })
      recarregar()
    } catch (falha) {
      notificar(falha?.message || String(falha), 'erro')
    } finally {
      setEnviando(false)
    }
  }

  async function confirmarVinculo(clienteId) {
    try {
      await vincularConversaACliente(vincular.id, clienteId)
      notificar('Conversa vinculada ao cliente.')
      setVincular(null)
      recarregar()
    } catch (falha) {
      notificar(falha?.message || String(falha), 'erro')
    }
  }

  const conversaAberta = aberta
    ? {
        ...aberta,
        clienteNome: clientes.get(aberta.clienteId)?.nome || aberta.nomeWhatsapp || '',
        mensagens: mensagensDaConversa(aberta.id),
      }
    : null

  return (
    <Page>
      <PageTitle
        subtitle={
          totalNaoLidas
            ? `${totalNaoLidas} ${totalNaoLidas === 1 ? 'mensagem não lida' : 'mensagens não lidas'}`
            : 'Nenhuma mensagem não lida.'
        }
        action={
          conexao
            ? (
              <Badge color={conexao.conectado ? 'green' : (conexao.indisponivel ? 'amber' : 'red')}>
                {conexao.conectado
                  ? `Conectado${conexao.nome ? ` — ${conexao.nome}` : ''}`
                  : (conexao.indisponivel ? 'Não foi possível verificar' : 'Desconectado')}
              </Badge>
            )
            : null
        }
      >
        WhatsApp
      </PageTitle>

      {conexao && !conexao.conectado && (
        <p className={`mb-4 flex items-start gap-2 text-sm rounded-xl px-3.5 py-3 border ${
          conexao.indisponivel
            ? 'text-amber-700 bg-amber-50 border-amber-200'
            : 'text-red-700 bg-red-50 border-red-200'
        }`}>
          <IconAlert size={16} className="shrink-0 mt-0.5" />
          <span>
            {conexao.indisponivel
              ? 'Não consegui falar com o servidor do WhatsApp para saber o estado da conexão. As mensagens que já chegaram continuam aqui.'
              : 'O WhatsApp está desconectado — nada entra nem sai até religar o número.'}
            {conexao.erro ? ` (${conexao.erro})` : ''}
          </span>
        </p>
      )}

      {/* Duas colunas no desktop; no celular, a lista dá lugar à conversa
          escolhida — o painel lado a lado não cabe em 375px. */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden grid grid-cols-1 lg:grid-cols-[20rem_1fr] h-[70svh] min-h-[30rem]">
        <div className={`min-h-0 flex-col border-r border-slate-200 ${aberta ? 'hidden lg:flex' : 'flex'}`}>
          <header className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-slate-200">
            <IconMessage size={16} className="text-slate-400" />
            <h3 className="text-sm font-semibold text-slate-900">Conversas</h3>
          </header>

          <ul className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100">
            {lista.length === 0 && (
              <Empty>
                Nenhuma conversa ainda. Elas aparecem sozinhas quando alguém escrever para o número.
              </Empty>
            )}
            {lista.map((conversa) => {
              const ativa = conversa.id === abertaId
              const cliente = clientes.get(conversa.clienteId)
              const etapa = etapaDoCliente(conversa.clienteId)
              const nome = cliente?.nome || conversa.nomeWhatsapp || conversa.numero
              return (
                <li key={conversa.id}>
                  <button
                    type="button"
                    onClick={() => setAbertaId(conversa.id)}
                    className={`w-full text-left px-4 py-3 cursor-pointer flex items-start gap-3 ${
                      ativa ? 'bg-[var(--nav-active-bg)]' : 'hover:bg-slate-50'
                    }`}
                  >
                    <AvatarConversa conversa={{ ...conversa, clienteNome: cliente?.nome }} size={38} />

                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        {/* O item ativo usa a superfície azulada da navegação, que
                            é clara — o texto tem que trocar de cor junto, senão
                            some no tema escuro. */}
                        <span className={`text-sm font-semibold truncate ${ativa ? 'text-[var(--nav-active-fg)]' : 'text-slate-900'}`}>
                          {nome}
                        </span>
                        <span className={`shrink-0 text-[11px] tnum ${ativa ? 'text-[var(--nav-active-fg)] opacity-70' : 'text-slate-400'}`}>
                          {quando(conversa.ultimaEm)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2">
                        <span className={`text-xs truncate ${ativa ? 'text-[var(--nav-active-fg)] opacity-80' : 'text-slate-500'}`}>
                          {conversa.ultimaPrevia}
                        </span>
                        {Number(conversa.naoLidas || 0) > 0 && (
                          <span className="shrink-0 inline-flex min-w-5 h-5 items-center justify-center rounded-full bg-blue-500 px-1.5 text-[11px] font-bold text-[var(--btn-primary-fg)] tnum">
                            {conversa.naoLidas}
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {/* A etapa do funil na própria lista: dá para varrer a
                            caixa de entrada sabendo quem está em proposta e quem
                            é só suporte. */}
                        {etapa && (
                          <Badge color={etapa === 'ganho' ? 'green' : (etapa === 'perdido' ? 'red' : 'sky')}>
                            {ETAPAS_FUNIL[etapa] ?? etapa}
                          </Badge>
                        )}
                        {!cliente && (
                          <span className="inline-block rounded-md bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                            sem cadastro
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>

        <div className={`min-h-0 flex-col ${aberta ? 'flex' : 'hidden lg:flex'}`}>
          {conversaAberta ? (
            <>
              <CabecalhoConversa
                conversa={conversaAberta}
                onVoltar={() => setAbertaId(null)}
                onVincular={() => setVincular(aberta)}
                acoes={
                  aberta.clienteId ? (
                    <EtapaOportunidade clienteId={aberta.clienteId} onMudou={recarregar} />
                  ) : null
                }
              />
              {carregando ? (
                <p className="flex-1 text-sm text-slate-500 text-center py-10">Carregando a conversa…</p>
              ) : (
                <ConversaWhatsApp
                  conversa={conversaAberta}
                  onEnviar={enviar}
                  aviso={enviando ? <p className="text-[11px] font-semibold text-slate-500">Enviando…</p> : null}
                />
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-sm text-slate-500">Escolha uma conversa.</p>
            </div>
          )}
        </div>
      </div>

      {vincular && (
        <Modal open title="Vincular conversa a um cliente" onClose={() => setVincular(null)}>
          <p className="text-sm text-slate-600 mb-3">
            O número <strong>{vincular.numero}</strong> não casou com nenhum cadastro. Escolha de
            quem ele é — a partir daí a conversa aparece na ficha e no CRM desse cliente.
          </p>
          <ClienteBusca
            clientes={clientes.list()}
            value=""
            onChange={(id) => id && confirmarVinculo(id)}
          />
          <div className="flex justify-end mt-4">
            <Button variant="secondary" onClick={() => setVincular(null)}>Cancelar</Button>
          </div>
        </Modal>
      )}
    </Page>
  )
}
