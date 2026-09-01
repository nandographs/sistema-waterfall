import { useEffect, useRef, useState } from 'react'
import { clientes } from '../data/repository.js'
import { MODELOS_MENSAGEM, aplicarModelo } from '../data/mensagens.js'
import { formatHora, rotuloRelativo, diaCurto } from '../lib/datas.js'
import { usuarioAtual } from '../lib/auth.js'
import { Button, inputCls } from './ui.jsx'
import { IconMais, IconCheck, IconFileText, IconUser } from './icons.jsx'

// Iniciais do nome: "Marina Alves" -> "MA". Duas letras no máximo, porque três
// já não se lê num círculo de 40px.
function iniciais(nome) {
  const partes = String(nome || '').trim().split(/\s+/).filter(Boolean)
  if (!partes.length) return ''
  const primeira = partes[0][0]
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : ''
  return (primeira + ultima).toUpperCase()
}

// Foto do cliente na conversa. A foto de perfil já vem no cache com a URL
// assinada (ver carregarDados), então é a mesma imagem da ficha — sem download
// novo e sem componente próprio de imagem.
//
// Sem foto, as iniciais; sem nome (número que não está no cadastro), o ícone
// genérico — que aqui diz algo: "não sei quem é".
export function AvatarConversa({ conversa, size = 40 }) {
  const cliente = conversa.clienteId ? clientes.get(conversa.clienteId) : null
  const nome = conversa.clienteNome || conversa.nomeWhatsapp || ''
  const letras = iniciais(nome)
  const estilo = { width: size, height: size }

  if (cliente?.fotoPerfilUrl) {
    return (
      <img
        src={cliente.fotoPerfilUrl}
        alt=""
        style={estilo}
        className="shrink-0 rounded-full object-cover border border-slate-200 bg-slate-100"
      />
    )
  }

  return (
    <span
      style={estilo}
      aria-hidden="true"
      className="shrink-0 inline-flex items-center justify-center rounded-full bg-slate-100 border border-slate-200 text-slate-500 font-semibold"
    >
      {letras ? (
        <span style={{ fontSize: Math.round(size * 0.36) }}>{letras}</span>
      ) : (
        <IconUser size={Math.round(size * 0.45)} />
      )}
    </span>
  )
}

// Separador de dia entre os balões — "Hoje", "Ontem" ou a data. Sem ele uma
// conversa de três dias vira um bloco só e você perde a noção de quando as
// coisas foram ditas.
function SeparadorDeDia({ dia }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="h-px flex-1 bg-slate-200" />
      <span className="text-[11px] font-semibold text-slate-400">
        {rotuloRelativo(dia) || diaCurto(dia)}
      </span>
      <span className="h-px flex-1 bg-slate-200" />
    </div>
  )
}

// Estado de entrega, só nas mensagens que saíram — igual ao WhatsApp, onde o
// tique é a resposta para "ele viu?".
function StatusEntrega({ status }) {
  if (status === 'falhou') return <span className="text-[10px] font-bold text-red-200">falhou</span>
  const lida = status === 'lida'
  const entregue = lida || status === 'entregue'
  return (
    <span className={`inline-flex -space-x-1.5 ${lida ? 'opacity-100' : 'opacity-70'}`} title={status}>
      <IconCheck size={12} />
      {entregue && <IconCheck size={12} />}
    </span>
  )
}

function Balao({ mensagem }) {
  const saiu = mensagem.direcao === 'saida'
  return (
    <div className={`flex ${saiu ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-3.5 py-2.5 ${
          saiu
            ? 'bg-blue-500 text-[var(--btn-primary-fg)] rounded-br-md'
            : 'bg-slate-100 text-slate-900 border border-slate-200 rounded-bl-md'
        }`}
      >
        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{mensagem.texto}</p>
        <div className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${saiu ? 'opacity-80' : 'text-slate-400'}`}>
          <span className="tnum">{formatHora(String(mensagem.ocorridoEm).slice(11, 16))}</span>
          {saiu && <StatusEntrega status={mensagem.status} />}
        </div>
      </div>
    </div>
  )
}

// Painel de conversa: o histórico e o campo de envio.
//
// Ele não sabe de onde vieram as mensagens — recebe a lista pronta e devolve o
// texto digitado em `onEnviar`. É por isso que a mesma peça serve para a prévia
// com dados fictícios de hoje e, depois, para a conversa real vinda do banco.
export default function ConversaWhatsApp({ conversa, onEnviar, aviso }) {
  const [texto, setTexto] = useState('')
  const fimRef = useRef(null)
  const campoRef = useRef(null)

  const mensagens = conversa?.mensagens ?? []

  // Rola para a última mensagem ao abrir a conversa e a cada mensagem nova —
  // conversa que abre no começo obriga a rolar até embaixo toda vez.
  useEffect(() => {
    fimRef.current?.scrollIntoView({ block: 'end' })
  }, [conversa?.id, mensagens.length])

  function usarModelo(modelo, e) {
    e.currentTarget.closest('details')?.removeAttribute('open')
    setTexto(
      aplicarModelo(modelo.texto, {
        cliente: (conversa?.clienteNome || conversa?.nomeWhatsapp || '').split(' ')[0],
        usuario: usuarioAtual(),
      }),
    )
    campoRef.current?.focus()
  }

  function enviar(e) {
    e.preventDefault()
    const limpo = texto.trim()
    if (!limpo) return
    onEnviar(limpo)
    setTexto('')
  }

  // Enter envia, Shift+Enter quebra linha — o hábito de qualquer mensageiro.
  function aoTeclar(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      enviar(e)
    }
  }

  let ultimoDia = ''

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-4 py-4 space-y-2">
        {mensagens.length === 0 && (
          <p className="text-sm text-slate-500 text-center py-10">Nenhuma mensagem nesta conversa.</p>
        )}
        {mensagens.map((mensagem) => {
          const dia = String(mensagem.ocorridoEm).slice(0, 10)
          const novoDia = dia !== ultimoDia
          ultimoDia = dia
          return (
            <div key={mensagem.id} className="space-y-2">
              {novoDia && <SeparadorDeDia dia={dia} />}
              <Balao mensagem={mensagem} />
            </div>
          )
        })}
        <div ref={fimRef} />
      </div>

      <form onSubmit={enviar} className="shrink-0 border-t border-slate-200 p-3 space-y-2">
        {aviso}

        <div className="flex items-end gap-2">
          <details className="relative shrink-0">
            <summary
              aria-label="Modelos de mensagem"
              title="Modelos de mensagem"
              className="list-none inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 [&::-webkit-details-marker]:hidden"
            >
              <IconFileText size={18} />
            </summary>
            <div className="absolute bottom-full left-0 z-20 mb-2 w-[19rem] rounded-xl border border-slate-300 bg-slate-100 p-1.5 shadow-xl shadow-black/30">
              <p className="px-3 pt-1 pb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                Modelos
              </p>
              {MODELOS_MENSAGEM.map((modelo) => (
                <button
                  key={modelo.id}
                  type="button"
                  onClick={(e) => usarModelo(modelo, e)}
                  className="block w-full rounded-lg px-3 py-2 text-left hover:bg-slate-200"
                >
                  <span className="block text-sm font-semibold text-slate-800">{modelo.rotulo}</span>
                  <span className="block text-xs text-slate-500 line-clamp-2">{modelo.texto}</span>
                </button>
              ))}
              <p className="px-3 pt-2 pb-1 text-[11px] text-slate-500">
                O texto entra no campo preenchido. Você edita antes de enviar.
              </p>
            </div>
          </details>

          <textarea
            ref={campoRef}
            className={`${inputCls} resize-none`}
            rows={2}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={aoTeclar}
            placeholder="Escreva uma mensagem…"
          />

          <Button type="submit" disabled={!texto.trim()} className="shrink-0">Enviar</Button>
        </div>
      </form>
    </div>
  )
}

// Cabeçalho da conversa — quem é, o número e o vínculo com o cadastro. Número
// sem cliente é o caso que precisa de ação, então ele aparece como convite para
// vincular, e não como um erro.
export function CabecalhoConversa({ conversa, onVoltar, acoes, onVincular }) {
  const identificado = !!conversa.clienteNome
  return (
    <header className="shrink-0 flex items-center gap-3 border-b border-slate-200 px-3 sm:px-4 py-3">
      {onVoltar && (
        <button
          type="button"
          onClick={onVoltar}
          className="lg:hidden -ml-1 inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
          aria-label="Voltar para as conversas"
        >
          ←
        </button>
      )}
      <AvatarConversa conversa={conversa} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900 truncate">
          {conversa.clienteNome || conversa.nomeWhatsapp || conversa.numero}
        </p>
        <p className="text-xs text-slate-500 truncate">
          {conversa.numero}
          {conversa.negociacao ? ` · ${conversa.negociacao}` : ''}
        </p>
      </div>
      {/* A etapa do CRM entra aqui: quem está lendo a conversa é quem sabe se o
          negócio andou. Ver EtapaOportunidade. */}
      {acoes}
      {!identificado && onVincular && (
        <button
          type="button"
          onClick={onVincular}
          className="shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-bold text-amber-800 cursor-pointer hover:bg-amber-100"
          title="Este número não está no cadastro"
        >
          Vincular a um cliente
        </button>
      )}
      <span className="hidden sm:inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400">
        <IconMais size={18} />
      </span>
    </header>
  )
}
