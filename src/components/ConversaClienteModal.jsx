import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  contatoDaOportunidade, conversaDaOportunidade, carregarMensagens, mensagensDaConversa,
  marcarConversaLida, enviarMensagemWhatsapp, assinarWhatsapp,
} from '../data/repository.js'
import { Modal, Button, notificar } from './ui.jsx'
import ConversaWhatsApp from './ConversaWhatsApp.jsx'
import EtapaOportunidade from './EtapaOportunidade.jsx'

// A conversa de WhatsApp de uma negociação, sem sair da tela onde você está.
//
// No CRM, "falar com a pessoa" não devia custar uma navegação: você está
// olhando o quadro, decide cobrar uma resposta e volta para o quadro.
//
// Serve tanto para cliente cadastrado quanto para LEAD (número que escreveu e
// ainda não tem cadastro). A diferença aparece no cabeçalho: o cliente tem link
// para a ficha, o lead tem o botão de virar cliente.
export default function ConversaClienteModal({ oportunidade, onFechar, onMudouEtapa, onConverter }) {
  const [, forcarRender] = useState(0)
  const recarregar = () => forcarRender((n) => n + 1)
  const [carregando, setCarregando] = useState(true)
  const [enviando, setEnviando] = useState(false)

  const contato = contatoDaOportunidade(oportunidade)
  const conversa = conversaDaOportunidade(oportunidade)

  useEffect(() => assinarWhatsapp(recarregar), [])

  // Abrir a conversa é lê-la: busca o histórico e zera o contador.
  useEffect(() => {
    let ativo = true
    async function abrir() {
      if (!conversa?.id) {
        setCarregando(false)
        return
      }
      try {
        await carregarMensagens(conversa.id)
        await marcarConversaLida(conversa.id)
      } catch (falha) {
        notificar(falha?.message || String(falha), 'erro')
      } finally {
        if (ativo) { setCarregando(false); recarregar() }
      }
    }
    abrir()
    return () => { ativo = false }
  }, [conversa?.id])

  async function enviar(texto) {
    setEnviando(true)
    try {
      await enviarMensagemWhatsapp({
        conversaId: conversa?.id,
        clienteId: oportunidade.clienteId || undefined,
        // Lead sem conversa ainda não tem fio aberto; o número é o que temos.
        numero: conversa?.id ? undefined : oportunidade.contatoTelefone,
        oportunidadeId: oportunidade.id,
        texto,
      })
      recarregar()
    } catch (falha) {
      notificar(falha?.message || String(falha), 'erro')
    } finally {
      setEnviando(false)
    }
  }

  const paraExibir = {
    id: conversa?.id ?? null,
    clienteId: oportunidade.clienteId || null,
    clienteNome: contato.nome,
    numero: conversa?.numero || contato.telefone,
    mensagens: conversa?.id ? mensagensDaConversa(conversa.id) : [],
  }

  return (
    <Modal open size="wide" title={`WhatsApp — ${contato.nome}`} onClose={onFechar}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">{contato.telefone || 'Sem telefone'}</span>
          <EtapaOportunidade
            clienteId={oportunidade.clienteId}
            oportunidade={oportunidade}
            onMudou={() => { recarregar(); onMudouEtapa?.() }}
          />
        </div>

        {contato.lead ? (
          <Button
            variant="secondary"
            onClick={() => { onConverter?.(oportunidade); onFechar() }}
          >
            Transformar em cliente
          </Button>
        ) : (
          <Link
            to={`/clientes/${oportunidade.clienteId}`}
            onClick={onFechar}
            className="text-xs font-medium text-blue-600 hover:underline"
          >
            Abrir ficha do cliente
          </Link>
        )}
      </div>

      {/* Altura fixa: a conversa rola dentro do modal, e o campo de envio fica
          sempre visível no rodapé — sem ele descer junto com o histórico. */}
      <div className="h-[60svh] min-h-[22rem] rounded-xl border border-slate-200 bg-white overflow-hidden">
        {carregando ? (
          <p className="text-sm text-slate-500 text-center py-10">Carregando a conversa…</p>
        ) : (
          <ConversaWhatsApp
            conversa={paraExibir}
            onEnviar={enviar}
            aviso={
              enviando
                ? <p className="text-[11px] font-semibold text-slate-500">Enviando…</p>
                : (!paraExibir.numero
                    ? <p className="text-[11px] font-semibold text-amber-700">
                        Sem telefone para enviar — o envio vai falhar.
                      </p>
                    : null)
            }
          />
        )}
      </div>
    </Modal>
  )
}
