// Preenchimento do Pedido de Venda Waterfall.
//
// Mesma técnica da Ordem de Serviço (ver ../os/fill.js): edita direto o
// word/document.xml do modelo oficial (reference.docx), preservando o visual.
// O plumbing de XML vem de ../documentos/docx.js.
//
// O modelo do Pedido tem 8 tabelas de nível superior, sem aninhamento e sem
// vMerge (verificado):
//   0  cabeçalho (logo e endereço)   — não preenchido
//   1  identificação (nº, data, validade, status, tipo, canal)
//   2  1. CLIENTE
//   3  2. ATENDIMENTO E ENTREGA
//   4  3. PRODUTOS (4 linhas de item × 5 colunas) + subtotal e total
//   5  4. PAGAMENTO
//   6  5. OBSERVAÇÕES E ACEITE      — só as observações; o aceite é fixo
//   7  assinaturas                  — não preenchido
//
// Diferenças em relação à OS: os itens não têm coluna de garantia (5 colunas,
// não 6) e há subtotal/desconto/frete além do total.

import {
  checked, criarEditor, labeled, linha, multiline, plain,
  formatDate, nomeArquivoDocumento, checarCamposObrigatorios,
} from '../documentos/docx.js'

export { formatDate }

export const TOP_LEVEL_FIELDS = [
  'pedido_numero', 'data', 'validade_dias', 'status', 'tipo', 'canal',
  'cliente', 'nome_contato', 'cpf_cnpj', 'rg_inscricao', 'data_nascimento',
  'endereco', 'numero_complemento', 'cep', 'bairro', 'cidade', 'uf',
  'telefone_whatsapp', 'email',
  'consultor', 'consultor_telefone', 'distribuidor', 'distribuidor_telefone',
  'entrega', 'entrega_endereco', 'entrega_previsao',
  'itens', 'subtotal', 'desconto_total', 'frete', 'total_pedido',
  'pagamento', 'observacoes',
]
export const ITEM_FIELDS = [
  'descricao', 'quantidade', 'valor_unitario', 'desconto', 'valor_total',
]
export const PAYMENT_FIELDS = [
  'forma', 'condicao', 'entrada', 'parcelas', 'primeiro_vencimento',
  'comprovante_id', 'responsavel',
]

// Valores aceitos nos grupos de caixas do modelo (o que não bater sai desmarcado)
export const OPCOES = {
  status: ['proposta', 'confirmado'],
  tipo: ['venda', 'orcamento'],
  canal: ['loja', 'whatsapp', 'telefone', 'externo'],
  entrega: ['retirada', 'endereco acima', 'outro'],
  forma: ['pix', 'credito', 'debito', 'dinheiro', 'boleto', 'transferencia'],
  condicao: ['a vista', 'parcelado'],
}

export function nomeArquivo(data, ext = 'docx') {
  return nomeArquivoDocumento('pedido', data.data, data.cliente, ext)
}

// ---------------------------------------------------------------- validação

export function validate(data) {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('os dados precisam ser um objeto JSON')
  }

  const errors = checarCamposObrigatorios(data, TOP_LEVEL_FIELDS)

  const itemsValue = data.itens
  if (itemsValue !== null && itemsValue !== undefined) {
    let items = []
    if (!Array.isArray(itemsValue) || itemsValue.length === 0) {
      errors.push('itens deve ser uma lista com 1 a 4 itens ou null para não se aplica')
    } else {
      items = itemsValue
    }
    if (items.length > 4) errors.push('o modelo aceita no máximo 4 itens')
    items.forEach((item, i) => {
      const n = i + 1
      if (typeof item !== 'object' || item === null) {
        errors.push(`item ${n} deve ser um objeto`)
        return
      }
      errors.push(...checarCamposObrigatorios(item, ITEM_FIELDS, `item ${n}: `))
      if (String(item.descricao ?? '').length > 70) errors.push(`descrição do item ${n} excede 70 caracteres`)
    })
  }

  const payment = data.pagamento
  if (payment !== null && payment !== undefined) {
    if (typeof payment !== 'object' || Array.isArray(payment)) {
      errors.push('pagamento deve ser um objeto completo ou null para não se aplica')
    } else {
      errors.push(...checarCamposObrigatorios(payment, PAYMENT_FIELDS, 'pagamento: '))
    }
  }

  if (String(data.observacoes ?? '').length > 300) errors.push('observacoes excede 300 caracteres')
  for (const [field, value] of Object.entries(data)) {
    if (['itens', 'pagamento', 'observacoes'].includes(field)) continue
    const limit = ['endereco', 'email', 'entrega_endereco'].includes(field) ? 120 : 80
    if (String(value ?? '').length > limit) errors.push(`${field} excede ${limit} caracteres`)
  }

  if (errors.length) throw new Error(errors.join('; '))
}

// -------------------------------------------------------------- preenchimento

// Monta um grupo de caixas: "[X] Venda  [ ] Orçamento"
function grupo(escolhido, opcoes) {
  return opcoes.map(([valor, rotulo]) => `${checked(escolhido, valor)} ${rotulo}`).join('  ')
}

export function fillDocumentXml(xml, data) {
  validate(data)

  const displayDate = data.data == null ? '' : formatDate(data.data).display
  const editor = criarEditor(xml, 8)
  const setCell = (...args) => editor.setCell(...args)

  // ---- Tabela 1 — identificação
  setCell(1, 0, 0, labeled('PEDIDO Nº:', data.pedido_numero, 7.9))
  setCell(1, 0, 1, labeled('DATA:', displayDate, 7.9))
  setCell(1, 0, 2, labeled('VALIDADE:', data.validade_dias ? `${data.validade_dias} dias` : '', 7.9))
  setCell(1, 0, 3, labeled('STATUS:', grupo(data.status, [
    ['proposta', 'Proposta'], ['confirmado', 'Confirmado'],
  ]), 7.5))
  setCell(1, 1, 0, linha([
    ['TIPO:', grupo(data.tipo, [['venda', 'Venda'], ['orcamento', 'Orçamento']])],
    ['CANAL:', grupo(data.canal, [
      ['loja', 'Loja'], ['whatsapp', 'WhatsApp'], ['telefone', 'Telefone'], ['externo', 'Externo'],
    ])],
  ], 7.4))

  // ---- Tabela 2 — cliente
  const camposCliente = [
    [1, 0, 'Cliente / Razão social:', data.cliente],
    [1, 2, 'Nome para contato:', data.nome_contato],
    [2, 0, 'CPF/CNPJ:', data.cpf_cnpj],
    [2, 2, 'RG / Inscrição estadual:', data.rg_inscricao],
    [2, 3, 'Data de nascimento:', data.data_nascimento],
    [3, 0, 'Endereço:', data.endereco],
    [3, 2, 'Nº / Complemento:', data.numero_complemento],
    [3, 3, 'CEP:', data.cep],
    [4, 0, 'Bairro:', data.bairro],
    [4, 1, 'Cidade:', data.cidade],
    [4, 3, 'UF:', data.uf],
    [5, 0, 'Telefone / WhatsApp:', data.telefone_whatsapp],
    [5, 2, 'E-mail:', data.email],
  ]
  for (const [row, col, label, value] of camposCliente) {
    setCell(2, row, col, labeled(label, value, 7.5))
  }

  // ---- Tabela 3 — atendimento e entrega
  setCell(3, 1, 0, labeled('Consultor / Vendedor:', data.consultor, 7.5))
  setCell(3, 1, 2, labeled('Telefone:', data.consultor_telefone, 7.5))
  setCell(3, 2, 0, labeled('Distribuidor / Responsável:', data.distribuidor, 7.5))
  setCell(3, 2, 2, labeled('Telefone:', data.distribuidor_telefone, 7.5))
  setCell(3, 3, 0, linha([
    ['Entrega:', grupo(data.entrega, [
      ['retirada', 'Retirada'],
      ['endereco acima', 'Entrega no endereço acima'],
      ['outro', 'Outro endereço:'],
    ])],
    ['', data.entrega_endereco],
    ['Previsão:', data.entrega_previsao],
  ], 7.2))

  // ---- Tabela 4 — produtos (linhas 2 a 5) e totais
  const itens = data.itens || []
  for (let i = 0; i < 4; i++) {
    const item = itens[i] || {}
    ITEM_FIELDS.forEach((chave, coluna) => {
      setCell(4, i + 2, coluna, plain(item[chave] ?? '', 7.2, coluna === 0 ? null : 'center'))
    })
  }
  setCell(4, 6, 4, plain(data.subtotal || 'R$', 7.6))
  setCell(4, 7, 0, linha([
    ['DESCONTO TOTAL:', data.desconto_total],
    ['FRETE:', data.frete],
    ['TOTAL DO PEDIDO:', null],
  ], 7.4))
  setCell(4, 7, 4, plain(data.total_pedido || 'R$', 7.8))

  // ---- Tabela 5 — pagamento
  const pg = data.pagamento || {}
  setCell(5, 1, 0, labeled('Forma:', grupo(pg.forma, [
    ['pix', 'PIX'], ['credito', 'Crédito'], ['debito', 'Débito'],
    ['dinheiro', 'Dinheiro'], ['boleto', 'Boleto'], ['transferencia', 'Transferência'],
  ]), 7.2))
  setCell(5, 2, 0, labeled('Condição:', grupo(pg.condicao, [
    ['a vista', 'À vista'], ['parcelado', 'Parcelado'],
  ]), 7.2))
  setCell(5, 2, 1, labeled('Entrada:', pg.entrada, 7.2))
  setCell(5, 2, 2, labeled('Parcelas:', pg.parcelas, 7.2))
  setCell(5, 2, 3, labeled('1º vencimento:', pg.primeiro_vencimento, 7.2))
  setCell(5, 3, 0, labeled('Comprovante / NSU / ID da transação:', pg.comprovante_id, 7.1))
  setCell(5, 3, 3, labeled('Responsável pelo pagamento:', pg.responsavel, 7.0))

  // ---- Tabela 6 — observações (a coluna do aceite é texto fixo do modelo)
  setCell(6, 1, 0, multiline([['Observações / condições especiais:', data.observacoes]], 7.1))

  return editor.aplicar()
}
