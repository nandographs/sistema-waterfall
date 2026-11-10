import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  clientes, agendamentos, equipamentos, lancamentos, proximaTroca, formatData,
  explicarColunaFaltante, clienteInativo, unidades, haDistribuidores, unidadeForaDaCasa, assinarDados,
} from '../data/repository.js'
import {
  Card, Page, PageTitle, Button, inputCls, Empty, Modal, Badge, notificar, usePaginacao, Paginacao,
  CampoBusca, SemResultado, useLembrado,
} from '../components/ui.jsx'
import { IconPlus, IconUser, IconFilter, IconFileText } from '../components/icons.jsx'
import ClienteFormFields from '../components/ClienteFormFields.jsx'
import { usuarioAtual, ehGestao } from '../lib/auth.js'
import { telefonesDoCliente, comTelefonePrincipal } from '../lib/telefone.js'
import { indexarBusca, prepararBusca, filtrarPorBusca } from '../lib/texto.js'
import { gerarClientesPdf } from '../relatorio/clientes.js'

const FORM_VAZIO = {
  nome: '', telefone: '', telefones: [], email: '', cpfCnpj: '', nascimento: '',
  conjugeNome: '', conjugeTelefone: '', conjugeCpf: '', conjugeNascimento: '',
  endereco: '', numeroComplemento: '', bairro: '', cidade: '', uf: '', cep: '',
  observacoes: '',
}

// Dias à frente que contam como "troca prevista" (além das já atrasadas)
const JANELA_TROCA_DIAS = 30

const normalizar = (s) => String(s || '').trim().toLowerCase()

const selectCls = inputCls + ' cursor-pointer'

// Como a lista é ordenada. Fica FORA do painel "Filtrar por" de propósito:
// filtro ou está ligado ou não, e o contador diz quantos são; ordem está sempre
// valendo, então precisa ficar à vista para você saber o que está olhando.
const ORDENS = {
  recentes: 'Mais recentes',
  antigos: 'Mais antigos',
  nome: 'Nome (A–Z)',
}

// A ordem do cadastro é `criadoEm` — a data em que o cliente entrou no sistema.
// Comparação de texto porque o timestamptz do Postgres vem em ISO, e ISO ordena
// certo como string.
function compararClientes(ordem) {
  if (ordem === 'nome') {
    return (a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR')
  }
  return (a, b) => {
    const chaveA = String(a.criadoEm || '')
    const chaveB = String(b.criadoEm || '')
    return ordem === 'antigos' ? chaveA.localeCompare(chaveB) : chaveB.localeCompare(chaveA)
  }
}

export default function Clientes() {
  const [lista, setLista] = useState(clientes.list())
  // Agendamentos, equipamentos e lançamentos também mudam por fora (concluir
  // um serviço, dar baixa): a versão faz os índices abaixo serem refeitos.
  const [versao, setVersao] = useState(0)
  useEffect(() => assinarDados(() => {
    setLista(clientes.list())
    setVersao((v) => v + 1)
  }), [])

  // Busca, filtros e ordem são lembrados na sessão: abrir a ficha de um
  // cliente e voltar devolve a lista como você a deixou.
  const [busca, setBusca] = useLembrado('clientes:busca', '')
  const [form, setForm] = useState(null)
  const [baixandoPdf, setBaixandoPdf] = useState(false)

  const [cidade, setCidade] = useLembrado('clientes:cidade', '')
  const [uf, setUf] = useLembrado('clientes:uf', '')
  const [somenteTroca, setSomenteTroca] = useLembrado('clientes:troca', false)
  const [somentePendente, setSomentePendente] = useLembrado('clientes:pendente', false)
  const [visita, setVisita] = useLembrado('clientes:visita', 'todos') // 'todos' | 'com' | 'sem'
  // Inativo sai da lista por padrão — é para isso que se inativa. 'ativos' é o
  // estado de repouso e não conta como filtro ligado.
  const [situacao, setSituacao] = useLembrado('clientes:situacao', 'ativos') // 'ativos' | 'inativos' | 'todos'
  // De qual unidade (migração 031). Só a gestão enxerga mais de uma, e só
  // quando já existe distribuidor — antes disso o filtro não teria escolha.
  const [unidade, setUnidade] = useLembrado('clientes:unidade', '')
  const mostrarUnidade = ehGestao() && haDistribuidores()
  // O cache vem do banco em ordem de cadastro crescente, o que deixava quem
  // acabou de ser cadastrado no fim da lista — justamente quem você mais procura.
  const [ordem, setOrdem] = useLembrado('clientes:ordem', 'recentes')

  // A digitação fica com o campo; a lista acompanha logo atrás. Com milhares
  // de clientes, filtrar no mesmo quadro da tecla é o que fazia letras
  // "sumirem" e o campo travar.
  const buscaAdiada = useDeferredValue(busca)
  const consulta = useMemo(() => prepararBusca(buscaAdiada), [buscaAdiada])

  // Painel "Filtrar por" (abre/fecha; fecha ao clicar fora)
  const [painelAberto, setPainelAberto] = useState(false)
  const painelRef = useRef(null)
  useEffect(() => {
    if (!painelAberto) return
    function aoClicarFora(e) {
      if (painelRef.current && !painelRef.current.contains(e.target)) setPainelAberto(false)
    }
    document.addEventListener('mousedown', aoClicarFora)
    return () => document.removeEventListener('mousedown', aoClicarFora)
  }, [painelAberto])

  // O que cada cliente tem em volta (próxima visita, troca, pendência) e o
  // texto da busca dele, montados numa passada só por tabela.
  //
  // Antes cada uma dessas perguntas varria a tabela inteira POR CLIENTE, e era
  // feita de novo a cada tecla: 2.600 clientes × milhares de agendamentos por
  // letra digitada. Agora é uma leitura de Map.
  const { visitaDe, trocaDe, pendenteDe, indiceDe } = useMemo(() => {
    const hoje = new Date().toISOString().slice(0, 10)
    const visitas = new Map()
    for (const a of agendamentos.list()) {
      if (a.status !== 'agendado' || !a.data || a.data < hoje) continue
      const atual = visitas.get(a.clienteId)
      if (!atual || a.data < atual.data) visitas.set(a.clienteId, a)
    }

    const limite = new Date()
    limite.setDate(limite.getDate() + JANELA_TROCA_DIAS)
    const limiteStr = limite.toISOString().slice(0, 10)
    const trocas = new Set()
    for (const eq of equipamentos.list()) {
      if (trocas.has(eq.clienteId)) continue
      const prevista = proximaTroca(eq)
      if (prevista && prevista <= limiteStr) trocas.add(eq.clienteId)
    }

    const pendentes = new Set()
    for (const l of lancamentos.list()) {
      if (l.tipo === 'entrada' && l.status === 'previsto') pendentes.add(l.clienteId)
    }

    // A busca olha o nome, TODOS os telefones, o cônjuge, a cidade e o bairro.
    // Quem liga muitas vezes é a esposa, e quem procura a ficha só lembra do
    // nome dela — ou de que "é aquela de Itapema".
    const indices = new Map()
    for (const c of lista) {
      indices.set(c.id, indexarBusca({
        principal: c.nome,
        outros: [c.conjugeNome, c.cidade, c.bairro, c.email],
        numeros: [...telefonesDoCliente(c).map((t) => t.numero), c.conjugeTelefone, c.cpfCnpj],
      }))
    }

    return {
      visitaDe: (id) => visitas.get(id),
      // Inativo não tem troca prevista: o aparelho pode até estar lá, mas
      // ninguém vai trocar refil de quem deixou de ser cliente.
      trocaDe: (c) => !clienteInativo(c) && trocas.has(c.id),
      pendenteDe: (id) => pendentes.has(id),
      indiceDe: (c) => indices.get(c.id),
    }
    // `versao` muda quando qualquer tabela do cache muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lista, versao])

  // Opções dos seletores, deduplicadas ignorando maiúsculas/espaços
  // (cobre cadastros antigos digitados à mão de formas diferentes)
  const cidades = useMemo(() => {
    const mapa = new Map()
    for (const c of lista) {
      const chave = normalizar(c.cidade)
      if (chave && !mapa.has(chave)) mapa.set(chave, c.cidade.trim())
    }
    return [...mapa.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [lista])

  const ufs = useMemo(() => {
    const set = new Set()
    for (const c of lista) if (c.uf) set.add(c.uf.trim().toUpperCase())
    return [...set].sort()
  }, [lista])

  const qtdFiltros = [unidade, cidade, uf, somenteTroca, somentePendente, visita !== 'todos', situacao !== 'ativos'].filter(Boolean).length
  const filtrosAtivos = qtdFiltros > 0

  function limparFiltros() {
    setUnidade('')
    setCidade('')
    setUf('')
    setSomenteTroca(false)
    setSomentePendente(false)
    setVisita('todos')
    setSituacao('ativos')
  }

  function limparTudo() {
    setBusca('')
    limparFiltros()
  }

  // Todos os filtros menos o de situação — separado para saber quantos
  // inativos a busca acharia e avisar, em vez de dizer "nenhum cliente" para
  // quem procurou alguém que só está inativo.
  function passaFiltros(c) {
    if (unidade && c.unidadeId !== unidade) return false
    if (cidade && normalizar(c.cidade) !== normalizar(cidade)) return false
    if (uf && (c.uf || '').toUpperCase() !== uf) return false
    if (somenteTroca && !trocaDe(c)) return false
    if (somentePendente && !pendenteDe(c.id)) return false
    if (visita === 'com' && !visitaDe(c.id)) return false
    if (visita === 'sem' && visitaDe(c.id)) return false
    return true
  }

  function passaSituacao(c) {
    if (situacao === 'ativos') return !clienteInativo(c)
    if (situacao === 'inativos') return clienteInativo(c)
    return true
  }

  // Filtros, depois a ordem escolhida, depois a busca. Com busca, quem tem o
  // NOME começando pelo que foi digitado sobe para o topo ("ana" traz a Ana
  // antes da Mariana); dentro de cada faixa, a ordem escolhida continua valendo.
  const { filtrados, inativosOcultos } = useMemo(() => {
    const ordenados = lista.filter(passaFiltros).sort(compararClientes(ordem))
    const achados = filtrarPorBusca(ordenados, consulta, indiceDe, { porRelevancia: true })
    return {
      filtrados: achados.filter(passaSituacao),
      inativosOcultos: situacao === 'ativos' ? achados.filter(clienteInativo).length : 0,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lista, versao, consulta, ordem, unidade, cidade, uf, somenteTroca, somentePendente, visita, situacao, indiceDe])

  // Só o desenho é paginado. O PDF e a contagem continuam usando `filtrados`
  // inteiro: quem pede "baixar PDF" quer a lista que filtrou, não a página.
  const { visiveis, barra } = usePaginacao(filtrados, {
    lembrarComo: 'clientes',
    reiniciarCom: JSON.stringify([buscaAdiada.trim(), ordem, unidade, cidade, uf, somenteTroca, somentePendente, visita, situacao]),
  })
  // A lista ainda está alcançando o que foi digitado.
  const atualizando = busca !== buscaAdiada

  // O que está ligado na tela, em palavras. Vai no subtítulo do PDF e no nome
  // do arquivo: um relatório de "só Itapema" sem dizer isso na folha vira, uma
  // semana depois, a lista completa de clientes na cabeça de quem lê.
  function descricaoDosFiltros() {
    const partes = []
    if (busca.trim()) partes.push(`Busca: ${busca.trim()}`)
    if (unidade) partes.push(`Unidade: ${unidades.get(unidade)?.nome || ''}`)
    if (cidade) partes.push(`Cidade: ${cidade}`)
    if (uf) partes.push(`UF: ${uf}`)
    if (visita === 'com') partes.push('Com visita agendada')
    if (visita === 'sem') partes.push('Sem visita agendada')
    if (somenteTroca) partes.push('Troca de refil prevista')
    if (somentePendente) partes.push('Pagamento pendente')
    if (situacao === 'inativos') partes.push('Só inativos')
    if (situacao === 'todos') partes.push('Ativos e inativos')
    return partes
  }

  async function baixarPdf() {
    setBaixandoPdf(true)
    try {
      await gerarClientesPdf({
        clientes: filtrados.map((c) => {
          const prox = visitaDe(c.id)
          return {
            nome: c.nome,
            telefones: telefonesDoCliente(c).map((t) => t.numero),
            cidade: c.cidade,
            uf: c.uf,
            conjugeNome: c.conjugeNome,
            criadoEm: c.criadoEm,
            situacao: [
              clienteInativo(c) ? 'Inativo' : '',
              pendenteDe(c.id) ? 'A receber' : '',
              trocaDe(c) ? 'Troca de refil' : '',
              prox ? `Próx. visita ${formatData(prox.data)}` : 'Sem visita marcada',
            ].filter(Boolean),
          }
        }),
        filtros: descricaoDosFiltros(),
        ordem: ORDENS[ordem],
        emitidoEm: new Date().toISOString().slice(0, 10),
      })
    } catch (erro) {
      notificar('Não foi possível gerar o PDF: ' + (erro?.message || erro), 'erro')
    } finally {
      setBaixandoPdf(false)
    }
  }

  async function salvar(e) {
    e.preventDefault()
    try {
      // Ao criar, registra quem cadastrou (usuário logado). Ao editar, não mexe.
      if (form.id) await clientes.update(form.id, comTelefonePrincipal(form)).catch(explicarColunaFaltante)
      else await clientes.create(comTelefonePrincipal({ ...form, criadoPor: usuarioAtual() })).catch(explicarColunaFaltante)
      setForm(null)
      setLista(clientes.list())
    } catch (erro) {
      notificar('Não foi possível salvar o cliente: ' + (erro?.message || erro), 'erro')
    }
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const preencherEndereco = (dados) => setForm((atual) => ({ ...atual, ...dados }))

  return (
    <Page>
      <PageTitle
        subtitle="Cadastro e histórico dos seus clientes"
        action={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={baixarPdf} disabled={baixandoPdf || filtrados.length === 0}>
              <IconFileText size={16} /> {baixandoPdf ? 'Gerando…' : 'Baixar PDF'}
            </Button>
            <Button onClick={() => setForm({ ...FORM_VAZIO })}><IconPlus size={16} /> Novo cliente</Button>
          </div>
        }
      >
        Clientes
      </PageTitle>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <CampoBusca
          className="flex-1 min-w-[220px] max-w-sm"
          placeholder="Buscar por nome, telefone, cônjuge ou cidade…"
          aria-label="Buscar clientes"
          value={busca}
          onChange={setBusca}
        />

        {/* A largura mora no wrapper: `inputCls` já traz `w-full`, e como as
            duas classes têm a mesma especificidade quem manda é a ordem no CSS
            gerado, não a ordem aqui — um `w-auto` no select seria ignorado. */}
        <div className="w-40 shrink-0">
          <select
            className={selectCls}
            value={ordem}
            onChange={(e) => setOrdem(e.target.value)}
            aria-label="Ordenar clientes por"
          >
            {Object.entries(ORDENS).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
          </select>
        </div>

        <div className="relative" ref={painelRef}>
          <Button variant="secondary" onClick={() => setPainelAberto((v) => !v)}>
            <IconFilter size={16} /> Filtrar por
            {qtdFiltros > 0 && (
              <span className="ml-1 text-xs font-medium text-blue-600 tnum">
                {qtdFiltros}
              </span>
            )}
          </Button>

          {painelAberto && (
            <div className="absolute right-0 z-20 mt-2 w-72 max-w-[calc(100vw-3rem)] rounded-2xl superficie-flutuante p-4 space-y-4">
              {mostrarUnidade && (
                <div>
                  <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Unidade</label>
                  <select className={selectCls} value={unidade} onChange={(e) => setUnidade(e.target.value)}>
                    <option value="">Todas as unidades</option>
                    {unidades.list().map((u) => (
                      <option key={u.id} value={u.id}>{u.nome}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Situação</label>
                <select className={selectCls} value={situacao} onChange={(e) => setSituacao(e.target.value)}>
                  <option value="ativos">Ativos</option>
                  <option value="inativos">Inativos</option>
                  <option value="todos">Ativos e inativos</option>
                </select>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Cidade</label>
                <select className={selectCls} value={cidade} onChange={(e) => setCidade(e.target.value)}>
                  <option value="">Todas as cidades</option>
                  {cidades.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Estado (UF)</label>
                <select className={selectCls} value={uf} onChange={(e) => setUf(e.target.value)}>
                  <option value="">Todos os estados</option>
                  {ufs.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Visita</label>
                <select className={selectCls} value={visita} onChange={(e) => setVisita(e.target.value)}>
                  <option value="todos">Com ou sem visita</option>
                  <option value="com">Com visita agendada</option>
                  <option value="sem">Sem visita agendada</option>
                </select>
              </div>
              <div className="space-y-2 pt-1 border-t border-slate-100">
                <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
                  <input type="checkbox" className="accent-blue-600" checked={somenteTroca} onChange={(e) => setSomenteTroca(e.target.checked)} />
                  Troca de refil prevista/atrasada
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
                  <input type="checkbox" className="accent-blue-600" checked={somentePendente} onChange={(e) => setSomentePendente(e.target.checked)} />
                  Pagamento pendente
                </label>
              </div>
              {filtrosAtivos && (
                <button
                  className="w-full text-sm font-medium text-slate-500 hover:text-slate-700 cursor-pointer pt-1"
                  onClick={limparFiltros}
                >
                  Limpar filtros
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <Card>
        <p className="text-xs text-slate-400 mb-3">
          {filtrados.length} cliente{filtrados.length === 1 ? '' : 's'}
          {inativosOcultos > 0 && (
            <>
              {' · '}
              <button
                type="button"
                className="font-medium text-blue-600 hover:underline cursor-pointer"
                onClick={() => setSituacao('todos')}
              >
                {inativosOcultos === 1 ? 'ver 1 inativo' : `ver ${inativosOcultos} inativos`}
              </button>
            </>
          )}
        </p>
        {filtrados.length === 0 && (
          buscaAdiada.trim() || filtrosAtivos
            ? <SemResultado busca={buscaAdiada} filtros={filtrosAtivos} onLimpar={limparTudo}>Nenhum cliente encontrado</SemResultado>
            : <Empty>Nenhum cliente cadastrado ainda.</Empty>
        )}
        <ul className={`divide-y divide-slate-100 transition-opacity ${atualizando ? 'opacity-60' : ''}`}>
          {visiveis.map((c) => {
            const prox = visitaDe(c.id)
            const inativo = clienteInativo(c)
            return (
              <li key={c.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-10 h-10 shrink-0 rounded-full overflow-hidden border border-slate-200 bg-slate-100 flex items-center justify-center text-slate-400">
                    {c.fotoPerfilUrl ? (
                      <img src={c.fotoPerfilUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <IconUser size={20} />
                    )}
                  </span>
                  <div className="min-w-0">
                    <Link to={`/clientes/${c.id}`} className="font-semibold text-slate-900 hover:text-blue-600">
                      {c.nome}
                    </Link>
                    <p className="text-xs text-slate-500">
                      {telefonesDoCliente(c)[0]?.numero || 'sem telefone'}
                      {/* Quantos outros existem — sem isso, quem buscou pelo
                          telefone da esposa não entende por que este cliente
                          apareceu com outro número na tela. */}
                      {telefonesDoCliente(c).length > 1 && ` +${telefonesDoCliente(c).length - 1}`}
                      {c.conjugeNome ? ` · cônjuge: ${c.conjugeNome}` : ''}
                      {c.cidade ? ` · ${c.cidade}${c.uf ? '/' + c.uf.toUpperCase() : ''}` : ''}
                      {/* Só quando a ordem é por data: ordenar por algo que não
                          está na tela deixa a lista sem explicação. Em A–Z a
                          data não diz nada e viraria ruído. */}
                      {ordem !== 'nome' && c.criadoEm ? ` · cadastrado em ${formatData(c.criadoEm)}` : ''}
                    </p>
                  </div>
                </div>
                {/* shrink-0 sem wrap somava ~300px de badges ao lado do nome e
                    estourava o card no celular; agora quebram na linha de baixo. */}
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 pl-13 sm:pl-0 sm:shrink-0">
                  {mostrarUnidade && unidadeForaDaCasa(c) && <Badge color="sky">{unidadeForaDaCasa(c).nome}</Badge>}
                  {pendenteDe(c.id) && <Badge color="amber">A receber</Badge>}
                  {trocaDe(c) && <Badge color="red">Troca de refil</Badge>}
                  {inativo
                    ? <Badge>Inativo</Badge>
                    : prox ? <Badge color="sky">Próx. visita: {formatData(prox.data)}</Badge> : <Badge>Sem visita marcada</Badge>}
                </div>
              </li>
            )
          })}
        </ul>
        <Paginacao {...barra} />
      </Card>

      <Modal title="Novo cliente" open={!!form} onClose={() => setForm(null)}>
        {form && (
          <form onSubmit={salvar} className="space-y-4">
            <ClienteFormFields form={form} set={set} onEnderecoEncontrado={preencherEndereco} />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setForm(null)}>Cancelar</Button>
              <Button type="submit">Salvar</Button>
            </div>
          </form>
        )}
      </Modal>
    </Page>
  )
}
