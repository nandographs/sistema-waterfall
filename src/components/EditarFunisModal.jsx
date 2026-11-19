import { useState } from 'react'
import {
  funisOrdenados, funilPrincipal, etapasDoFunil, etapasAbertasDoFunil,
  negociosDoFunil, negociosDaEtapa,
  criarFunil, salvarFunil, definirFunilPrincipal, removerFunil,
  adicionarEtapa, renomearEtapa, moverEtapa, removerEtapa,
  PALETA_FUNIS, LIMITE_ETAPAS_ABERTAS,
} from '../data/repository.js'
import { Modal, Button, inputCls, notificar } from './ui.jsx'
import { IconPlus, IconTrash, IconChevronLeft, IconChevronRight, IconCheck } from './icons.jsx'
import { BolinhaFunil } from './EtiquetaFunil.jsx'

const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`

// Um campo de nome que grava ao sair dele (ou no Enter), e não a cada tecla:
// renomear "Proposta" para "Proposta enviada" não deve gravar dezesseis vezes,
// nem mudar o quadro letra por letra enquanto alguém está olhando.
function NomeEditavel({ valor, onSalvar, rotulo, className = '' }) {
  const [texto, setTexto] = useState(valor)
  const [ultimo, setUltimo] = useState(valor)
  // O nome mudou por fora (outro computador, Realtime): o campo acompanha.
  if (valor !== ultimo) {
    setUltimo(valor)
    setTexto(valor)
  }

  async function gravar() {
    const limpo = texto.trim()
    if (!limpo) { setTexto(valor); return }
    if (limpo === valor) return
    try {
      await onSalvar(limpo)
    } catch (ex) {
      setTexto(valor)
      notificar(ex?.message || String(ex), 'erro')
    }
  }

  return (
    <input
      className={`${inputCls} ${className}`}
      value={texto}
      aria-label={rotulo}
      maxLength={60}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={gravar}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
        if (e.key === 'Escape' && texto !== valor) { e.stopPropagation(); setTexto(valor) }
      }}
    />
  )
}

// Remover uma etapa: se houver negócios nela, para onde eles vão. Só entre as
// etapas ABERTAS do mesmo funil — mandar dez negócios de uma vez para
// "Perdido" seria fechá-los sem motivo de perda.
function RemoverEtapa({ etapa, onFeito, onCancelar }) {
  const negocios = negociosDaEtapa(etapa.funilId, etapa.chave).length
  const destinos = etapasAbertasDoFunil(etapa.funilId).filter((e) => e.id !== etapa.id)
  const [destino, setDestino] = useState(destinos[0]?.id ?? '')
  const [salvando, setSalvando] = useState(false)

  async function confirmar() {
    setSalvando(true)
    try {
      await removerEtapa(etapa.id, negocios ? destino : null)
      notificar(`Etapa "${etapa.nome}" removida.`)
      onFeito()
    } catch (ex) {
      notificar(ex?.message || String(ex), 'erro')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="mt-2 rounded-xl border border-red-200 bg-red-50 p-3 space-y-2.5">
      {negocios ? (
        <>
          <p className="text-sm text-slate-700">
            {plural(negocios, 'negócio está', 'negócios estão')} em <strong>{etapa.nome}</strong>.
            Para qual etapa {negocios === 1 ? 'ele vai' : 'eles vão'}?
          </p>
          <select className={inputCls} value={destino} onChange={(e) => setDestino(e.target.value)} aria-label="Etapa de destino">
            {destinos.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
        </>
      ) : (
        <p className="text-sm text-slate-700">Remover a etapa <strong>{etapa.nome}</strong>? Não há negócios nela.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="danger" onClick={confirmar} disabled={salvando || (negocios > 0 && !destino)}>
          {salvando ? 'Removendo…' : 'Remover etapa'}
        </Button>
        <Button variant="secondary" onClick={onCancelar}>Cancelar</Button>
      </div>
    </div>
  )
}

// Remover o funil. Com negócios, a escolha é explícita — levar todos para
// outro funil (cada um para a etapa equivalente) ou apagar junto — e a caixa
// de confirmação é obrigatória: as duas saídas mexem em muita coisa de uma vez.
function RemoverFunil({ funil, onFeito, onCancelar }) {
  const negocios = negociosDoFunil(funil.id).length
  const outros = funisOrdenados().filter((f) => f.id !== funil.id)
  const [modo, setModo] = useState('levar')
  const [destino, setDestino] = useState(outros[0]?.id ?? '')
  const [certeza, setCerteza] = useState(false)
  const [salvando, setSalvando] = useState(false)

  async function confirmar() {
    setSalvando(true)
    try {
      await removerFunil(funil.id, negocios
        ? (modo === 'apagar' ? { apagar: true } : { destinoId: destino })
        : {})
      notificar(`Funil "${funil.nome}" removido.`)
      onFeito()
    } catch (ex) {
      notificar(ex?.message || String(ex), 'erro')
    } finally {
      setSalvando(false)
    }
  }

  const opcao = 'flex items-start gap-2.5 text-sm text-slate-700 cursor-pointer'
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 space-y-3">
      <p className="text-sm font-semibold text-slate-900">Remover o funil “{funil.nome}”</p>
      {negocios > 0 && (
        <>
          <p className="text-sm text-slate-700">
            Ele tem {plural(negocios, 'negócio', 'negócios')}. O que fazer com {negocios === 1 ? 'ele' : 'eles'}?
          </p>
          <label className={opcao}>
            <input type="radio" name="destino-funil" className="mt-1 accent-blue-600" checked={modo === 'levar'} onChange={() => setModo('levar')} />
            <span className="flex-1 min-w-0">
              Levar para outro funil
              <span className="block text-xs text-slate-500 mt-0.5">
                Aberto vai para a primeira etapa; ganho para Ganho; perdido para Perdido.
              </span>
              {modo === 'levar' && (
                <select className={`${inputCls} mt-2`} value={destino} onChange={(e) => setDestino(e.target.value)} aria-label="Funil de destino">
                  {outros.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
                </select>
              )}
            </span>
          </label>
          <label className={opcao}>
            <input type="radio" name="destino-funil" className="mt-1 accent-blue-600" checked={modo === 'apagar'} onChange={() => setModo('apagar')} />
            <span>
              Apagar junto
              <span className="block text-xs text-red-600 mt-0.5">
                Os negócios e o histórico deles somem. As vendas que já existem continuam.
              </span>
            </span>
          </label>
        </>
      )}
      <label className={opcao}>
        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-red-600" checked={certeza} onChange={(e) => setCerteza(e.target.checked)} />
        <span>
          {negocios === 0
            ? 'Sim, remover este funil.'
            : modo === 'apagar'
              ? `Sim, remover o funil e apagar ${plural(negocios, 'negócio', 'negócios')}.`
              : `Sim, remover o funil e levar ${plural(negocios, 'negócio', 'negócios')}.`}
        </span>
      </label>
      <div className="flex flex-wrap gap-2">
        <Button variant="danger" onClick={confirmar} disabled={salvando || !certeza || (negocios > 0 && modo === 'levar' && !destino)}>
          {salvando ? 'Removendo…' : 'Remover funil'}
        </Button>
        <Button variant="secondary" onClick={onCancelar}>Cancelar</Button>
      </div>
    </div>
  )
}

// Editar funis: criar, renomear, trocar a cor, escolher o principal, remover;
// e, dentro de cada um, as etapas.
//
// Um funil por vez na tela, escolhido pelas pílulas de cima: com três funis de
// oito etapas, tudo aberto ao mesmo tempo seria uma parede de campos.
export default function EditarFunisModal({ funilInicial, onFechar, onMudou }) {
  const [, forcar] = useState(0)
  const recarregar = () => { forcar((n) => n + 1); onMudou?.() }

  const lista = funisOrdenados()
  const [selecionadoId, setSelecionadoId] = useState(funilInicial || lista[0]?.id || '')
  const funil = lista.find((f) => f.id === selecionadoId) ?? lista[0] ?? null
  const principal = funilPrincipal()

  const [nomeNovo, setNomeNovo] = useState('')
  const [criando, setCriando] = useState(false)
  const [etapaNova, setEtapaNova] = useState('')
  const [removendoEtapa, setRemovendoEtapa] = useState(null)
  const [removendoFunil, setRemovendoFunil] = useState(false)
  const [ocupado, setOcupado] = useState(false)

  const etapas = funil ? etapasDoFunil(funil.id) : []
  const abertas = etapas.filter((e) => e.tipo === 'aberta')
  const cheio = abertas.length >= LIMITE_ETAPAS_ABERTAS

  async function tentar(acao, sucesso) {
    setOcupado(true)
    try {
      const resultado = await acao()
      if (sucesso) notificar(sucesso)
      recarregar()
      return resultado
    } catch (ex) {
      notificar(ex?.message || String(ex), 'erro')
      return null
    } finally {
      setOcupado(false)
    }
  }

  async function criar(e) {
    e.preventDefault()
    const novo = await tentar(() => criarFunil(nomeNovo), `Funil "${nomeNovo.trim()}" criado.`)
    if (novo) {
      setNomeNovo('')
      setCriando(false)
      setSelecionadoId(novo.id)
    }
  }

  async function adicionar(e) {
    e.preventDefault()
    const criada = await tentar(() => adicionarEtapa(funil.id, etapaNova))
    if (criada) setEtapaNova('')
  }

  function trocarDeFunil(id) {
    setSelecionadoId(id)
    setRemovendoEtapa(null)
    setRemovendoFunil(false)
    setEtapaNova('')
  }

  const pilula = (ativo) =>
    `inline-flex items-center gap-2 rounded-full px-3.5 min-h-9 text-[13px] font-medium whitespace-nowrap cursor-pointer border transition-colors ${
      ativo ? 'ui-card bg-white text-slate-900 border-slate-300' : 'border-transparent text-slate-500 hover:text-slate-900'
    }`

  const botaoIcone =
    'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent'

  return (
    <Modal open size="wide" title="Editar funis" onClose={onFechar}>
      <div className="space-y-5">
        {/* Os funis, como as abas do quadro, mais o "novo". */}
        <div className="flex flex-wrap items-center gap-1 rounded-[1.4rem] bg-slate-100 p-1">
          {lista.map((f) => (
            <button key={f.id} type="button" className={pilula(f.id === funil?.id && !criando)} onClick={() => { setCriando(false); trocarDeFunil(f.id) }}>
              <BolinhaFunil cor={f.cor} />
              {f.nome}
            </button>
          ))}
          <button type="button" className={pilula(criando)} onClick={() => setCriando(true)}>
            <IconPlus size={14} /> Novo funil
          </button>
        </div>

        {criando ? (
          <form onSubmit={criar} className="space-y-3">
            <p className="text-sm text-slate-600">
              O funil nasce com as etapas <strong>Novo</strong>, <strong>Em andamento</strong>,{' '}
              <strong>Ganho</strong> e <strong>Perdido</strong>, e com uma cor que nenhum outro
              funil esteja usando. Dá para mudar tudo depois.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                className={`${inputCls} flex-1`}
                value={nomeNovo}
                onChange={(e) => setNomeNovo(e.target.value)}
                placeholder="Ex.: Pós-venda"
                aria-label="Nome do funil novo"
                maxLength={60}
                autoFocus
              />
              <Button type="submit" disabled={ocupado || !nomeNovo.trim()}>
                {ocupado ? 'Criando…' : 'Criar funil'}
              </Button>
            </div>
          </form>
        ) : funil && (
          <>
            <section className="space-y-3">
              <div>
                <p className="text-xs font-semibold text-slate-500 mb-1.5">Nome</p>
                <NomeEditavel
                  key={funil.id}
                  valor={funil.nome}
                  rotulo="Nome do funil"
                  onSalvar={(nome) => salvarFunil(funil.id, { nome }).then(recarregar)}
                />
              </div>

              <div>
                <p className="text-xs font-semibold text-slate-500 mb-1.5">Cor</p>
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Cor do funil">
                  {Object.entries(PALETA_FUNIS).map(([cor, { nome, hex }]) => {
                    const ativa = funil.cor === cor
                    return (
                      <button
                        key={cor}
                        type="button"
                        role="radio"
                        aria-checked={ativa}
                        aria-label={nome}
                        title={nome}
                        disabled={ocupado}
                        onClick={() => !ativa && tentar(() => salvarFunil(funil.id, { cor }))}
                        className={`inline-flex h-10 w-10 items-center justify-center rounded-full cursor-pointer border-2 ${
                          ativa ? 'border-slate-900' : 'border-transparent hover:border-slate-300'
                        }`}
                      >
                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full text-white" style={{ backgroundColor: hex }}>
                          {ativa && <IconCheck size={14} />}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-100 px-3.5 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">
                    {principal?.id === funil.id ? 'Este é o funil principal' : 'Funil principal'}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    É nele que os contatos novos do WhatsApp entram como card.
                  </p>
                </div>
                {principal?.id !== funil.id && (
                  <Button variant="secondary" disabled={ocupado} onClick={() => tentar(() => definirFunilPrincipal(funil.id), `"${funil.nome}" agora é o funil principal.`)}>
                    Tornar principal
                  </Button>
                )}
              </div>
            </section>

            <section>
              <div className="flex items-baseline justify-between gap-2 mb-2">
                <p className="text-sm font-semibold text-slate-900">Etapas</p>
                <p className="text-[11px] font-medium text-slate-500 tnum">
                  {abertas.length} de {LIMITE_ETAPAS_ABERTAS} abertas
                </p>
              </div>

              <ol className="space-y-1.5">
                {etapas.map((etapa) => {
                  const fechada = etapa.tipo !== 'aberta'
                  const i = abertas.findIndex((e) => e.id === etapa.id)
                  const negocios = negociosDaEtapa(funil.id, etapa.chave).length
                  return (
                    <li key={etapa.id}>
                      <div className="flex items-center gap-1">
                        <span
                          aria-hidden="true"
                          className={`h-2 w-2 shrink-0 rounded-full mx-1 ${
                            etapa.tipo === 'ganho' ? 'bg-emerald-500' : etapa.tipo === 'perdido' ? 'bg-red-500' : 'bg-slate-300'
                          }`}
                        />
                        <NomeEditavel
                          valor={etapa.nome}
                          rotulo={`Nome da etapa ${etapa.nome}`}
                          className="flex-1 min-w-0"
                          onSalvar={(nome) => renomearEtapa(etapa.id, nome).then(recarregar)}
                        />
                        <span className="hidden sm:inline w-[5.5rem] shrink-0 whitespace-nowrap text-right text-[11px] text-slate-400 tnum" title="Negócios nesta etapa">
                          {negocios ? plural(negocios, 'negócio', 'negócios') : ''}
                        </span>
                        {fechada ? (
                          // Ganho e Perdido ficam no lugar: são o fim do funil.
                          <span className="w-[7.5rem] shrink-0 text-[11px] text-slate-500 text-center leading-tight" title="É por esta etapa que o sistema sabe que um negócio foi fechado.">
                            fixa · só renomear
                          </span>
                        ) : (
                          <>
                            <button type="button" className={botaoIcone} aria-label={`Mover ${etapa.nome} para a esquerda`} title="Mover para a esquerda"
                              disabled={ocupado || i === 0} onClick={() => tentar(() => moverEtapa(etapa.id, -1))}>
                              <IconChevronLeft size={16} />
                            </button>
                            <button type="button" className={botaoIcone} aria-label={`Mover ${etapa.nome} para a direita`} title="Mover para a direita"
                              disabled={ocupado || i === abertas.length - 1} onClick={() => tentar(() => moverEtapa(etapa.id, 1))}>
                              <IconChevronRight size={16} />
                            </button>
                            <button type="button" className={`${botaoIcone} hover:!text-red-600`} aria-label={`Remover ${etapa.nome}`}
                              title={abertas.length <= 1 ? 'Todo funil precisa de pelo menos uma etapa aberta' : 'Remover etapa'}
                              disabled={ocupado || abertas.length <= 1}
                              onClick={() => setRemovendoEtapa(removendoEtapa === etapa.id ? null : etapa.id)}>
                              <IconTrash size={16} />
                            </button>
                          </>
                        )}
                      </div>
                      {removendoEtapa === etapa.id && (
                        <RemoverEtapa
                          etapa={etapa}
                          onFeito={() => { setRemovendoEtapa(null); recarregar() }}
                          onCancelar={() => setRemovendoEtapa(null)}
                        />
                      )}
                    </li>
                  )
                })}
              </ol>

              <form onSubmit={adicionar} className="mt-3 flex flex-col sm:flex-row gap-2">
                <input
                  className={`${inputCls} flex-1`}
                  value={etapaNova}
                  onChange={(e) => setEtapaNova(e.target.value)}
                  placeholder={cheio ? 'Limite de etapas abertas atingido' : 'Nova etapa (entra antes de Ganho)'}
                  aria-label="Nome da etapa nova"
                  maxLength={60}
                  disabled={cheio}
                />
                <Button type="submit" variant="secondary" disabled={ocupado || cheio || !etapaNova.trim()}>
                  <IconPlus size={15} /> Adicionar etapa
                </Button>
              </form>
            </section>

            <section className="border-t border-slate-200 pt-4">
              {removendoFunil ? (
                <RemoverFunil
                  funil={funil}
                  onFeito={() => { setRemovendoFunil(false); setSelecionadoId(''); recarregar() }}
                  onCancelar={() => setRemovendoFunil(false)}
                />
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-slate-500">
                    {lista.length <= 1
                      ? 'O último funil que sobrar não pode ser removido.'
                      : `${plural(negociosDoFunil(funil.id).length, 'negócio', 'negócios')} neste funil.`}
                  </p>
                  <Button variant="danger" disabled={lista.length <= 1} onClick={() => setRemovendoFunil(true)}>
                    <IconTrash size={15} /> Remover funil
                  </Button>
                </div>
              )}
            </section>
          </>
        )}

        <div className="flex justify-end">
          <Button variant="secondary" onClick={onFechar}>Fechar</Button>
        </div>
      </div>
    </Modal>
  )
}
