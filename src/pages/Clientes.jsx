import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  clientes, agendamentos, equipamentos, vendas, proximaTroca, formatData,
} from '../data/repository.js'
import { Card, Page, PageTitle, Button, inputCls, Empty, Modal, Badge } from '../components/ui.jsx'
import { IconPlus, IconSearch, IconUser, IconFilter } from '../components/icons.jsx'
import ClienteFormFields from '../components/ClienteFormFields.jsx'
import { usuarioAtual } from '../lib/auth.js'

const FORM_VAZIO = {
  nome: '', telefone: '', email: '', cpfCnpj: '',
  endereco: '', numeroComplemento: '', bairro: '', cidade: '', uf: '', cep: '',
  observacoes: '',
}

// Dias à frente que contam como "troca prevista" (além das já atrasadas)
const JANELA_TROCA_DIAS = 30

const normalizar = (s) => String(s || '').trim().toLowerCase()

const selectCls = inputCls + ' cursor-pointer'

export default function Clientes() {
  const [lista, setLista] = useState(clientes.list())
  const [busca, setBusca] = useState('')
  const [form, setForm] = useState(null)

  const [cidade, setCidade] = useState('')
  const [uf, setUf] = useState('')
  const [somenteTroca, setSomenteTroca] = useState(false)
  const [somentePendente, setSomentePendente] = useState(false)
  const [visita, setVisita] = useState('todos') // 'todos' | 'com' | 'sem'

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

  function proximaVisita(clienteId) {
    const hoje = new Date().toISOString().slice(0, 10)
    return agendamentos
      .list()
      .filter((a) => a.clienteId === clienteId && a.status === 'agendado' && a.data >= hoje)
      .sort((a, b) => a.data.localeCompare(b.data))[0]
  }

  function temTrocaPrevista(clienteId) {
    const limite = new Date()
    limite.setDate(limite.getDate() + JANELA_TROCA_DIAS)
    const limiteStr = limite.toISOString().slice(0, 10)
    return equipamentos
      .list()
      .filter((eq) => eq.clienteId === clienteId)
      .some((eq) => {
        const prevista = proximaTroca(eq)
        return prevista && prevista <= limiteStr
      })
  }

  function temPagamentoPendente(clienteId) {
    return vendas.list().some((v) => v.clienteId === clienteId && v.status === 'pendente')
  }

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

  const qtdFiltros = [cidade, uf, somenteTroca, somentePendente, visita !== 'todos'].filter(Boolean).length
  const filtrosAtivos = qtdFiltros > 0

  function limparFiltros() {
    setCidade('')
    setUf('')
    setSomenteTroca(false)
    setSomentePendente(false)
    setVisita('todos')
  }

  const filtrados = lista.filter((c) => {
    const q = busca.toLowerCase()
    const passaBusca = c.nome?.toLowerCase().includes(q) || c.telefone?.toLowerCase().includes(q)
    if (!passaBusca) return false
    if (cidade && normalizar(c.cidade) !== normalizar(cidade)) return false
    if (uf && (c.uf || '').toUpperCase() !== uf) return false
    if (somenteTroca && !temTrocaPrevista(c.id)) return false
    if (somentePendente && !temPagamentoPendente(c.id)) return false
    if (visita === 'com' && !proximaVisita(c.id)) return false
    if (visita === 'sem' && proximaVisita(c.id)) return false
    return true
  })

  async function salvar(e) {
    e.preventDefault()
    // Ao criar, registra quem cadastrou (usuário logado). Ao editar, não mexe.
    if (form.id) await clientes.update(form.id, form)
    else await clientes.create({ ...form, criadoPor: usuarioAtual() })
    setForm(null)
    setLista(clientes.list())
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const preencherEndereco = (dados) => setForm((atual) => ({ ...atual, ...dados }))

  return (
    <Page>
      <PageTitle
        subtitle="Cadastro e histórico dos seus clientes"
        action={<Button onClick={() => setForm({ ...FORM_VAZIO })}><IconPlus size={16} /> Novo cliente</Button>}
      >
        Clientes
      </PageTitle>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className={inputCls + ' pl-9'}
            placeholder="Buscar por nome ou telefone…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>

        <div className="relative" ref={painelRef}>
          <Button variant="secondary" onClick={() => setPainelAberto((v) => !v)}>
            <IconFilter size={16} /> Filtrar por
            {qtdFiltros > 0 && (
              <span className="ml-1 inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-blue-600 text-white text-xs font-semibold">
                {qtdFiltros}
              </span>
            )}
          </Button>

          {painelAberto && (
            <div className="absolute right-0 z-20 mt-2 w-72 max-w-[calc(100vw-3rem)] bg-white rounded-xl border border-slate-200 shadow-lg p-4 space-y-4">
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
        </p>
        {filtrados.length === 0 && (
          <Empty>{busca || filtrosAtivos ? 'Nenhum cliente encontrado.' : 'Nenhum cliente cadastrado ainda.'}</Empty>
        )}
        <ul className="divide-y divide-slate-100">
          {filtrados.map((c) => {
            const prox = proximaVisita(c.id)
            return (
              <li key={c.id} className="py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-10 h-10 shrink-0 rounded-full overflow-hidden border border-slate-200 bg-slate-100 flex items-center justify-center text-slate-300">
                    {c.fotoPerfilUrl ? (
                      <img src={c.fotoPerfilUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <IconUser size={20} />
                    )}
                  </span>
                  <div className="min-w-0">
                    <Link to={`/clientes/${c.id}`} className="font-medium text-sky-700 hover:underline">
                      {c.nome}
                    </Link>
                    <p className="text-xs text-slate-500">
                      {c.telefone || 'sem telefone'}
                      {c.cidade ? ` · ${c.cidade}${c.uf ? '/' + c.uf.toUpperCase() : ''}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {temPagamentoPendente(c.id) && <Badge color="amber">A receber</Badge>}
                  {temTrocaPrevista(c.id) && <Badge color="red">Troca de refil</Badge>}
                  {prox ? <Badge color="sky">Próx. visita: {formatData(prox.data)}</Badge> : <Badge>Sem visita marcada</Badge>}
                </div>
              </li>
            )
          })}
        </ul>
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
