import { useEffect, useState } from 'react'
import {
  oportunidadesPorEtapa, resumoDoFunil, contatoDaOportunidade,
  moverOportunidade, reabrirOportunidade,
  formatBRL,
  ETAPAS_FUNIL, ETAPAS_ABERTAS, ETAPAS_FECHADAS,
} from '../data/repository.js'
import { PageTitle, Button, Empty, inputCls, notificar } from '../components/ui.jsx'
import { IconPlus, IconSearch } from '../components/icons.jsx'
import OportunidadeCard from '../components/OportunidadeCard.jsx'
import OportunidadeModal, { FecharOportunidadeModal, oportunidadeNova } from '../components/OportunidadeModal.jsx'
import ConversaClienteModal from '../components/ConversaClienteModal.jsx'
import ConverterLeadModal from '../components/ConverterLeadModal.jsx'
import { assinarWhatsapp } from '../data/repository.js'

// Remove acentos e caixa, como no ClienteBusca — "joão" tem que casar com "Joao".
const normalizar = (s) =>
  String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()

// Onde o cartão vai cair. Uma linha fina entre dois cartões responde a pergunta
// que a coluna inteira destacada não responde: "vai entrar em que posição?".
function MarcaDeDestino() {
  return (
    <div className="relative h-0.5 rounded-full bg-blue-500 my-1">
      <span className="absolute -left-0.5 -top-[3px] h-2 w-2 rounded-full bg-blue-500" />
    </div>
  )
}

// Cabeçalho da coluna: o nome da etapa, quantos cartões e quanto dinheiro está
// parado ali. A soma é o que transforma o quadro em previsão, e não só em lista.
function CabecalhoColuna({ etapa, quantidade, valor, onNova }) {
  return (
    <div className="shrink-0 flex items-center justify-between gap-2 px-1 pb-2.5">
      <div className="min-w-0">
        <p className="text-sm font-bold text-slate-900 truncate">
          {ETAPAS_FUNIL[etapa]}
          <span className="ml-1.5 text-xs font-semibold text-slate-400 tnum">{quantidade}</span>
        </p>
        {valor > 0 && <p className="text-[11px] font-semibold text-slate-500 tnum">{formatBRL(valor)}</p>}
      </div>
      {onNova && (
        <button
          type="button"
          onClick={onNova}
          aria-label={`Nova negociação em ${ETAPAS_FUNIL[etapa]}`}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
        >
          <IconPlus size={16} />
        </button>
      )}
    </div>
  )
}

export default function Funil() {
  const [, forcarRender] = useState(0)
  const recarregar = () => forcarRender((n) => n + 1)

  const [form, setForm] = useState(null)
  const [fechando, setFechando] = useState(null)
  const [conversaAberta, setConversaAberta] = useState(null)
  const [convertendo, setConvertendo] = useState(null)
  const [arrastando, setArrastando] = useState(null)
  // Onde o cartão cairia agora: { etapa, indice }.
  const [alvo, setAlvo] = useState(null)
  const [busca, setBusca] = useState('')

  // O contador de mensagens dos cartões vem das conversas. Assinar aqui é o que
  // faz o número aparecer quando a mensagem chega — e sumir no instante em que
  // você a lê, inclusive quando a leitura acontece na tela de WhatsApp.
  useEffect(() => assinarWhatsapp(recarregar), [])

  const quadro = oportunidadesPorEtapa()
  const resumo = resumoDoFunil()

  const q = normalizar(busca)
  const filtrar = (cartoes) =>
    !q
      ? cartoes
      : cartoes.filter((o) => {
          // Busca também pelo contato do lead, que não tem cliente para casar.
          const contato = contatoDaOportunidade(o)
          return normalizar(o.titulo).includes(q)
            || normalizar(contato?.nome).includes(q)
            || normalizar(contato?.telefone).includes(q)
        })

  const abertas = ETAPAS_ABERTAS.reduce((soma, etapa) => soma + resumo[etapa].quantidade, 0)
  const emJogo = ETAPAS_ABERTAS.reduce((soma, etapa) => soma + resumo[etapa].valor, 0)

  // Mover é sempre a mesma decisão, venha do arrasto ou do menu do cartão:
  // fechar exige uma conversa (motivo / venda), abrir é direto.
  async function mover(oportunidade, etapa, indice) {
    if (ETAPAS_FECHADAS.includes(etapa)) {
      setFechando({ oportunidade, etapa })
      return
    }
    try {
      if (ETAPAS_FECHADAS.includes(oportunidade.etapa)) {
        await reabrirOportunidade(oportunidade.id, etapa)
      }
      await moverOportunidade(oportunidade.id, etapa, indice)
      recarregar()
    } catch (ex) {
      notificar(ex?.message || String(ex), 'erro')
    }
  }

  function limparArrasto() {
    setArrastando(null)
    setAlvo(null)
  }

  // Só a COLUNA recebe o drop. Os cartões apenas dizem, no dragOver, em que
  // posição o cartão entraria — se cada um também tratasse o drop, o mesmo
  // arrasto seria processado duas vezes (uma no cartão, outra na coluna).
  function soltarNaColuna(etapa) {
    return (e) => {
      e.preventDefault()
      const cartao = arrastando
      limparArrasto()
      if (!cartao) return

      // A marca de destino é calculada sobre a lista VISÍVEL, que pode estar
      // filtrada pela busca. Quem manda na ordem é a coluna inteira — então
      // traduzimos "antes do cartão X" para a posição real antes de gravar.
      const coluna = quadro[etapa].filter((o) => o.id !== cartao.id)
      const antesDe = alvo?.etapa === etapa ? alvo.antesDe : null
      const posicao = antesDe ? coluna.findIndex((o) => o.id === antesDe) : -1
      mover(cartao, etapa, posicao === -1 ? coluna.length : posicao)
    }
  }

  // Sobre o fundo da coluna: entra no fim. Só marca ao ENTRAR na coluna — se
  // reescrevesse a posição a cada passagem pelos vãos entre cartões, a linha
  // ficaria piscando entre "aqui" e "no fim".
  const sobreColuna = (etapa) => (e) => {
    if (!arrastando) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setAlvo((atual) => (atual?.etapa === etapa ? atual : { etapa, indice: null, antesDe: null }))
  }

  // Metade de cima do cartão = entra antes dele; metade de baixo = entra depois.
  const sobreCartao = (etapa, indice, cartoes) => (e) => {
    if (!arrastando) return
    e.preventDefault()
    e.stopPropagation()
    const caixa = e.currentTarget.getBoundingClientRect()
    const abaixoDoMeio = e.clientY > caixa.top + caixa.height / 2
    const destino = abaixoDoMeio ? indice + 1 : indice
    const antesDe = cartoes[destino]?.id ?? null
    setAlvo((atual) =>
      atual?.etapa === etapa && atual.indice === destino ? atual : { etapa, indice: destino, antesDe },
    )
  }

  // Função que devolve JSX, e não um componente declarado aqui dentro: um
  // componente novo a cada render seria um tipo novo para o React, que
  // remontaria as colunas inteiras no meio do arrasto e derrubaria o gesto.
  function coluna(etapa, largura = 'w-[17.5rem]') {
    const cartoes = filtrar(quadro[etapa])
    const fechada = ETAPAS_FECHADAS.includes(etapa)
    const recebendo = arrastando && alvo?.etapa === etapa

    return (
      <section key={etapa} className={`${largura} shrink-0 snap-start flex flex-col h-full min-h-0`}>
        <CabecalhoColuna
          etapa={etapa}
          quantidade={resumo[etapa].quantidade}
          valor={resumo[etapa].valor}
          onNova={fechada ? null : () => setForm(oportunidadeNova({ etapa }))}
        />

        {/* A coluna rola sozinha: com o quadro ocupando a tela inteira, é a
            lista de cartões que cresce, não a página. */}
        <div
          onDragOver={sobreColuna(etapa)}
          onDrop={soltarNaColuna(etapa)}
          className={`flex-1 min-h-0 overflow-y-auto rounded-2xl border p-2 space-y-2 transition-colors duration-150 ${
            recebendo ? 'border-blue-400 bg-blue-50/60' : 'border-slate-200 bg-slate-50/60'
          }`}
        >
          {cartoes.length === 0 && !recebendo && (
            <p className="text-xs text-slate-400 text-center py-6">
              {fechada ? 'Nada nos últimos 30 dias.' : 'Nenhuma negociação aqui.'}
            </p>
          )}

          {cartoes.map((oportunidade, indice) => (
            <div key={oportunidade.id} onDragOver={sobreCartao(etapa, indice, cartoes)}>
              {recebendo && alvo.indice === indice && <MarcaDeDestino />}
              <OportunidadeCard
                oportunidade={oportunidade}
                arrastavel
                arrastando={arrastando?.id === oportunidade.id}
                // O Firefox só inicia um arrasto se houver dado no
                // dataTransfer; o id é o que faz o gesto existir lá.
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', oportunidade.id)
                  e.dataTransfer.effectAllowed = 'move'
                  setArrastando(oportunidade)
                }}
                onDragEnd={limparArrasto}
                onAbrir={() => setForm(oportunidade)}
                onMover={(destino) => mover(oportunidade, destino, null)}
                onConversar={setConversaAberta}
                onConverter={setConvertendo}
              />
            </div>
          ))}

          {/* `indice` nulo = entrou na coluna mas ainda não passou por nenhum
              cartão: o destino é o fim da fila. */}
          {recebendo && (alvo.indice == null || alvo.indice >= cartoes.length) && <MarcaDeDestino />}
        </div>
      </section>
    )
  }

  return (
    // Altura da janela menos a topbar (h-16 no mobile, h-20 no desktop): o
    // quadro ocupa a tela inteira e cada coluna rola por dentro — kanban preso
    // a um pedaço da página obriga a rolar duas vezes para ver seis colunas.
    <div className="flex flex-col h-[calc(100svh-4rem)] lg:h-[calc(100svh-5rem)] w-full max-w-[1480px] mx-auto px-4 sm:px-6 lg:px-8 py-5 lg:py-7 pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-8">
      <div className="shrink-0">
        <PageTitle
          subtitle={
            abertas
              ? `${abertas} ${abertas === 1 ? 'negociação aberta' : 'negociações abertas'} · ${formatBRL(emJogo)} em jogo`
              : 'Nenhuma negociação aberta.'
          }
          action={
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  className={`${inputCls} pl-9 w-full sm:w-56`}
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar cliente ou título…"
                  aria-label="Buscar negociação"
                />
              </div>
              <Button onClick={() => setForm(oportunidadeNova())}>
                <IconPlus size={16} /> Nova negociação
              </Button>
            </div>
          }
        >
          CRM
        </PageTitle>
      </div>

      {abertas === 0 && !busca && (
        <div className="shrink-0">
          <Empty>
            O CRM está vazio. Abra uma negociação quando alguém demonstrar interesse —
            ela vira venda quando fechar.
          </Empty>
        </div>
      )}

      {/* Rolagem horizontal com encaixe: no celular cada coluna ocupa quase a
          tela inteira e o polegar passa de uma para a outra; no desktop as seis
          cabem lado a lado. */}
      <div className="flex-1 min-h-0 flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
        {ETAPAS_ABERTAS.map((etapa) => coluna(etapa))}
        {ETAPAS_FECHADAS.map((etapa) => coluna(etapa, 'w-[15rem]'))}
      </div>

      {form && (
        <OportunidadeModal
          key={form.id || 'nova'}
          oportunidade={form}
          onFechar={() => setForm(null)}
          onSalvo={recarregar}
        />
      )}

      {fechando && (
        <FecharOportunidadeModal
          oportunidade={fechando.oportunidade}
          etapa={fechando.etapa}
          onFechar={() => setFechando(null)}
          onSalvo={recarregar}
        />
      )}

      {conversaAberta && (
        <ConversaClienteModal
          key={conversaAberta.id}
          oportunidade={conversaAberta}
          onFechar={() => setConversaAberta(null)}
          onMudouEtapa={recarregar}
          onConverter={setConvertendo}
        />
      )}

      {convertendo && (
        <ConverterLeadModal
          key={`converter-${convertendo.id}`}
          oportunidade={convertendo}
          onFechar={() => setConvertendo(null)}
          onConvertido={recarregar}
        />
      )}
    </div>
  )
}
