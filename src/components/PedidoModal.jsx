import { useState } from 'react'
import {
  clientes, itensDaVenda, vendas, formatBRL, formatData,
} from '../data/repository.js'
import { gerarPedido } from '../pedido/gerar.js'
import { gerarPedidoPdf } from '../pedido/gerarPdf.js'
import { Modal, Button, Field, inputCls } from './ui.jsx'
import { IconFileText, IconPlus } from './icons.jsx'

// O sistema trabalha com 4 formas; o modelo do pedido detalha 6. "Cartão" do
// cadastro sai como "Crédito" no documento (o mesmo critério da Ordem de Serviço).
const FORMA_PEDIDO = { pix: 'pix', cartao: 'credito', boleto: 'boleto', dinheiro: 'dinheiro' }
const ENTREGA_PEDIDO = { retirada: 'retirada', endereco_cliente: 'endereco acima', outro: 'outro' }

const ITEM_VAZIO = { descricao: '', quantidade: '', valor_unitario: '', desconto: '', valor_total: '' }

function proximoNumeroPedido() {
  const atual = Number(localStorage.getItem('waterfall:pedido_seq') || 0)
  return String(atual + 1).padStart(4, '0')
}

const brl = (valor) => (Number(valor) > 0 ? formatBRL(valor) : '')

// Monta o formulário inicial puxando tudo o que o sistema já sabe: dados do
// cliente, da venda, dos itens e da condição de pagamento.
function montarInicial(venda) {
  const cliente = clientes.get(venda.clienteId) ?? {}
  const itens = itensDaVenda(venda.id)

  return {
    pedido_numero: venda.pedidoNumero || venda.numero || proximoNumeroPedido(),
    data: venda.data || '',
    validade_dias: venda.validadeDias ? String(venda.validadeDias) : '',
    status: venda.status === 'confirmada' ? 'confirmado' : 'proposta',
    tipo: venda.tipo === 'orcamento' ? 'orcamento' : 'venda',
    canal: venda.canal || '',

    cliente: cliente.nome || '',
    nome_contato: cliente.nome || '',
    cpf_cnpj: cliente.cpfCnpj || '',
    rg_inscricao: '',
    // Vem do cadastro (migração 017). Antes era sempre em branco e alguém
    // redigitava a data a cada pedido emitido.
    data_nascimento: cliente.nascimento ? formatData(cliente.nascimento) : '',
    endereco: cliente.endereco || '',
    numero_complemento: cliente.numeroComplemento || '',
    cep: cliente.cep || '',
    bairro: cliente.bairro || '',
    cidade: cliente.cidade || '',
    uf: cliente.uf || '',
    telefone_whatsapp: cliente.telefone || '',
    email: cliente.email || '',

    consultor: venda.consultor || localStorage.getItem('waterfall:pedido_consultor') || '',
    consultor_telefone: venda.consultorTelefone || '',
    distribuidor: venda.distribuidor || localStorage.getItem('waterfall:pedido_distribuidor') || '',
    distribuidor_telefone: venda.distribuidorTelefone || '',
    entrega: ENTREGA_PEDIDO[venda.entregaTipo] || '',
    entrega_endereco: venda.entregaEndereco || '',
    entrega_previsao: venda.entregaPrevisao ? formatData(venda.entregaPrevisao) : '',

    itens: itens.slice(0, 4).map((item) => ({
      descricao: String(item.descricao || '').slice(0, 70),
      quantidade: String(Number(item.quantidade || 1)),
      valor_unitario: brl(item.valorUnitario),
      desconto: brl(item.desconto),
      valor_total: brl(item.valorTotal),
    })),
    subtotal: brl(venda.subtotal),
    desconto_total: brl(venda.desconto),
    frete: brl(venda.frete),
    total_pedido: brl(venda.total),

    aplicarPagamento: Number(venda.total) > 0,
    pagamento: {
      forma: FORMA_PEDIDO[venda.formaPagamento] ?? '',
      condicao: venda.condicao === 'parcelado' ? 'parcelado' : 'a vista',
      entrada: brl(venda.entrada),
      parcelas: Number(venda.parcelas) > 1 ? String(venda.parcelas) : '',
      primeiro_vencimento: venda.primeiroVencimento ? formatData(venda.primeiroVencimento) : '',
      comprovante_id: '',
      responsavel: cliente.nome || '',
    },
    observacoes: venda.observacoes || '',
  }
}

// '' -> null: no formulário, campo deixado em branco significa "não se aplica"
const ouNulo = (v) => {
  const s = String(v ?? '').trim()
  return s ? s : null
}

export default function PedidoModal({ venda, onClose, onGerado }) {
  const [form, setForm] = useState(() => montarInicial(venda))
  const [erro, setErro] = useState('')
  const [gerando, setGerando] = useState('')

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const setPag = (k) => (e) => setForm({ ...form, pagamento: { ...form.pagamento, [k]: e.target.value } })
  const setItem = (i, k) => (e) => {
    const itens = form.itens.map((item, idx) => (idx === i ? { ...item, [k]: e.target.value } : item))
    setForm({ ...form, itens })
  }

  function adicionarItem() {
    if (form.itens.length < 4) setForm({ ...form, itens: [...form.itens, { ...ITEM_VAZIO }] })
  }
  function removerItem(i) {
    setForm({ ...form, itens: form.itens.filter((_, idx) => idx !== i) })
  }

  // Emite o pedido no formato escolhido. `gerador` é a função de saída
  // (gerarPedido = DOCX, gerarPedidoPdf = PDF); validação e rastreabilidade
  // são idênticas para os dois.
  async function emitir(formato, gerador) {
    setErro('')
    setGerando(formato)
    try {
      const itensPreenchidos = form.itens
        .filter((item) => Object.values(item).some((v) => String(v).trim()))
        .map((item) => Object.fromEntries(Object.entries(item).map(([k, v]) => [k, ouNulo(v)])))

      const campos = [
        'pedido_numero', 'data', 'validade_dias', 'status', 'tipo', 'canal',
        'cliente', 'nome_contato', 'cpf_cnpj', 'rg_inscricao', 'data_nascimento',
        'endereco', 'numero_complemento', 'cep', 'bairro', 'cidade', 'uf',
        'telefone_whatsapp', 'email',
        'consultor', 'consultor_telefone', 'distribuidor', 'distribuidor_telefone',
        'entrega', 'entrega_endereco', 'entrega_previsao',
        'subtotal', 'desconto_total', 'frete', 'total_pedido', 'observacoes',
      ]
      const dados = Object.fromEntries(campos.map((c) => [c, ouNulo(form[c])]))
      dados.itens = itensPreenchidos.length ? itensPreenchidos : null
      dados.pagamento = form.aplicarPagamento
        ? Object.fromEntries(Object.entries(form.pagamento).map(([k, v]) => [k, ouNulo(v)]))
        : null

      await gerador(dados)

      // Rastreabilidade: guarda o número no cadastro da venda e avança a sequência
      await vendas.update(venda.id, {
        pedidoNumero: form.pedido_numero,
        pedidoEmitidoEm: new Date().toISOString(),
      })
      const numero = Number(form.pedido_numero)
      if (Number.isFinite(numero) && numero > Number(localStorage.getItem('waterfall:pedido_seq') || 0)) {
        localStorage.setItem('waterfall:pedido_seq', String(numero))
      }
      if (form.consultor.trim()) localStorage.setItem('waterfall:pedido_consultor', form.consultor.trim())
      if (form.distribuidor.trim()) {
        localStorage.setItem('waterfall:pedido_distribuidor', form.distribuidor.trim())
      }

      // Completa o cadastro do cliente com o que foi informado aqui
      if (venda.clienteId && clientes.get(venda.clienteId)) {
        await clientes.update(venda.clienteId, {
          cpfCnpj: form.cpf_cnpj.trim(),
          numeroComplemento: form.numero_complemento.trim(),
          cep: form.cep.trim(),
          bairro: form.bairro.trim(),
          cidade: form.cidade.trim(),
          uf: form.uf.trim(),
        })
      }

      onGerado?.()
      onClose()
    } catch (ex) {
      setErro(String(ex.message || ex))
    } finally {
      setGerando('')
    }
  }

  const secao = 'text-[13px] font-semibold text-slate-700 border-b border-slate-200 pb-1.5 mb-3'

  return (
    <Modal title={`Pedido de Venda — ${form.cliente || 'sem cliente'}`} open onClose={onClose} size="wide">
      <form onSubmit={(e) => { e.preventDefault(); emitir('docx', gerarPedido) }} className="space-y-5">
        {/* Identificação */}
        <section>
          <p className={secao}>Identificação</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Field label="Pedido Nº">
              <input className={inputCls} maxLength={80} value={form.pedido_numero} onChange={set('pedido_numero')} />
            </Field>
            <Field label="Data">
              <input className={inputCls} type="date" value={form.data} onChange={set('data')} />
            </Field>
            <Field label="Validade (dias)">
              <input className={inputCls} maxLength={80} value={form.validade_dias} onChange={set('validade_dias')} />
            </Field>
            <Field label="Status">
              <select className={inputCls} value={form.status} onChange={set('status')}>
                <option value="proposta">Proposta</option>
                <option value="confirmado">Confirmado</option>
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            <Field label="Tipo">
              <select className={inputCls} value={form.tipo} onChange={set('tipo')}>
                <option value="venda">Venda</option>
                <option value="orcamento">Orçamento</option>
              </select>
            </Field>
            <Field label="Canal">
              <select className={inputCls} value={form.canal} onChange={set('canal')}>
                <option value="">Não se aplica</option>
                <option value="loja">Loja</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="telefone">Telefone</option>
                <option value="externo">Externo</option>
              </select>
            </Field>
          </div>
        </section>

        {/* Cliente */}
        <section>
          <p className={secao}>Cliente</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Cliente / Razão social">
              <input className={inputCls} maxLength={80} value={form.cliente} onChange={set('cliente')} />
            </Field>
            <Field label="Nome para contato">
              <input className={inputCls} maxLength={80} value={form.nome_contato} onChange={set('nome_contato')} />
            </Field>
            <Field label="CPF / CNPJ">
              <input className={inputCls} maxLength={80} value={form.cpf_cnpj} onChange={set('cpf_cnpj')} />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="RG / Inscrição estadual">
                <input className={inputCls} maxLength={80} value={form.rg_inscricao} onChange={set('rg_inscricao')} />
              </Field>
              <Field label="Data de nascimento">
                <input className={inputCls} maxLength={80} placeholder="dd/mm/aaaa" value={form.data_nascimento} onChange={set('data_nascimento')} />
              </Field>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 mt-3">
            <div className="sm:col-span-3">
              <Field label="Endereço">
                <input className={inputCls} maxLength={120} value={form.endereco} onChange={set('endereco')} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Nº / Complemento">
                <input className={inputCls} maxLength={80} value={form.numero_complemento} onChange={set('numero_complemento')} />
              </Field>
            </div>
            <Field label="CEP">
              <input className={inputCls} maxLength={80} value={form.cep} onChange={set('cep')} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Bairro">
                <input className={inputCls} maxLength={80} value={form.bairro} onChange={set('bairro')} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Cidade">
                <input className={inputCls} maxLength={80} value={form.cidade} onChange={set('cidade')} />
              </Field>
            </div>
            <Field label="UF">
              <input className={inputCls} maxLength={2} value={form.uf} onChange={set('uf')} />
            </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            <Field label="Telefone / WhatsApp">
              <input className={inputCls} maxLength={80} value={form.telefone_whatsapp} onChange={set('telefone_whatsapp')} />
            </Field>
            <Field label="E-mail">
              <input className={inputCls} maxLength={120} value={form.email} onChange={set('email')} />
            </Field>
          </div>
        </section>

        {/* Atendimento e entrega */}
        <section>
          <p className={secao}>Atendimento e entrega</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Field label="Consultor / Vendedor">
              <input className={inputCls} maxLength={80} value={form.consultor} onChange={set('consultor')} />
            </Field>
            <Field label="Telefone">
              <input className={inputCls} maxLength={80} value={form.consultor_telefone} onChange={set('consultor_telefone')} />
            </Field>
            <Field label="Distribuidor / Responsável">
              <input className={inputCls} maxLength={80} value={form.distribuidor} onChange={set('distribuidor')} />
            </Field>
            <Field label="Telefone">
              <input className={inputCls} maxLength={80} value={form.distribuidor_telefone} onChange={set('distribuidor_telefone')} />
            </Field>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
            <Field label="Entrega">
              <select className={inputCls} value={form.entrega} onChange={set('entrega')}>
                <option value="">Não se aplica</option>
                <option value="retirada">Retirada</option>
                <option value="endereco acima">Entrega no endereço acima</option>
                <option value="outro">Outro endereço</option>
              </select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Outro endereço">
                <input className={inputCls} maxLength={120} value={form.entrega_endereco} onChange={set('entrega_endereco')} />
              </Field>
            </div>
            <Field label="Previsão">
              <input className={inputCls} maxLength={80} placeholder="dd/mm/aaaa" value={form.entrega_previsao} onChange={set('entrega_previsao')} />
            </Field>
          </div>
        </section>

        {/* Itens */}
        <section>
          <p className={secao}>Produtos (até 4 itens)</p>
          {form.itens.map((item, i) => (
            <div key={i} className="grid grid-cols-2 sm:grid-cols-6 gap-2 mb-2 items-end">
              <div className="sm:col-span-2">
                <Field label={`Item ${i + 1} — descrição`}>
                  <input className={inputCls} maxLength={70} value={item.descricao} onChange={setItem(i, 'descricao')} />
                </Field>
              </div>
              <Field label="Qtd.">
                <input className={inputCls} value={item.quantidade} onChange={setItem(i, 'quantidade')} />
              </Field>
              <Field label="Valor un.">
                <input className={inputCls} value={item.valor_unitario} onChange={setItem(i, 'valor_unitario')} />
              </Field>
              <Field label="Desconto">
                <input className={inputCls} value={item.desconto} onChange={setItem(i, 'desconto')} />
              </Field>
              <div className="flex gap-1 items-center">
                <div className="flex-1">
                  <Field label="Total">
                    <input className={inputCls} value={item.valor_total} onChange={setItem(i, 'valor_total')} />
                  </Field>
                </div>
                <button
                  type="button"
                  onClick={() => removerItem(i)}
                  className="text-red-500 hover:text-red-700 text-lg leading-none pb-2 cursor-pointer"
                  title="Remover item"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between mt-2 gap-3 flex-wrap">
            {form.itens.length < 4 ? (
              <Button type="button" variant="ghost" onClick={adicionarItem}>
                <IconPlus size={14} /> Adicionar item
              </Button>
            ) : <span />}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Field label="Subtotal">
                <input className={inputCls} maxLength={80} value={form.subtotal} onChange={set('subtotal')} />
              </Field>
              <Field label="Desconto total">
                <input className={inputCls} maxLength={80} value={form.desconto_total} onChange={set('desconto_total')} />
              </Field>
              <Field label="Frete">
                <input className={inputCls} maxLength={80} value={form.frete} onChange={set('frete')} />
              </Field>
              <Field label="Total do pedido">
                <input className={inputCls} maxLength={80} value={form.total_pedido} onChange={set('total_pedido')} />
              </Field>
            </div>
          </div>
        </section>

        {/* Pagamento */}
        <section>
          <label className="flex items-center gap-2 cursor-pointer mb-3">
            <input
              type="checkbox"
              checked={form.aplicarPagamento}
              onChange={(e) => setForm({ ...form, aplicarPagamento: e.target.checked })}
            />
            <span className="text-[13px] font-semibold text-slate-700">Registrar pagamento no pedido</span>
          </label>
          {form.aplicarPagamento && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Field label="Forma">
                <select className={inputCls} value={form.pagamento.forma} onChange={setPag('forma')}>
                  <option value="">Não se aplica</option>
                  <option value="pix">PIX</option>
                  <option value="credito">Crédito</option>
                  <option value="debito">Débito</option>
                  <option value="dinheiro">Dinheiro</option>
                  <option value="boleto">Boleto</option>
                  <option value="transferencia">Transferência</option>
                </select>
              </Field>
              <Field label="Condição">
                <select className={inputCls} value={form.pagamento.condicao} onChange={setPag('condicao')}>
                  <option value="">Não se aplica</option>
                  <option value="a vista">À vista</option>
                  <option value="parcelado">Parcelado</option>
                </select>
              </Field>
              <Field label="Entrada">
                <input className={inputCls} maxLength={80} value={form.pagamento.entrada} onChange={setPag('entrada')} />
              </Field>
              <Field label="Parcelas">
                <input className={inputCls} maxLength={80} value={form.pagamento.parcelas} onChange={setPag('parcelas')} />
              </Field>
              <Field label="1º vencimento">
                <input className={inputCls} maxLength={80} value={form.pagamento.primeiro_vencimento} onChange={setPag('primeiro_vencimento')} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Comprovante / NSU / ID da transação">
                  <input className={inputCls} maxLength={80} value={form.pagamento.comprovante_id} onChange={setPag('comprovante_id')} />
                </Field>
              </div>
              <Field label="Responsável">
                <input className={inputCls} maxLength={80} value={form.pagamento.responsavel} onChange={setPag('responsavel')} />
              </Field>
            </div>
          )}
        </section>

        {/* Observações */}
        <section>
          <p className={secao}>Observações</p>
          <Field label="Observações / condições especiais">
            <textarea className={inputCls} rows="2" maxLength={300} value={form.observacoes} onChange={set('observacoes')} />
          </Field>
        </section>

        {erro && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>
        )}

        <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-100">
          <p className="text-xs text-slate-400">
            Revise os campos: os deixados em branco sairão vazios no documento.
          </p>
          <div className="flex gap-2 shrink-0">
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!!gerando}
              onClick={() => emitir('docx', gerarPedido)}
            >
              <IconFileText size={16} /> {gerando === 'docx' ? 'Gerando…' : 'Baixar DOCX'}
            </Button>
            <Button type="button" disabled={!!gerando} onClick={() => emitir('pdf', gerarPedidoPdf)}>
              <IconFileText size={16} /> {gerando === 'pdf' ? 'Gerando…' : 'Baixar PDF'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
