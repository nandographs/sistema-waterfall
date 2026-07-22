import { useState } from 'react'
import { produtos, definirFotoProduto, removerFotoProduto, formatBRL } from '../data/repository.js'
import { Card, Page, PageTitle, Button, Field, inputCls, Badge, Empty, Modal } from '../components/ui.jsx'
import { IconPlus, IconImage } from '../components/icons.jsx'
import FotoUnica from '../components/FotoUnica.jsx'

const FORM_VAZIO = { nome: '', tipo: 'aparelho', valor: '', intervaloTrocaMeses: '', aparelhoCompativelId: '' }

export default function Produtos() {
  const [lista, setLista] = useState(produtos.list())
  const [form, setForm] = useState(null) // null = fechado; {id?} = criando/editando

  const refresh = () => setLista(produtos.list())
  const aparelhos = lista.filter((p) => p.tipo === 'aparelho')

  async function salvar(e) {
    e.preventDefault()
    const dados = { ...form, valor: Number(form.valor || 0) }
    if (form.id) await produtos.update(form.id, dados)
    else await produtos.create(dados)
    setForm(null)
    refresh()
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
        subtitle="Aparelhos, refis, valores e intervalos de troca"
        action={<Button onClick={() => setForm({ ...FORM_VAZIO })}><IconPlus size={16} /> Novo produto</Button>}
      >
        Produtos
      </PageTitle>

      <Card>
        {lista.length === 0 && <Empty>Nenhum produto cadastrado ainda.</Empty>}
        {lista.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 uppercase border-b border-slate-200">
                  <th className="py-2 pr-4">Produto</th>
                  <th className="py-2 pr-4">Tipo</th>
                  <th className="py-2 pr-4">Valor de venda</th>
                  <th className="py-2 pr-4">Troca a cada</th>
                  <th className="py-2 pr-4">Compatível com</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lista.map((p) => (
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
                      <Badge color={p.tipo === 'aparelho' ? 'sky' : 'green'}>
                        {p.tipo === 'aparelho' ? 'Aparelho' : 'Refil'}
                      </Badge>
                    </td>
                    <td className="py-3 pr-4">{formatBRL(p.valor)}</td>
                    <td className="py-3 pr-4">
                      {p.tipo === 'refil' && p.intervaloTrocaMeses ? `${p.intervaloTrocaMeses} meses` : '—'}
                    </td>
                    <td className="py-3 pr-4">
                      {p.tipo === 'refil' ? (produtos.get(p.aparelhoCompativelId)?.nome ?? '—') : '—'}
                    </td>
                    <td className="py-3 text-right whitespace-nowrap">
                      <Button variant="ghost" onClick={() => setForm({ ...FORM_VAZIO, ...p })}>Editar</Button>
                      <Button variant="danger" onClick={() => excluir(p.id)}>Excluir</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal title={form?.id ? 'Editar produto' : 'Novo produto'} open={!!form} onClose={() => setForm(null)}>
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
            <Field label="Nome do produto">
              <input className={inputCls} required value={form.nome} onChange={set('nome')} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Tipo">
                <select className={inputCls} value={form.tipo} onChange={set('tipo')}>
                  <option value="aparelho">Aparelho</option>
                  <option value="refil">Refil</option>
                </select>
              </Field>
              <Field label="Valor de venda (R$)">
                <input className={inputCls} type="number" step="0.01" min="0" required value={form.valor} onChange={set('valor')} />
              </Field>
            </div>
            {form.tipo === 'refil' && (
              <div className="grid grid-cols-2 gap-4">
                <Field label="Troca a cada (meses)">
                  <input className={inputCls} type="number" min="1" required value={form.intervaloTrocaMeses} onChange={set('intervaloTrocaMeses')} />
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
            )}
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
