import { Link } from 'react-router-dom'
import {
  proximoPasso, formatBRL, formatData,
  contatoDaOportunidade, naoLidasDaOportunidade,
  ETAPAS_FUNIL, ETAPAS_ABERTAS, ETAPAS_FECHADAS, CANAIS_OPORTUNIDADE, MOTIVOS_PERDA,
} from '../data/repository.js'
import { hojeISO } from '../lib/datas.js'
import { Badge } from './ui.jsx'
import { AvatarContato } from './Avatar.jsx'
import { IconMais, IconAlert, IconArrastar, IconMessage } from './icons.jsx'

// Cartão do funil. Mostra o mínimo para decidir o que fazer com a negociação
// sem abrir nada: de quem é, quanto vale e qual é o próximo passo — este último
// em destaque quando está atrasado, porque é o que muda a ordem do dia.
export default function OportunidadeCard({
  oportunidade, onAbrir, onMover, onConversar, onConverter,
  arrastavel = false, arrastando = false, onDragStart, onDragEnd,
}) {
  // O contato pode ser um cliente cadastrado ou um LEAD — alguém que escreveu
  // no WhatsApp e ainda não tem cadastro. O cartão trata os dois igual; o que
  // muda é a etiqueta e a ação de converter.
  const contato = contatoDaOportunidade(oportunidade)
  const cliente = contato?.cliente
  const passo = proximoPasso(oportunidade.clienteId)
  const naoLidas = naoLidasDaOportunidade(oportunidade)
  const fechada = ETAPAS_FECHADAS.includes(oportunidade.etapa)
  const valor = Number(oportunidade.valorEstimado || 0)

  // Só as abertas cobram próximo passo: negócio fechado não tem o que esperar.
  const semProximoPasso = !fechada && !passo

  function fecharMenu(e) {
    e.currentTarget.closest('details')?.removeAttribute('open')
  }

  const itemMenu =
    'flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-200'

  return (
    <article
      draggable={arrastavel}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      // O cartão sendo levado fica MAIS visível, não menos: opacidade cheia,
      // anel azul e sombra, como se tivesse sido erguido do quadro. Apagá-lo
      // some justamente com o que você está tentando acompanhar.
      className={`group rounded-xl border bg-white p-3 transition-all duration-150 ${
        arrastando
          // O anel é `inset` e o realce é vertical de propósito: a coluna rola
          // por dentro, então qualquer coisa que cresça na horizontal seria
          // recortada ou acenderia uma barra de rolagem no meio do arrasto.
          ? 'border-blue-500 ring-2 ring-inset ring-blue-500 shadow-xl shadow-black/40 -translate-y-0.5'
          : 'border-slate-200 hover:border-slate-300'
      } ${arrastavel ? 'lg:cursor-grab lg:active:cursor-grabbing' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        {/* O rosto da pessoa, antes do nome dela.
            Quem mais ganha com isto é o LEAD: até aqui ele era um número numa
            coluna, e agora tem a cara que ele mesmo escolheu no WhatsApp —
            porque lead não tem foto de cadastro para mostrar, por definição.
            Quem decide qual foto aparece é o repositório (ver fotoDoContato). */}
        <AvatarContato
          clienteId={oportunidade.clienteId}
          conversaId={oportunidade.conversaId}
          telefone={contato.telefone}
          nome={contato.nome}
          size={32}
          className="mt-0.5"
        />
        <button
          type="button"
          onClick={onAbrir}
          className="min-w-0 flex-1 text-left cursor-pointer"
        >
          <p className="text-sm font-semibold text-slate-900 truncate">{oportunidade.titulo}</p>
        </button>

        <div className="flex items-center gap-0.5 shrink-0">
          {/* A alça só faz sentido onde o arrasto existe (desktop). Ela escurece
              no hover para dizer "é daqui que se pega" antes da primeira
              tentativa — sem ela o cartão não parece arrastável. */}
          {arrastavel && (
            <IconArrastar
              size={16}
              className="hidden lg:block text-slate-400 group-hover:text-blue-500 transition-colors"
            />
          )}
          <details className="relative">
            <summary
              aria-label="Mover negociação"
              className="list-none inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 [&::-webkit-details-marker]:hidden"
            >
              <IconMais size={16} />
            </summary>
            {/* No celular não existe arrastar: o HTML5 drag-and-drop não vale
                no toque, e emular com o polegar num quadro de 6 colunas seria
                pior que escolher da lista. Este menu é o caminho principal lá,
                e um atalho no desktop. */}
            <div className="absolute right-0 z-20 mt-1 w-56 rounded-xl border border-slate-300 bg-slate-100 p-1.5 shadow-xl shadow-black/30">
              <p className="px-3 pt-1 pb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                Mover para
              </p>
              {[...ETAPAS_ABERTAS, ...ETAPAS_FECHADAS]
                .filter((etapa) => etapa !== oportunidade.etapa)
                .map((etapa) => (
                  <button
                    key={etapa}
                    type="button"
                    className={itemMenu}
                    onClick={(e) => { fecharMenu(e); onMover(etapa) }}
                  >
                    {ETAPAS_FUNIL[etapa]}
                  </button>
                ))}
              <button type="button" className={`${itemMenu} border-t border-slate-200 mt-1 pt-1`} onClick={(e) => { fecharMenu(e); onAbrir() }}>
                Abrir negociação
              </button>
              {cliente ? (
                <Link
                  to={`/clientes/${cliente.id}`}
                  draggable={false}
                  className={itemMenu}
                  onClick={fecharMenu}
                >
                  Abrir ficha do cliente
                </Link>
              ) : (
                <button
                  type="button"
                  className={itemMenu}
                  onClick={(e) => { fecharMenu(e); onConverter?.(oportunidade) }}
                >
                  Transformar em cliente
                </button>
              )}
            </div>
          </details>
        </div>
      </div>

      {/* Clicar no contato abre a conversa de WhatsApp, ali mesmo: no meio do
          quadro, "falar com a pessoa" não devia custar uma navegação e uma
          volta. A ficha do cliente continua a um clique, no menu "…". */}
      <button
        type="button"
        onClick={() => onConversar?.(oportunidade)}
        title={
          naoLidas
            ? `${naoLidas} ${naoLidas === 1 ? 'mensagem nova' : 'mensagens novas'} de ${contato.nome}`
            : `Conversar com ${contato.nome}`
        }
        className="mt-1 flex items-center gap-1 max-w-full text-xs font-medium text-slate-500 hover:text-blue-600 cursor-pointer"
      >
        <IconMessage size={13} className={`shrink-0 ${naoLidas ? 'text-blue-500' : ''}`} />
        <span className={`truncate ${naoLidas ? 'text-slate-900 font-semibold' : ''}`}>
          {contato.nome}
        </span>
        {/* Contador de mensagens novas. Fica colado no nome porque é ele que
            abre a conversa — o número não é enfeite, é o botão. */}
        {naoLidas > 0 && (
          <span
            aria-label={`${naoLidas} não lidas`}
            className="shrink-0 inline-flex min-w-[1.15rem] h-[1.15rem] items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-bold text-[var(--btn-primary-fg)] tnum"
          >
            {naoLidas > 9 ? '9+' : naoLidas}
          </span>
        )}
      </button>

      {/* Lead = ainda não tem cadastro. A etiqueta existe para você saber, sem
          abrir nada, que essa pessoa ainda não está no sistema — e o telefone
          fica visível porque é a única identidade que ela tem por enquanto. */}
      {contato.lead && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <Badge color="amber">Lead</Badge>
          {contato.telefone && (
            <span className="text-[11px] text-slate-500 tnum truncate">{contato.telefone}</span>
          )}
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {valor > 0 && (
          <span className="text-sm font-bold text-slate-900 tnum">{formatBRL(valor)}</span>
        )}
        {oportunidade.canal && (
          <span className="text-[11px] font-semibold text-slate-500">
            {CANAIS_OPORTUNIDADE[oportunidade.canal] ?? oportunidade.canal}
          </span>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {oportunidade.etapa === 'perdido' && oportunidade.motivoPerda && (
          <Badge color="red">{MOTIVOS_PERDA[oportunidade.motivoPerda] ?? oportunidade.motivoPerda}</Badge>
        )}
        {oportunidade.etapa === 'ganho' && (
          <Badge color="green">{oportunidade.vendaId ? 'Venda criada' : 'Ganho'}</Badge>
        )}

        {!fechada && passo && (
          <Badge color={passo.atrasado ? 'red' : 'sky'}>
            {passo.atrasado ? 'Atrasado · ' : ''}{formatData(passo.data)}
          </Badge>
        )}
        {semProximoPasso && (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700">
            <IconAlert size={13} /> Sem próximo passo
          </span>
        )}
        {!fechada && oportunidade.dataPrevista && (
          <span
            className={`text-[11px] font-semibold ${
              oportunidade.dataPrevista < hojeISO() ? 'text-red-600' : 'text-slate-400'
            }`}
            title="Previsão de fechamento"
          >
            Prev. {formatData(oportunidade.dataPrevista)}
          </span>
        )}
      </div>
    </article>
  )
}
