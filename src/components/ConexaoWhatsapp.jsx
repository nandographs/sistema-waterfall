import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Modal, Button } from './ui.jsx'
import { IconAlert, IconCheck } from './icons.jsx'
import { statusWhatsapp, conectarWhatsapp, numerosWhatsapp } from '../data/repository.js'

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
  // Quem ainda não conectou o próprio celular não tem número "caído": tem um
  // convite a conectar. Não é grave — não aparece nas outras telas.
  if (conexao.semNumero) {
    return { grave: false, semNumero: true, texto: 'Você ainda não conectou o seu número de WhatsApp.' }
  }
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

// `instancia`: o número a vigiar. Vazio, vale o número em uso (ou o da pessoa).
export function useConexaoWhatsapp(instancia = '') {
  const [conexao, setConexao] = useState(null)

  async function verificar() {
    try {
      setConexao(await statusWhatsapp({ instancia }))
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
  }, [instancia])

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

// Quanto esperar pelo PRIMEIRO código antes de dizer que ele não vem. A
// Evolution costuma gerar em poucos segundos; meio minuto sem nada é sessão
// presa no servidor, não lentidão.
const ESPERA_PELO_QR_MS = 30_000

// Quantas consultas seguidas sem código, depois de ter havido um, contam como
// "expirou". Uma só pode ser um soluço da Evolution no meio da troca de código.
const FALTAS_PARA_EXPIRAR = 2

// POR QUE OS AVISOS: em 11/2026 a janela ficou em "Gerando o código…" para
// sempre. A Evolution Go não tinha QR para dar — a sessão anterior tinha ficado
// presa no servidor, e nessa situação o `connect` só regrava o webhook, sem
// gerar código novo. A janela não dizia nada. E quando o código expirava sem
// ser lido, ela continuava mostrando o último, que já não funcionava.
const SEM_CODIGO =
  'A Evolution não gerou o código. Se isso se repetir, a sessão anterior ficou presa no servidor: ' +
  'reinicie a Evolution Go no painel da VPS e tente de novo.'
const EXPIROU = 'O código expirou sem ser lido. Gere outro para tentar de novo.'

// `instancia`: reconectar esse número. `novo`: conectar o PRÓPRIO celular de
// quem está logado — se a pessoa ainda não tem número, ele nasce aqui.
export function ModalConectar({ open, onClose, onConectou, instancia = '', novo = false }) {
  const [qr, setQr] = useState(null)
  const [erro, setErro] = useState('')
  const [conectado, setConectado] = useState(null)
  // Muda a cada "Tentar de novo" — é o que faz o efeito pedir a conexão outra vez.
  const [tentativa, setTentativa] = useState(0)

  useEffect(() => {
    if (!open) return
    let ativo = true
    let viuQr = false
    let faltas = 0
    // Depois de um aviso, para de procurar código: só quem clica em "Tentar de
    // novo" recomeça. A consulta continua para notar se o número conectou.
    let desistiu = false
    const inicio = Date.now()
    // O número que está sendo conectado. Com `novo`, só se sabe qual é depois
    // da resposta do conectar — e até lá a consulta NÃO roda: sem alvo, ela
    // cairia no número em uso e mostraria o QR de outro número.
    let alvo = novo ? '' : instancia
    setQr(null); setErro(''); setConectado(null)

    const mostrarQr = (codigo) => {
      viuQr = true
      faltas = 0
      setQr(codigo)
      setErro('')
    }
    const avisar = (texto) => {
      desistiu = true
      setQr(null)
      setErro(texto)
    }

    conectarWhatsapp({ instancia, novo })
      .then((dados) => {
        if (!ativo) return
        alvo = dados?.instancia || alvo
        if (!desistiu && dados?.qr) mostrarQr(dados.qr)
      })
      .catch((falha) => { if (ativo) avisar(falha?.message || String(falha)) })

    const relogio = setInterval(async () => {
      if (novo && !alvo) return
      try {
        // Depois de desistir não pede mais o QR: lê-lo sobe a instância na
        // Evolution. Só confere se o número conectou.
        const estado = await statusWhatsapp({ comQr: !desistiu, instancia: alvo })
        if (!ativo) return
        if (estado.conectado) {
          setConectado(estado)
          setQr(null)
          setErro('')
          onConectou?.(estado)
          return
        }
        if (desistiu) return
        if (estado.qr) return mostrarQr(estado.qr)
        if (viuQr) {
          if (++faltas >= FALTAS_PARA_EXPIRAR) avisar(EXPIROU)
        } else if (Date.now() - inicio > ESPERA_PELO_QR_MS) {
          avisar(SEM_CODIGO)
        }
      } catch { /* a próxima volta tenta de novo */ }
    }, INTERVALO_QR_MS)

    return () => { ativo = false; clearInterval(relogio) }
  }, [open, tentativa, instancia, novo])

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
                {erro ? 'Sem código' : 'Gerando o código…'}
              </div>
            )}
          </div>

          {erro && (
            <p className="flex items-start gap-2 text-sm text-red-600">
              <IconAlert size={16} className="mt-0.5 shrink-0" />
              <span>{erro}</span>
            </p>
          )}

          <p className="text-xs text-slate-500">
            Conecte sempre por aqui, e não pelo painel da Evolution: é aqui que o sistema configura o
            recebimento das mensagens junto com a conexão.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Fechar</Button>
            {erro && (
              <Button onClick={() => setTentativa((n) => n + 1)}>
                {erro === EXPIROU ? 'Gerar outro código' : 'Tentar de novo'}
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}

// Com qual número atender.
//
// Cada pessoa tem o próprio número. Quem é da gestão vê também os outros — o da
// empresa e os de quem já conectou — e pode atender por qualquer um que esteja
// conectado. "Conectar o meu número" cria o da pessoa na primeira vez.
export function ModalNumeros({ open, onClose, emUso, onEscolher, onConectarMeu }) {
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState('')

  useEffect(() => {
    if (!open) return
    setDados(null); setErro('')
    numerosWhatsapp().then(setDados).catch((falha) => setErro(falha?.message || String(falha)))
  }, [open])

  const numeros = dados?.numeros ?? []
  const temOMeu = numeros.some((n) => n.meu)

  return (
    <Modal title="Número do WhatsApp" open={open} onClose={onClose}>
      <div className="space-y-4">
        {erro && <p className="text-sm text-red-600">{erro}</p>}
        {!dados && !erro && <p className="text-sm text-slate-500">Carregando os números…</p>}

        {dados && (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {numeros.length === 0 && (
              <li className="px-4 py-3 text-sm text-slate-500">Nenhum número conectado ainda.</li>
            )}
            {numeros.map((n) => {
              const ativo = n.instancia === emUso
              return (
                <li key={n.instancia}>
                  <button
                    type="button"
                    // Número desconectado também se escolhe: é por ele que se
                    // chega ao botão de conectar de novo.
                    onClick={() => onEscolher(n.instancia)}
                    className={`w-full text-left px-4 py-3 flex items-center gap-3 cursor-pointer ${ativo ? 'bg-[var(--nav-active-bg)]' : 'hover-superficie'}`}
                  >
                    <span
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${n.conectado ? 'bg-green-500' : 'bg-slate-300'}`}
                      title={n.conectado ? 'Conectado' : 'Desconectado'}
                    />
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm font-semibold truncate ${ativo ? 'text-[var(--nav-active-fg)]' : 'text-slate-900'}`}>
                        {n.meu ? 'Meu número' : n.dono}
                        {n.nome ? ` · ${n.nome}` : ''}
                      </span>
                      <span className={`block text-xs truncate ${ativo ? 'text-[var(--nav-active-fg)] opacity-80' : 'text-slate-500'}`}>
                        {n.numero || (n.conectado ? 'Conectado' : 'Desconectado')}
                      </span>
                    </span>
                    {ativo && <IconCheck size={16} className="shrink-0 text-[var(--nav-active-fg)]" />}
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Fechar</Button>
          {dados && !temOMeu && (
            <Button onClick={onConectarMeu}>Conectar o meu número</Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
