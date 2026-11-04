import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Modal, Button } from './ui.jsx'
import { IconAlert, IconCheck } from './icons.jsx'
import { statusWhatsapp, conectarWhatsapp } from '../data/repository.js'

// A conexão do WhatsApp vista pela tela: o aviso quando ela falha e o QR para
// parear.
//
// POR QUE EXISTE: de 24/09 a 30/10/2026 o sistema não recebeu uma mensagem, e o
// único lugar que poderia ter avisado era uma etiqueta no rodapé da caixa de
// entrada — que dizia "Conectado", porque estava. O defeito era o webhook, não a
// conexão. Agora o aviso olha as duas coisas e aparece em qualquer tela.

const quando = (iso) =>
  iso
    ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : ''

// O que há de errado, em uma frase — ou null quando está tudo certo.
export function problemaDaConexao(conexao) {
  if (!conexao) return null
  if (conexao.indisponivel) {
    return {
      grave: false,
      texto: `Não consegui verificar o WhatsApp${conexao.erro ? ` (${conexao.erro})` : ''}. As mensagens que já chegaram continuam aqui.`,
    }
  }
  if (!conexao.conectado) {
    return {
      grave: true,
      texto: `O WhatsApp está desconectado${conexao.motivo ? ` — ${conexao.motivo}` : ''}. Nada entra nem sai até conectar o número de novo.`,
    }
  }
  if (conexao.mudo) {
    return {
      grave: true,
      texto: `O número está conectado, mas as mensagens pararam de chegar ao sistema${conexao.ultimoEventoEm ? ` desde ${quando(conexao.ultimoEventoEm)}` : ''}. O recebimento foi reconfigurado agora; se o aviso continuar, reconecte o número.`,
    }
  }
  return null
}

// Pergunta o estado ao abrir e a cada 5 minutos, só com a aba visível —
// ninguém precisa de verificação em aba esquecida no fundo.
const INTERVALO_MS = 5 * 60 * 1000

export function useConexaoWhatsapp() {
  const [conexao, setConexao] = useState(null)

  async function verificar() {
    try {
      setConexao(await statusWhatsapp())
    } catch (falha) {
      // Falha ao PERGUNTAR não é o mesmo que estar desconectado, e tratar as
      // duas como iguais esconde o problema real — foi exatamente o que
      // aconteceu quando faltava CORS nas funções: o número estava conectado e
      // a tela dizia o contrário.
      setConexao({ indisponivel: true, erro: falha?.message || String(falha) })
    }
  }

  useEffect(() => {
    verificar()
    const relogio = setInterval(() => {
      if (document.visibilityState === 'visible') verificar()
    }, INTERVALO_MS)
    return () => clearInterval(relogio)
  }, [])

  return [conexao, verificar]
}

// A faixa que aparece em QUALQUER tela quando o WhatsApp tem problema. Na caixa
// de entrada ela sai: lá o aviso é maior e tem o botão de conectar.
export function AvisoWhatsapp() {
  const { pathname } = useLocation()
  const [conexao] = useConexaoWhatsapp()
  const problema = problemaDaConexao(conexao)
  if (!problema?.grave || pathname.startsWith('/whatsapp')) return null

  return (
    // Mesmas margens e largura máxima do `Page`, para a faixa alinhar com o
    // conteúdo logo abaixo dela.
    <div className="px-4 sm:px-6 lg:px-8 pt-4 max-w-[1480px] mx-auto w-full">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-slate-200 bg-slate-100 px-3.5 py-2.5 text-sm text-red-600">
        <IconAlert size={16} className="shrink-0" />
        <span className="min-w-0 flex-1">{problema.texto}</span>
        <Link to="/whatsapp" className="shrink-0 font-semibold text-blue-600 hover:underline">
          Ver o WhatsApp
        </Link>
      </div>
    </div>
  )
}

// Ler o QR do número novo.
//
// Abre a conexão JÁ com o webhook configurado (ver wa-status) e vai buscando o
// estado a cada poucos segundos: o QR troca a cada ~20 s, e quando alguém lê,
// a mesma consulta responde "conectado". Depois disso a janela fica aberta
// mostrando o histórico entrando — é a prova de que o recebimento funciona.
const INTERVALO_QR_MS = 4000

export function ModalConectar({ open, onClose, onConectou }) {
  const [qr, setQr] = useState(null)
  const [erro, setErro] = useState('')
  const [conectado, setConectado] = useState(null)

  useEffect(() => {
    if (!open) return
    let ativo = true
    setQr(null); setErro(''); setConectado(null)

    conectarWhatsapp()
      .then((dados) => { if (ativo && dados?.qr) setQr(dados.qr) })
      .catch((falha) => { if (ativo) setErro(falha?.message || String(falha)) })

    const relogio = setInterval(async () => {
      try {
        const estado = await statusWhatsapp()
        if (!ativo) return
        if (estado.conectado) {
          setConectado(estado)
          setQr(null)
          onConectou?.(estado)
        } else if (estado.qr) {
          setQr(estado.qr)
        }
      } catch { /* a próxima volta tenta de novo */ }
    }, INTERVALO_QR_MS)

    return () => { ativo = false; clearInterval(relogio) }
  }, [open])

  return (
    <Modal title="Conectar o número do WhatsApp" open={open} onClose={onClose}>
      {conectado ? (
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-green-600">
            <IconCheck size={16} />
            Conectado{conectado.nome ? ` — ${conectado.nome}` : ''}
          </p>
          <p className="text-sm text-slate-600">
            O celular está mandando as conversas que já existiam. Elas aparecem na caixa de entrada
            conforme chegam — pode levar alguns minutos. Deixe o celular ligado e com internet.
          </p>
          <p className="text-sm text-slate-900 tnum">
            {conectado.historicoMensagens
              ? `${conectado.historicoMensagens} mensagens do histórico já entraram.`
              : 'Esperando o primeiro lote do histórico…'}
          </p>
          <div className="flex justify-end pt-2">
            <Button onClick={onClose}>Concluir</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <ol className="list-decimal pl-5 space-y-1 text-sm text-slate-600">
            <li>No celular do número novo, abra o WhatsApp.</li>
            <li>Toque em <strong>Configurações → Dispositivos conectados → Conectar dispositivo</strong>.</li>
            <li>Aponte a câmera para o código abaixo.</li>
          </ol>

          <div className="flex justify-center">
            {qr ? (
              <img src={qr} alt="QR code para conectar o WhatsApp" className="h-64 w-64 rounded-xl border border-slate-200 bg-white p-2" />
            ) : (
              <div className="flex h-64 w-64 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 px-6 text-center text-sm text-slate-500">
                {erro || 'Gerando o código…'}
              </div>
            )}
          </div>

          <p className="text-xs text-slate-500">
            Conecte sempre por aqui, e não pelo painel da Evolution: é aqui que o sistema configura o
            recebimento das mensagens junto com a conexão.
          </p>
          <div className="flex justify-end">
            <Button variant="secondary" onClick={onClose}>Fechar</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
