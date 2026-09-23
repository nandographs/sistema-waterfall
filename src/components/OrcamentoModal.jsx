import { useState } from 'react'
import {
  clientes, produtos, salvarVenda, totaisDaVenda, itensDaVenda, hojeISO, formatBRL,
  UNIDADES, unidadeDo, nomeCompletoProduto,
} from '../data/repository.js'
import { gerarOrcamentoPdf } from '../orcamento/gerarPdf.js'
import { montarDadosOrcamento, MAX_ITENS } from '../orcamento/html.js'
import { Modal, Button, Field, inputCls, InputNumero, notificar } from './ui.jsx'
import { IconPlus, IconTrash, IconFileText } from './icons.jsx'
import ClienteBusca from './ClienteBusca.jsx'
import ProdutoBusca from './ProdutoBusca.jsx'

const ITEM_VAZIO = { produtoId: '', descricao: '', quantidade: 1, unidade: 'un', valorUnitario: '', desconto: '' }

// Uma proposta é uma venda de tipo "orcamento" — não uma tabela nova. Assim ela
// já nasce na lista de Vendas, pode virar venda com um clique e entra nas buscas
// e relatórios sem código paralelo.
//
// O que este formulário NÃO pergunta é o ponto dele: pagamento, parcelas,
// entrega e canal só existem no fechamento. Perguntar isso para mandar um preço
// por WhatsApp é o que fazia ninguém usar o caminho que já existia.
const FORM_VAZIO = {
  clienteId: '', data: hojeISO(), validadeDias: 15, numero: '',
  desconto: '', observacoes: '',
  consultor: '', consultorTelefone: '',

  // Proposta não é dinheiro no caixa: fica como `proposta`, sem lançar nada no
  // financeiro. Só a confirmação da venda (em Vendas) gera contas a receber.
  tipo: 'orcamento', status: 'proposta', frete: '', lancarFinanceiro: false,
  formaPagamento: '', condicao: 'a_vista', entrada: '', parcelas: 1, primeiroVencimento: '',
  canal: '', entregaTipo: '', entregaEndereco: '', entregaPrevisao: '',
}

// O consultor quase nunca muda de um orçamento para o outro; guardar o último
// evita redigitar o próprio nome a cada proposta. Mesma chave do PedidoModal,
// de propósito: é a mesma pessoa nos dois documentos.
const CHAVE_CONSULTOR = 'waterfall:pedido_consultor'

export default function OrcamentoModal({ venda, open, onClose, onSalvo }) {
  const [form, setForm] = useState(() => (venda
    ? { ...FORM_VAZIO, ...venda }
    : { ...FORM_VAZIO, consultor: localStorage.getItem(CHAVE_CONSULTOR) || '' }))
  const [itens, setItens] = useState(() => {
    const existentes = venda ? itensDaVenda(venda.id) : []
    return existentes.length ? existentes.map((i) => ({ ...i })) : [{ ...ITEM_VAZIO }]
  })
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)

  const listaProdutos = produtos.list()
  const { subtotal, total } = totaisDaVenda(itens, form.desconto, 0)

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  // Escolher o produto puxa nome e preço de tabela; ambos continuam editáveis —
  // desconto de proposta costuma ser no valor, não em campo separado.
  function alterarItem(indice, campo, valor) {
    setItens(itens.map((item, i) => {
      if (i !== indice) return item
      if (campo !== 'produtoId') return { ...item, [campo]: valor }
      const produto = produtos.get(valor)
      return {
        ...item,
        produtoId: valor,
        // Com a cor junto: é o texto que o cliente lê na proposta.
        descricao: nomeCompletoProduto(produto),
        unidade: produto?.unidade || 'un',
        valorUnitario: produto ? Number(produto.valor || 0) : item.valorUnitario,
      }
    }))
  }

  // Item vendido por medida aceita fração na quantidade (2,5 m de mangueira).
  const unidadeDoItem = (item) =>
    UNIDADES[item.unidade] ?? unidadeDo(produtos.get(item.produtoId))

  const totalDoItem = (item) =>
    Math.max(0, Number(item.quantidade || 0) * Number(item.valorUnitario || 0) - Number(item.desconto || 0))

  const preenchidos = itens.filter((i) => i.produtoId || String(i.descricao || '').trim())

  // Salva e, se pedido, baixa o PDF. O PDF sai do que foi GRAVADO (e não do
  // formulário) para o papel entregue ao cliente e a tela contarem a mesma
  // história — inclusive os totais, que o banco recalcula ao salvar.
  async function salvar(e, comPdf) {
    e.preventDefault()
    setErro('')
    if (!preenchidos.length) {
      setErro('Adicione pelo menos um produto à proposta.')
      return
    }
    setSalvando(true)
    try {
      if (form.consultor) localStorage.setItem(CHAVE_CONSULTOR, form.consultor)
      const salva = await salvarVenda({ ...form, pagamentos: [] }, itens)
      if (comPdf) {
        const cliente = clientes.get(salva.clienteId)
        await gerarOrcamentoPdf(montarDadosOrcamento(salva, cliente, itensDaVenda(salva.id)))
      }
      notificar(comPdf ? 'Orçamento salvo e PDF baixado.' : 'Orçamento salvo.')
      onSalvo?.()
      onClose()
    } catch (ex) {
      setErro(ex?.message || String(ex))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal
      title={form.id ? 'Editar orçamento' : 'Novo orçamento'}
      open={open}
      onClose={onClose}
      size="wide"
    >
      <form onSubmit={(e) => salvar(e, true)} className="space-y-5 pb-20 sm:pb-0">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Cliente">
            <ClienteBusca
              clientes={clientes.list()}
              value={form.clienteId}
              onChange={(id) => setForm({ ...form, clienteId: id })}
              required
            />
          </Field>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Data">
              <input className={inputCls} type="date" required value={form.data} onChange={set('data')} />
            </Field>
            <Field label="Validade (dias)">
              <InputNumero className={inputCls} min="0" step="1" value={form.validadeDias} onChange={set('validadeDias')} />
            </Field>
            <Field label="Nº">
              <input className={inputCls} placeholder="opcional" value={form.numero} onChange={set('numero')} />
            </Field>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
          <p className="text-[13px] font-semibold text-slate-700">Produtos propostos</p>
          {itens.map((item, i) => (
            <div key={i} className="grid grid-cols-2 sm:grid-cols-12 gap-2 items-end">
              <div className="sm:col-span-5">
                <Field label={i === 0 ? 'Produto' : ''}>
                  <ProdutoBusca
                    produtos={listaProdutos}
                    value={item.produtoId}
                    onChange={(id) => alterarItem(i, 'produtoId', id)}
                    ocultarIds={itens.filter((_, idx) => idx !== i).map((it) => it.produtoId).filter(Boolean)}
                  />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label={i === 0 ? `Qtd. (${unidadeDoItem(item).sigla})` : ''}>
                  <InputNumero
                    className={inputCls}
                    min={unidadeDoItem(item).fracionavel ? '0.001' : '1'}
                    step={unidadeDoItem(item).fracionavel ? '0.001' : '1'}
                    value={item.quantidade}
                    onChange={(e) => alterarItem(i, 'quantidade', e.target.value)}
                  />
                </Field>
              </div>
              <div className="sm:col-span-3">
                <Field label={i === 0 ? 'Valor un.' : ''}>
                  <InputNumero
                    className={inputCls} min="0" step="0.01"
                    value={item.valorUnitario}
                    onChange={(e) => alterarItem(i, 'valorUnitario', e.target.value)}
                  />
                </Field>
              </div>
              <div className="sm:col-span-2 flex items-center gap-2">
                <span className="text-sm tnum text-slate-700 flex-1 text-right">
                  {formatBRL(totalDoItem(item))}
                </span>
                {itens.length > 1 && (
                  <button
                    type="button"
                    aria-label="Remover produto da proposta"
                    className="h-9 w-9 shrink-0 rounded-lg border border-slate-300 text-slate-500 hover:bg-slate-200"
                    onClick={() => setItens(itens.filter((_, idx) => idx !== i))}
                  >
                    <IconTrash size={15} className="mx-auto" />
                  </button>
                )}
              </div>
            </div>
          ))}
          {itens.length < MAX_ITENS && (
            <Button type="button" variant="secondary" onClick={() => setItens([...itens, { ...ITEM_VAZIO }])}>
              <IconPlus size={16} /> Adicionar produto
            </Button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Desconto na proposta (R$)">
            <InputNumero className={inputCls} min="0" step="0.01" value={form.desconto} onChange={set('desconto')} />
          </Field>
          <Field label="Consultor">
            <input className={inputCls} value={form.consultor} onChange={set('consultor')} />
          </Field>
          <Field label="Telefone do consultor">
            <input className={inputCls} value={form.consultorTelefone} onChange={set('consultorTelefone')} />
          </Field>
        </div>

        <Field label="Condições (sai no documento)">
          <textarea
            className={inputCls}
            rows={3}
            placeholder="ex.: Instalação inclusa. Pagamento em até 3x sem juros no cartão."
            value={form.observacoes}
            onChange={set('observacoes')}
          />
        </Field>

        <div className="flex justify-end gap-6 text-sm text-slate-600">
          <span>Subtotal: <span className="tnum">{formatBRL(subtotal)}</span></span>
          <span className="font-semibold text-slate-900">Total: <span className="tnum">{formatBRL(total)}</span></span>
        </div>

        {erro && (
          <p className="text-sm text-red-600 bg-slate-100 border border-slate-200 rounded-lg px-3 py-2">{erro}</p>
        )}

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="button" variant="secondary" disabled={salvando} onClick={(e) => salvar(e, false)}>
            Só salvar
          </Button>
          <Button type="submit" disabled={salvando}>
            <IconFileText size={16} /> {salvando ? 'Gerando…' : 'Salvar e baixar PDF'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
