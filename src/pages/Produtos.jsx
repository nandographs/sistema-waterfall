import { useState } from 'react'
import { produtos, definirFotoProduto, removerFotoProduto, formatBRL, TIPOS_PRODUTO, UNIDADES, unidadeDo } from '../data/repository.js'
import { Card, Page, PageTitle, Button, Field, inputCls, InputNumero, Badge, Empty, Modal, usePaginacao, Paginacao } from '../components/ui.jsx'
import { IconPlus, IconImage, IconSearch } from '../components/icons.jsx'
import FotoUnica from '../components/FotoUnica.jsx'
import { combina } from '../lib/texto.js'

// Cor e badge por tipo: aparelho e refil são o miolo do serviço (troca
// agendada); acessório e "outro" só entram na venda.
const COR_DO_TIPO = { aparelho: 'sky', refil: 'green', acessorio: 'amber', outro: 'slate' }

const FORM_VAZIO = {
  nome: '', codigo: '', tipo: 'aparelho', valor: '', cor: '', unidade: 'un',
  intervaloTrocaMeses: '', aparelhoCompativelId: '',
  // Só do formulário: o vínculo mora no refil (aparelhoCompativelId), mas é
  // prático poder escolhê-lo também pelo cadastro do aparelho.
  refilVinculadoId: '',
}

export default function Produtos() {
  const [lista, setLista] = useState(produtos.list())
  const [busca, setBusca] = useState('')
  const [form, setForm] = useState(null) // null = fechado; {id?} = criando/editando
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)

  const refresh = () => setLista(produtos.list())
  const aparelhos = lista.filter((p) => p.tipo === 'aparelho')
  const refis = lista.filter((p) => p.tipo === 'refil')

  const refilDoAparelho = (aparelhoId) =>
    refis.find((r) => r.aparelhoCompativelId === aparelhoId) ?? null

  // A busca filtra só o que a tabela mostra: os selects do formulário continuam
  // enxergando a lista inteira, senão o filtro esconderia justo o vínculo a
  // escolher. O par vinculado entra na busca porque procurar pelo aparelho é a
  // forma natural de chegar no refil dele — e vice-versa.
  const filtrados = lista.filter((p) => {
    const par = p.tipo === 'refil'
      ? produtos.get(p.aparelhoCompativelId)?.nome
      : refilDoAparelho(p.id)?.nome
    return combina(busca, p.nome, p.codigo, p.cor, TIPOS_PRODUTO[p.tipo], par)
  })

  const { visiveis, barra } = usePaginacao(filtrados)

  function abrirEdicao(p) {
    setErro('')
    setForm({
      ...FORM_VAZIO,
      ...p,
      refilVinculadoId: p.tipo === 'aparelho' ? (refilDoAparelho(p.id)?.id ?? '') : '',
    })
  }

  async function salvar(e) {
    e.preventDefault()
    setErro('')
    setSalvando(true)
    try {
      const { refilVinculadoId, ...campos } = form
      const dados = { ...campos, valor: Number(form.valor || 0) }
      const produto = form.id ? await produtos.update(form.id, dados) : await produtos.create(dados)

      // Vínculo escolhido pelo lado do aparelho: como ele é gravado no refil,
      // desfazemos o anterior antes de marcar o novo (um aparelho tem um refil).
      if (produto.tipo === 'aparelho') {
        const anterior = refilDoAparelho(produto.id)
        if (anterior && anterior.id !== refilVinculadoId) {
          await produtos.update(anterior.id, { aparelhoCompativelId: '' })
        }
        if (refilVinculadoId && refilVinculadoId !== anterior?.id) {
          await produtos.update(refilVinculadoId, { aparelhoCompativelId: produto.id })
        }
      }

      setForm(null)
      refresh()
    } catch (ex) {
      setErro(ex?.message || String(ex))
    } finally {
      setSalvando(false)
    }
  }

  async function excluir(id) {
    if (confirm('Excluir este produto?')) {
      await produtos.remove(id)
      refresh()
    }
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  return (
    <Page>
      <PageTitle
        subtitle="Aparelhos, refis, acessórios e serviços — valores, cores e intervalos de troca"
        action={<Button onClick={() => { setErro(''); setForm({ ...FORM_VAZIO }) }}><IconPlus size={16} /> Novo produto</Button>}
      >
        Produtos
      </PageTitle>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className={inputCls + ' pl-9'}
            placeholder="Buscar por nome, código, cor ou tipo…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
      </div>

      <Card>
        {filtrados.length === 0 && (
          <Empty>{busca ? 'Nenhum produto encontrado.' : 'Nenhum produto cadastrado ainda.'}</Empty>
        )}
        {filtrados.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 uppercase border-b border-slate-200">
                  <th className="py-2 pr-4">Produto</th>
                  <th className="py-2 pr-4">Código</th>
                  <th className="py-2 pr-4">Tipo</th>
                  <th className="py-2 pr-4">Cor</th>
                  <th className="py-2 pr-4">Valor de venda</th>
                  <th className="py-2 pr-4">Troca a cada</th>
                  <th className="py-2 pr-4">Compatível com</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visiveis.map((p) => (
                  <tr key={p.id}>
                    <td className="py-3 pr-4 font-medium">
                      <div className="flex items-center gap-2.5">
                        <span className="w-9 h-9 shrink-0 rounded-lg overflow-hidden border border-slate-200 bg-slate-100 flex items-center justify-center text-slate-300">
                          {p.fotoUrl ? (
                            <img src={p.fotoUrl} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <IconImage size={18} />
                          )}
                        </span>
                        {p.nome}
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      {p.codigo
                        ? <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600 tnum">{p.codigo}</span>
                        : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="py-3 pr-4">
                      <Badge color={COR_DO_TIPO[p.tipo] ?? 'slate'}>
                        {TIPOS_PRODUTO[p.tipo] ?? p.tipo}
                      </Badge>
                    </td>
                    <td className="py-3 pr-4">
                      {p.cor ? p.cor : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="py-3 pr-4 whitespace-nowrap">
                      {formatBRL(p.valor)}
                      {/* Só mostramos a unidade quando ela muda o sentido do preço:
                          "por unidade" é o padrão e não precisa ser dito. */}
                      {p.unidade && p.unidade !== 'un' && (
                        <span className="text-slate-400"> /{unidadeDo(p).sigla}</span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      {/* No aparelho mostramos o intervalo do refil dele: é essa a
                          periodicidade da manutenção daquele equipamento. */}
                      {(() => {
                        const meses = p.tipo === 'refil'
                          ? p.intervaloTrocaMeses
                          : refilDoAparelho(p.id)?.intervaloTrocaMeses
                        return meses ? `${meses} meses` : <span className="text-slate-300">—</span>
                      })()}
                    </td>
                    <td className="py-3 pr-4">
                      {p.tipo === 'refil'
                        ? (produtos.get(p.aparelhoCompativelId)?.nome ?? <span className="text-slate-300">—</span>)
                        : (refilDoAparelho(p.id)?.nome ?? <span className="text-slate-300">—</span>)}
                    </td>
                    <td className="py-3 text-right whitespace-nowrap">
                      <Button variant="ghost" onClick={() => abrirEdicao(p)}>Editar</Button>
                      <Button variant="danger" onClick={() => excluir(p.id)}>Excluir</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Paginacao {...barra} />
      </Card>

      <Modal title={form?.id ? 'Editar produto' : 'Novo produto'} open={!!form} onClose={() => { setForm(null); setErro('') }}>
        {form && (
          <form onSubmit={salvar} className="space-y-4">
            {form.id ? (
              <div className="flex justify-center">
                <FotoUnica
                  url={produtos.get(form.id)?.fotoUrl}
                  onEnviar={async (arquivo) => { await definirFotoProduto(form.id, arquivo); refresh() }}
                  onRemover={async () => { await removerFotoProduto(form.id); refresh() }}
                  formato="quadrado"
                  tamanho={104}
                  placeholder={<IconImage size={40} />}
                />
              </div>
            ) : (
              <p className="text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                A foto do produto pode ser adicionada após salvar, editando o produto.
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="col-span-2">
                <Field label="Nome do produto">
                  <input className={inputCls} required value={form.nome} onChange={set('nome')} />
                </Field>
              </div>
              <Field label="Código">
                <input
                  className={inputCls}
                  placeholder="ex.: WF-100"
                  value={form.codigo}
                  onChange={set('codigo')}
                />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Tipo">
                <select className={inputCls} value={form.tipo} onChange={set('tipo')}>
                  {Object.entries(TIPOS_PRODUTO).map(([v, r]) => (
                    <option key={v} value={v}>{r}</option>
                  ))}
                </select>
              </Field>
              <Field label="Unidade de venda">
                <select className={inputCls} value={form.unidade || 'un'} onChange={set('unidade')}>
                  {Object.entries(UNIDADES).map(([v, u]) => (
                    <option key={v} value={v}>{u.rotulo} ({u.sigla})</option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label={`Valor de venda (R$ por ${unidadeDo(form).sigla})`}>
                <InputNumero className={inputCls} step="0.01" min="0" required value={form.valor} onChange={set('valor')} />
              </Field>
              {/* Cor é opcional de propósito: boa parte do catálogo não tem. */}
              <Field label="Cor (se tiver)">
                <input className={inputCls} placeholder="ex.: Branca" value={form.cor || ''} onChange={set('cor')} />
              </Field>
            </div>
            {unidadeDo(form).fracionavel && (
              <p className="text-xs text-slate-500">
                Vendido por {unidadeDo(form).rotulo.toLowerCase()}: na venda a quantidade
                aceita fração (2,5 {unidadeDo(form).sigla}) e o total sai proporcional.
              </p>
            )}
            {form.tipo === 'refil' && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Troca a cada (meses)">
                    <InputNumero className={inputCls} min="1" step="1" required value={form.intervaloTrocaMeses} onChange={set('intervaloTrocaMeses')} />
                  </Field>
                  <Field label="Aparelho compatível">
                    <select className={inputCls} value={form.aparelhoCompativelId} onChange={set('aparelhoCompativelId')}>
                      <option value="">Selecione…</option>
                      {aparelhos.map((a) => (
                        <option key={a.id} value={a.id}>{a.nome}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <p className="text-xs text-slate-500">
                  É esse intervalo que agenda as trocas sozinho: ao vender o aparelho, a
                  primeira troca já entra na agenda, e cada troca concluída marca a seguinte.
                </p>
              </div>
            )}

            {form.tipo === 'aparelho' && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
                <Field label="Refil deste aparelho">
                  {refis.length === 0 ? (
                    <p className="text-xs text-slate-400">
                      Nenhum refil cadastrado ainda. Cadastre o refil e informe o intervalo de troca.
                    </p>
                  ) : (
                    <select
                      className={inputCls}
                      value={form.refilVinculadoId}
                      onChange={set('refilVinculadoId')}
                      disabled={!form.id}
                    >
                      <option value="">Nenhum</option>
                      {refis.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.nome}
                          {r.intervaloTrocaMeses ? ` — troca a cada ${r.intervaloTrocaMeses} meses` : ' — sem intervalo definido'}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <p className="text-xs text-slate-500">
                  {form.id
                    ? 'Vincular aqui é o mesmo que escolher este aparelho no cadastro do refil — é o que faz a troca ser agendada sozinha ao vender.'
                    : 'Salve o aparelho primeiro; depois, editando, você poderá vincular o refil dele.'}
                </p>
              </div>
            )}
            {erro && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setForm(null)}>Cancelar</Button>
              <Button type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</Button>
            </div>
          </form>
        )}
      </Modal>
    </Page>
  )
}
