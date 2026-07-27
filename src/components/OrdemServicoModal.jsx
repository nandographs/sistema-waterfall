import { useState } from 'react'
import {
  clientes, produtos, agendamentos,
  formatBRL, formatData,
} from '../data/repository.js'
import { gerarOrdemServico } from '../os/gerar.js'
import { gerarOrdemServicoPdf } from '../os/gerarPdf.js'
import { Modal, Button, Field, inputCls } from './ui.jsx'
import { IconFileText, IconPlus } from './icons.jsx'

// Mapeia os tipos do sistema para os valores reconhecidos pelo modelo da OS
const TIPO_OS = {
  instalacao: 'instalacao',
  troca_refil: 'troca de filtro',
  manutencao: 'manutencao',
  visita: 'visita tecnica',
}
const FORMA_OS = { pix: 'pix', cartao: 'credito', boleto: 'boleto', dinheiro: 'dinheiro' }

const ITEM_VAZIO = {
  descricao: '', quantidade: '', valor_unitario: '', desconto: '', valor_total: '', garantia_validade: '',
}

function proximoNumeroOS() {
  const atual = Number(localStorage.getItem('waterfall:os_seq') || 0)
  return String(atual + 1).padStart(4, '0')
}

function brl(valor) {
  return valor > 0 ? formatBRL(valor) : ''
}

// Monta o formulário inicial puxando tudo o que o sistema já sabe:
// dados do cliente, do agendamento, do produto e do financeiro vinculado.
function montarInicial(agendamento) {
  const cliente = clientes.get(agendamento.clienteId) ?? {}
  const produto = produtos.get(agendamento.produtoId)
  // O próprio agendamento é a fonte do financeiro do serviço; os lançamentos
  // no caixa são derivados dele.
  const valor = Number(agendamento.valor ?? 0)
  const parcelas = Number(agendamento.parcelas ?? 1)

  return {
    os_numero: agendamento.osNumero || proximoNumeroOS(),
    data: agendamento.data || '',
    hora: '',
    status: agendamento.status === 'concluido' ? 'concluida' : 'aberta',
    tipo_atendimento: TIPO_OS[agendamento.tipo] ?? '',
    cliente: cliente.nome || '',
    autorizado_por: cliente.nome || '',
    cpf_cnpj: cliente.cpfCnpj || '',
    telefone_whatsapp: cliente.telefone || '',
    email: cliente.email || '',
    endereco: cliente.endereco || '',
    numero_complemento: cliente.numeroComplemento || '',
    cep: cliente.cep || '',
    bairro: cliente.bairro || '',
    cidade: cliente.cidade || '',
    uf: cliente.uf || '',
    atendente: localStorage.getItem('waterfall:os_atendente') || '',
    tecnico: localStorage.getItem('waterfall:os_tecnico') || '',
    agendado_para: agendamento.data ? formatData(agendamento.data) : '',
    previsao_conclusao: '',
    equipamento_modelo: produto?.nome || '',
    numero_serie: '',
    defeito_relatado: '',
    diagnostico_tecnico: '',
    servico_executado: agendamento.observacoes || '',
    itens: produto
      ? [{
          ...ITEM_VAZIO,
          descricao: produto.nome.slice(0, 70),
          quantidade: '1',
          valor_unitario: brl(valor || Number(produto.valor)),
          valor_total: brl(valor || Number(produto.valor)),
        }]
      : [],
    total_ordem: brl(valor),
    aplicarPagamento: valor > 0,
    pagamento: {
      forma: FORMA_OS[agendamento.formaPagamento] ?? '',
      condicao: parcelas > 1 ? 'parcelado' : 'a vista',
      parcelas: parcelas > 1 ? String(parcelas) : '',
      primeiro_vencimento: '',
      valor_total: brl(valor),
      comprovante_id: '',
      responsavel: cliente.nome || '',
    },
  }
}

// '' -> null: no formulário, campo deixado em branco significa "não se aplica"
const ouNulo = (v) => {
  const s = String(v ?? '').trim()
  return s ? s : null
}

export default function OrdemServicoModal({ agendamento, onClose, onGerada }) {
  const [form, setForm] = useState(() => montarInicial(agendamento))
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

  // Emite a OS no formato escolhido. `gerador` é a função de saída
  // (gerarOrdemServico = DOCX, gerarOrdemServicoPdf = PDF); toda a validação,
  // rastreabilidade e atualização de cadastro é idêntica para os dois.
  async function emitir(formato, gerador) {
    setErro('')
    setGerando(formato)
    try {
      const itensPreenchidos = form.itens
        .filter((item) => Object.values(item).some((v) => String(v).trim()))
        .map((item) => Object.fromEntries(Object.entries(item).map(([k, v]) => [k, ouNulo(v)])))

      const dados = {
        os_numero: ouNulo(form.os_numero),
        data: ouNulo(form.data),
        hora: ouNulo(form.hora),
        status: ouNulo(form.status),
        tipo_atendimento: ouNulo(form.tipo_atendimento),
        cliente: ouNulo(form.cliente),
        autorizado_por: ouNulo(form.autorizado_por),
        cpf_cnpj: ouNulo(form.cpf_cnpj),
        telefone_whatsapp: ouNulo(form.telefone_whatsapp),
        email: ouNulo(form.email),
        endereco: ouNulo(form.endereco),
        numero_complemento: ouNulo(form.numero_complemento),
        cep: ouNulo(form.cep),
        bairro: ouNulo(form.bairro),
        cidade: ouNulo(form.cidade),
        uf: ouNulo(form.uf),
        atendente: ouNulo(form.atendente),
        tecnico: ouNulo(form.tecnico),
        agendado_para: ouNulo(form.agendado_para),
        previsao_conclusao: ouNulo(form.previsao_conclusao),
        equipamento_modelo: ouNulo(form.equipamento_modelo),
        numero_serie: ouNulo(form.numero_serie),
        defeito_relatado: ouNulo(form.defeito_relatado),
        diagnostico_tecnico: ouNulo(form.diagnostico_tecnico),
        servico_executado: ouNulo(form.servico_executado),
        itens: itensPreenchidos.length ? itensPreenchidos : null,
        total_ordem: ouNulo(form.total_ordem),
        pagamento: form.aplicarPagamento
          ? Object.fromEntries(Object.entries(form.pagamento).map(([k, v]) => [k, ouNulo(v)]))
          : null,
      }

      await gerador(dados)

      // Rastreabilidade: guarda o número da OS no agendamento e avança a sequência
      await agendamentos.update(agendamento.id, {
        osNumero: form.os_numero,
        osEmitidaEm: new Date().toISOString(),
      })
      const numero = Number(form.os_numero)
      if (Number.isFinite(numero) && numero > Number(localStorage.getItem('waterfall:os_seq') || 0)) {
        localStorage.setItem('waterfall:os_seq', String(numero))
      }
      if (form.atendente.trim()) localStorage.setItem('waterfall:os_atendente', form.atendente.trim())
      if (form.tecnico.trim()) localStorage.setItem('waterfall:os_tecnico', form.tecnico.trim())

      // Completa o cadastro do cliente com os dados informados aqui,
      // para a próxima OS já vir preenchida
      if (agendamento.clienteId && clientes.get(agendamento.clienteId)) {
        await clientes.update(agendamento.clienteId, {
          cpfCnpj: form.cpf_cnpj.trim(),
          numeroComplemento: form.numero_complemento.trim(),
          cep: form.cep.trim(),
          bairro: form.bairro.trim(),
          cidade: form.cidade.trim(),
          uf: form.uf.trim(),
        })
      }

      onGerada?.()
      onClose()
    } catch (ex) {
      setErro(String(ex.message || ex))
    } finally {
      setGerando('')
    }
  }

  const secao = 'text-[13px] font-semibold text-slate-700 border-b border-slate-200 pb-1.5 mb-3'

  return (
    <Modal title={`Ordem de Serviço — ${form.cliente || 'sem cliente'}`} open onClose={onClose} size="wide">
      <form onSubmit={(e) => { e.preventDefault(); emitir('docx', gerarOrdemServico) }} className="space-y-5">
        {/* Identificação */}
        <section>
          <p className={secao}>Identificação</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Field label="OS Nº">
              <input className={inputCls} maxLength={80} value={form.os_numero} onChange={set('os_numero')} />
            </Field>
            <Field label="Data">
              <input className={inputCls} type="date" value={form.data} onChange={set('data')} />
            </Field>
            <Field label="Hora">
              <input className={inputCls} type="time" value={form.hora} onChange={set('hora')} />
            </Field>
            <Field label="Status">
              <select className={inputCls} value={form.status} onChange={set('status')}>
                <option value="aberta">Aberta</option>
                <option value="concluida">Concluída</option>
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <Field label="Tipo de atendimento">
              <select className={inputCls} value={form.tipo_atendimento} onChange={set('tipo_atendimento')}>
                <option value="">Não se aplica</option>
                <option value="instalacao">Instalação</option>
                <option value="manutencao">Manutenção</option>
                <option value="troca de filtro">Troca de filtro</option>
                <option value="visita tecnica">Visita técnica</option>
              </select>
            </Field>
            <Field label="Previsão de conclusão">
              <input className={inputCls} maxLength={80} placeholder="ex.: 25/07/2026 16:00" value={form.previsao_conclusao} onChange={set('previsao_conclusao')} />
            </Field>
          </div>
        </section>

        {/* Cliente */}
        <section>
          <p className={secao}>Cliente e atendimento</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Cliente / Empresa">
              <input className={inputCls} maxLength={80} value={form.cliente} onChange={set('cliente')} />
            </Field>
            <Field label="Autorizado por">
              <input className={inputCls} maxLength={80} value={form.autorizado_por} onChange={set('autorizado_por')} />
            </Field>
            <Field label="CPF / CNPJ">
              <input className={inputCls} maxLength={80} value={form.cpf_cnpj} onChange={set('cpf_cnpj')} />
            </Field>
            <Field label="Telefone / WhatsApp">
              <input className={inputCls} maxLength={80} value={form.telefone_whatsapp} onChange={set('telefone_whatsapp')} />
            </Field>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 mt-3">
            <div className="sm:col-span-3">
              <Field label="E-mail">
                <input className={inputCls} maxLength={120} value={form.email} onChange={set('email')} />
              </Field>
            </div>
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
            <Field label="Bairro">
              <input className={inputCls} maxLength={80} value={form.bairro} onChange={set('bairro')} />
            </Field>
            <Field label="Cidade">
              <input className={inputCls} maxLength={80} value={form.cidade} onChange={set('cidade')} />
            </Field>
            <Field label="UF">
              <input className={inputCls} maxLength={2} value={form.uf} onChange={set('uf')} />
            </Field>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
            <Field label="Atendente">
              <input className={inputCls} maxLength={80} value={form.atendente} onChange={set('atendente')} />
            </Field>
            <Field label="Técnico responsável">
              <input className={inputCls} maxLength={80} value={form.tecnico} onChange={set('tecnico')} />
            </Field>
            <Field label="Agendado para">
              <input className={inputCls} maxLength={80} value={form.agendado_para} onChange={set('agendado_para')} />
            </Field>
          </div>
        </section>

        {/* Equipamento e serviço */}
        <section>
          <p className={secao}>Equipamento e serviço</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Equipamento / modelo">
              <input className={inputCls} maxLength={80} value={form.equipamento_modelo} onChange={set('equipamento_modelo')} />
            </Field>
            <Field label="Nº de série">
              <input className={inputCls} maxLength={80} value={form.numero_serie} onChange={set('numero_serie')} />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 mt-3">
            <Field label="Defeito relatado pelo cliente">
              <textarea className={inputCls} rows="2" maxLength={180} value={form.defeito_relatado} onChange={set('defeito_relatado')} />
            </Field>
            <Field label="Diagnóstico técnico">
              <textarea className={inputCls} rows="2" maxLength={180} value={form.diagnostico_tecnico} onChange={set('diagnostico_tecnico')} />
            </Field>
            <Field label="Serviço executado / observações">
              <textarea className={inputCls} rows="2" maxLength={180} value={form.servico_executado} onChange={set('servico_executado')} />
            </Field>
          </div>
        </section>

        {/* Itens */}
        <section>
          <p className={secao}>Produtos, peças e serviços (até 4 itens)</p>
          {form.itens.map((item, i) => (
            <div key={i} className="grid grid-cols-2 sm:grid-cols-7 gap-2 mb-2 items-end">
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
              <Field label="Total">
                <input className={inputCls} value={item.valor_total} onChange={setItem(i, 'valor_total')} />
              </Field>
              <div className="flex gap-1 items-center">
                <div className="flex-1">
                  <Field label="Garantia">
                    <input className={inputCls} value={item.garantia_validade} onChange={setItem(i, 'garantia_validade')} />
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
          <div className="flex items-center justify-between mt-2">
            {form.itens.length < 4 ? (
              <Button type="button" variant="ghost" onClick={adicionarItem}>
                <IconPlus size={14} /> Adicionar item
              </Button>
            ) : <span />}
            <div className="w-44">
              <Field label="Total da ordem">
                <input className={inputCls} maxLength={80} value={form.total_ordem} onChange={set('total_ordem')} />
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
            <span className="text-[13px] font-semibold text-slate-700">Registrar pagamento na OS</span>
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
              <Field label="Parcelas">
                <input className={inputCls} maxLength={80} value={form.pagamento.parcelas} onChange={setPag('parcelas')} />
              </Field>
              <Field label="1º vencimento">
                <input className={inputCls} maxLength={80} value={form.pagamento.primeiro_vencimento} onChange={setPag('primeiro_vencimento')} />
              </Field>
              <Field label="Valor total">
                <input className={inputCls} maxLength={80} value={form.pagamento.valor_total} onChange={setPag('valor_total')} />
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
              onClick={() => emitir('docx', gerarOrdemServico)}
            >
              <IconFileText size={16} /> {gerando === 'docx' ? 'Gerando…' : 'Baixar DOCX'}
            </Button>
            <Button type="button" disabled={!!gerando} onClick={() => emitir('pdf', gerarOrdemServicoPdf)}>
              <IconFileText size={16} /> {gerando === 'pdf' ? 'Gerando…' : 'Baixar PDF'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
