import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Page, Badge, Empty, Button, Modal, notificar } from '../components/ui.jsx'
import { IconMessage, IconAlert } from '../components/icons.jsx'
import { formatHora, rotuloRelativo, diaCurto } from '../lib/datas.js'
import {
  clientes, conversasRecentes, carregarMensagens, mensagensDaConversa,
  marcarConversaLida, enviarMensagemWhatsapp, assinarWhatsapp, statusWhatsapp,
  vincularConversaACliente, oportunidadesDoCliente, atualizarAvatares,
  arquivarConversa, cadastrarClienteDaConversa, conversaDoCliente, conversaDoNumero,
  garantirOportunidadeDoCliente,
  ETAPAS_FUNIL, ETAPAS_ABERTAS,
} from '../data/repository.js'
import { formatarE164, paraE164 } from '../lib/telefone.js'
import ClienteFormFields from '../components/ClienteFormFields.jsx'
import ConversaWhatsApp, { CabecalhoConversa, AvatarConversa } from '../components/ConversaWhatsApp.jsx'
import EtapaOportunidade from '../components/EtapaOportunidade.jsx'
import NotasDaConversa from '../components/NotasDaConversa.jsx'
import ClienteBusca from '../components/ClienteBusca.jsx'

// A caixa de entrada do WhatsApp.
//
// As mensagens chegam pela Edge Function `wa-webhook` (a Evolution Go avisa o
// servidor, não o navegador), e a tela descobre pelo Realtime — ver
// `assinarWhatsapp` no repositório. É a única tela do sistema em que o conteúdo
// muda sem ninguém ter clicado em nada.

// Mesmos campos do cadastro da tela de Clientes — é o mesmo cliente, e um
// cadastro pela metade aqui viraria trabalho de conferência depois.
const FORM_CLIENTE_VAZIO = {
  nome: '', telefone: '', email: '', cpfCnpj: '',
  endereco: '', numeroComplemento: '', bairro: '', cidade: '', uf: '', cep: '',
  observacoes: '',
}

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
  const [parametros, definirParametros] = useSearchParams()

  const [abertaId, setAbertaId] = useState(null)
  const [carregando, setCarregando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [conexao, setConexao] = useState(null)
  const [vincular, setVincular] = useState(null)
  const [cadastro, setCadastro] = useState(null)

  // Conversa que ainda NÃO existe no banco.
  //
  // É o caminho vindo da ficha do cliente ("Chamar no WhatsApp") de alguém que
  // nunca escreveu. A alternativa seria criar a linha em `conversas` na hora de
  // abrir — e aí todo cliente que você abriu e desistiu de escrever viraria uma
  // conversa vazia entulhando a caixa de entrada, para sempre.
  //
  // Nada é gravado enquanto ninguém escrever. Quando a primeira mensagem sai, a
  // própria `wa-enviar` cria a conversa (ela já sabia fazer isso a partir de um
  // número solto) e a tela troca o rascunho pela conversa de verdade.
  const [rascunho, setRascunho] = useState(null)

  // Arquivar sem poder desarquivar seria uma porta de mão única: a conversa
  // sumiria da lista e o "Tirar do arquivo" do menu nunca seria alcançável.
  // Por isso o interruptor no cabeçalho da lista.
  const [verArquivadas, setVerArquivadas] = useState(false)
  const lista = conversasRecentes({ incluirArquivadas: verArquivadas })
    .filter((c) => (verArquivadas ? c.arquivada : true))
  const aberta = abertaId ? lista.find((c) => c.id === abertaId) ?? null : null
  // Conta sempre as ATIVAS, e não a lista que está na tela: o contador precisa
  // querer dizer a mesma coisa em qualquer aba, senão ele deixa de ser um
  // número em que se confia.
  const totalNaoLidas = conversasRecentes().reduce((soma, c) => soma + Number(c.naoLidas || 0), 0)

  useEffect(() => assinarWhatsapp(recarregar), [])

  // Chegada pela ficha do cliente: /whatsapp?cliente=<id>.
  //
  // A conversa é procurada de duas formas, e a segunda importa: pelo vínculo
  // (`cliente_id`) e, se não houver, pelo TELEFONE. O segundo caso é comum —
  // a pessoa escreveu antes de existir cadastro, então a conversa está solta.
  // Achando assim, aproveitamos para amarrar as duas coisas: é a mesma pessoa,
  // e deixá-la como "sem cadastro" depois de vir da ficha dela seria absurdo.
  useEffect(() => {
    const alvo = parametros.get('cliente')
    if (!alvo) return

    const cliente = clientes.get(alvo)
    // A URL some assim que é lida: ela é uma ordem de navegação, não um estado
    // da tela. Mantê-la faria um F5 reabrir a conversa que você já fechou.
    definirParametros({}, { replace: true })
    if (!cliente) return

    // Sem `conversaDoNumero` aqui: `conversaDoCliente` já varre todos os
    // telefones do cadastro, e não só o principal.
    const existente = conversaDoCliente(alvo)
    if (existente) {
      setRascunho(null)
      setAbertaId(existente.id)
      if (!existente.clienteId) vincularConversaACliente(existente.id, alvo).then(recarregar)
      return
    }

    setAbertaId(null)
    setRascunho({
      clienteId: alvo,
      clienteNome: cliente.nome,
      numero: paraE164(cliente.telefone) || cliente.telefone || '',
    })
  }, [parametros])

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

  // As fotos de perfil dos contatos, também uma vez ao abrir.
  //
  // Aqui e não na carga do sistema por dois motivos: é a tela onde as fotos
  // aparecem, e a busca é lenta de propósito — uma conversa por vez, para não
  // afogar a instância (ver _compartilhado/avatar.ts). Ninguém espera por ela:
  // a lista já desenhou com as iniciais, e as fotos entram quando chegam.
  //
  // Cada chamada cuida de um lote; as conversas restantes ficam para a próxima
  // vez que você abrir a tela. A fila anda sozinha ao longo dos dias.
  useEffect(() => {
    let ativo = true
    atualizarAvatares().then((quantas) => { if (ativo && quantas) recarregar() })
    return () => { ativo = false }
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
      // No rascunho não há `conversaId` para mandar — é a `wa-enviar` que abre a
      // conversa, e ela devolve o id. É aí, e só aí, que o rascunho vira
      // conversa de verdade na tela.
      const resposta = await enviarMensagemWhatsapp(
        aberta
          ? { conversaId: aberta.id, texto }
          : { clienteId: rascunho.clienteId, numero: rascunho.numero, texto },
      )
      if (!aberta && resposta?.conversaId) {
        // A conversa que VOCÊ começou pela ficha do cliente entra no funil.
        //
        // O webhook não faz isso: ele abre cartão para quem não é cliente (o
        // lead) e deixa cliente de fora de propósito — abrir negociação a cada
        // "bom dia" de quem já está na base transformaria o funil na caixa de
        // entrada com outro nome.
        //
        // Aqui a diferença é a intenção. Você saiu da ficha e foi atrás da
        // pessoa; isso é começo de negociação. Se já houver uma em andamento,
        // `garantirOportunidadeDoCliente` reaproveita em vez de criar outra.
        await garantirOportunidadeDoCliente(rascunho.clienteId, resposta.conversaId)
        setRascunho(null)
        setAbertaId(resposta.conversaId)
      }
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

  // O rascunho é uma aposta: "não existe conversa com esta pessoa". Ela pode
  // perder enquanto a tela está aberta — a mensagem dela chega pelo Realtime, ou
  // simplesmente chegou entre o clique na ficha e o cache atualizar.
  //
  // Quando isso acontece, o certo é trocar pela conversa de verdade. Sem isto o
  // painel diz "vocês ainda não conversaram" enquanto a lista ao lado mostra a
  // conversa com a pessoa — duas telas discordando sobre o mesmo fato.
  //
  // Nada se perde por não fazer nada aqui (a `wa-enviar` acha a conversa pelo
  // número e não duplica); o que se perde é a tela fazer sentido.
  useEffect(() => {
    if (!rascunho) return
    const existente = conversaDoCliente(rascunho.clienteId) ?? conversaDoNumero(rascunho.numero)
    if (!existente) return
    setRascunho(null)
    setAbertaId(existente.id)
  }, [rascunho, lista.length])

  // Abre o cadastro já preenchido com o que o WhatsApp entregou: o nome do
  // perfil e o telefone com máscara. Digitar de novo o que a tela já sabe é o
  // tipo de atrito que faz ninguém cadastrar ninguém.
  function abrirCadastro(conversa) {
    setCadastro({
      ...FORM_CLIENTE_VAZIO,
      nome: conversa.nomeWhatsapp || '',
      telefone: formatarE164(conversa.numero) || conversa.numero || '',
      conversaId: conversa.id,
    })
  }

  async function salvarCadastro(e) {
    e.preventDefault()
    const { conversaId, ...dados } = cadastro
    try {
      const cliente = await cadastrarClienteDaConversa(conversaId, dados)
      setCadastro(null)
      notificar(`${cliente.nome} cadastrado. A conversa agora aparece na ficha dele.`)
      recarregar()
    } catch (falha) {
      notificar(falha?.message || String(falha), 'erro')
    }
  }

  async function alternarArquivo(conversa) {
    const arquivando = !conversa.arquivada
    try {
      await arquivarConversa(conversa.id, arquivando)
      // Some da lista ao arquivar, então não faz sentido continuar aberta.
      if (arquivando) setAbertaId(null)
      notificar(arquivando ? 'Conversa arquivada.' : 'Conversa devolvida à caixa de entrada.')
      recarregar()
    } catch (falha) {
      notificar(falha?.message || String(falha), 'erro')
    }
  }

  // O painel da direita desenha os dois casos com o mesmo componente: a conversa
  // de verdade e o rascunho. O que muda é só de onde vêm os dados.
  const conversaAberta = aberta
    ? {
        ...aberta,
        clienteNome: clientes.get(aberta.clienteId)?.nome || aberta.nomeWhatsapp || '',
        mensagens: mensagensDaConversa(aberta.id),
      }
    : rascunho
      ? { ...rascunho, mensagens: [], rascunho: true }
      : null

  return (
    <Page>
      {/* Sem PageTitle aqui, ao contrário das outras telas.
          O título "WhatsApp" já está na barra de cima, e o componente o esconde
          quando ele repetiria a rota — sobrava uma faixa vazia só para segurar a
          etiqueta de conexão. A etiqueta desceu para o rodapé (ver o fim deste
          arquivo) e a faixa deixou de ter motivo para existir. */}

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
      {/* A ALTURA, que é o ponto delicado desta tela.
          No desktop o painel preenche o que sobra da janela em vez de ter uma
          altura arbitrária: `70svh` deixava uma faixa morta embaixo, porque 70%
          da tela não tem relação nenhuma com onde a página realmente termina.
          Os 11.25rem descontados são o que existe em volta — 5rem da barra de
          cima, 1.75rem do respiro do topo, mais a linha da etiqueta de conexão e
          o respiro de baixo. O `min-h` segura o caso da janela baixa, em que
          preencher significaria espremer a lista a nada.
          No celular continua `70svh`: lá embaixo há a barra de navegação fixa, e
          a conta seria outra. */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden grid grid-cols-1 lg:grid-cols-[20rem_1fr] h-[70svh] min-h-[30rem] lg:h-[calc(100svh-11.25rem)]">
        <div className={`min-h-0 flex-col border-r border-slate-200 ${aberta ? 'hidden lg:flex' : 'flex'}`}>
          <header className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-slate-200">
            <IconMessage size={16} className="text-slate-400" />
            <h3 className="text-sm font-semibold text-slate-900">
              {verArquivadas ? 'Arquivadas' : 'Conversas'}
            </h3>

            <button
              type="button"
              onClick={() => { setVerArquivadas((v) => !v); setAbertaId(null) }}
              className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
            >
              {verArquivadas ? 'Ver ativas' : 'Ver arquivadas'}
            </button>

            {/* O contador vive aqui, junto da lista que ele conta — e não como
                subtítulo da página. Duas razões:

                  1. Ele fala DESTA lista. Solto lá em cima, sobrava a dúvida de
                     a que ele se referia.
                  2. Zero não vira frase. "Nenhuma mensagem não lida" ocupava uma
                     linha inteira para dizer que não havia nada a dizer — e era
                     o estado mais comum da tela. Sem mensagem nova, o contador
                     simplesmente não existe, e o silêncio já é a informação. */}
            {totalNaoLidas > 0 && (
              <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-blue-500/15 pl-1.5 pr-2.5 py-0.5 text-[11px] font-semibold text-blue-600">
                <span className="inline-flex min-w-[1.15rem] h-[1.15rem] items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-bold text-[var(--btn-primary-fg)] tnum">
                  {totalNaoLidas > 99 ? '99+' : totalNaoLidas}
                </span>
                {totalNaoLidas === 1 ? 'não lida' : 'não lidas'}
              </span>
            )}
          </header>

          <ul className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100">
            {lista.length === 0 && (
              <Empty>
                {verArquivadas
                  ? 'Nenhuma conversa arquivada.'
                  : 'Nenhuma conversa ainda. Elas aparecem sozinhas quando alguém escrever para o número.'}
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

        <div className={`min-h-0 flex-col ${conversaAberta ? 'flex' : 'hidden lg:flex'}`}>
          {conversaAberta ? (
            <>
              <CabecalhoConversa
                conversa={conversaAberta}
                onVoltar={() => { setAbertaId(null); setRascunho(null) }}
                // Vincular, cadastrar e arquivar só existem para conversa que já
                // existe no banco. No rascunho não há o que arquivar, e a pessoa
                // já é cliente — sem estas, o menu inteiro some (ver temMenu).
                onVincular={aberta ? () => setVincular(aberta) : undefined}
                onCadastrar={aberta ? () => abrirCadastro(aberta) : undefined}
                onArquivar={aberta ? () => alternarArquivo(aberta) : undefined}
                acoes={
                  conversaAberta.clienteId ? (
                    <EtapaOportunidade clienteId={conversaAberta.clienteId} onMudou={recarregar} />
                  ) : null
                }
              />

              {/* Os recados internos ficam ENTRE o cabeçalho e as mensagens, e
                  não numa aba: aviso que exige um clique para ser visto não
                  cumpre o papel de avisar. Quem abre a conversa esbarra nele
                  antes de começar a atender, que é o momento em que ele
                  importa. */}
              <NotasDaConversa conversa={conversaAberta} aoMudar={recarregar} />
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

      {/* O estado da conexão, no rodapé.
          É informação ambiente: você quer poder conferir que o número está no ar,
          mas não precisa disso na frente dos olhos toda vez que abre a tela — o
          que importa aqui são as conversas. Quando há problema de verdade, o
          aviso vermelho lá em cima é que chama, e este continua embaixo dizendo
          o mesmo em voz baixa. */}
      {conexao && (
        <div className="mt-3 flex justify-end">
          <Badge color={conexao.conectado ? 'green' : (conexao.indisponivel ? 'amber' : 'red')}>
            {conexao.conectado
              ? `Conectado${conexao.nome ? ` — ${conexao.nome}` : ''}`
              : (conexao.indisponivel ? 'Não foi possível verificar' : 'Desconectado')}
          </Badge>
        </div>
      )}

      <Modal title="Cadastrar como cliente" open={!!cadastro} onClose={() => setCadastro(null)}>
        {cadastro && (
          <form onSubmit={salvarCadastro} className="space-y-4">
            <p className="text-sm text-slate-600">
              Nome e telefone vieram do WhatsApp — confira e complete o que faltar. Ao salvar,
              a conversa passa a aparecer na ficha dele, e a negociação que já existe no CRM
              vira dele em vez de continuar como lead.
            </p>
            <ClienteFormFields
              form={cadastro}
              set={(campo) => (e) => setCadastro((atual) => ({ ...atual, [campo]: e.target.value }))}
              onEnderecoEncontrado={(dados) => setCadastro((atual) => ({ ...atual, ...dados }))}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setCadastro(null)}>Cancelar</Button>
              <Button type="submit">Salvar</Button>
            </div>
          </form>
        )}
      </Modal>

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
