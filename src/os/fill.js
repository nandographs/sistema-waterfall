// Preenchimento da Ordem de Serviço Waterfall.
//
// Porta fiel de scripts/fill_order.py da skill
// "artifact-template-ordem-de-servico-waterfall": mesma validação, mesmo
// mapeamento de células e mesmos limites. Opera direto no word/document.xml
// do modelo (reference.docx), preservando todo o visual — nada além das
// células mapeadas é alterado.
//
// O modelo tem 7 tabelas de nível superior e nenhuma tabela aninhada nem
// vMerge (verificado). A varredura do XML e a construção dos parágrafos ficam
// em ../documentos/docx.js, compartilhadas com o Pedido de Venda.

import {
  checked, criarEditor, labeled, multiline, plain,
  formatDate, nomeArquivoDocumento, checarCamposObrigatorios,
} from '../documentos/docx.js'

// Reexportado: gerarPdf.js e os testes importam formatDate daqui.
export { formatDate }

export const TOP_LEVEL_FIELDS = [
  'os_numero', 'data', 'hora', 'status', 'tipo_atendimento', 'cliente',
  'autorizado_por', 'cpf_cnpj', 'telefone_whatsapp', 'email', 'endereco',
  'numero_complemento', 'cep', 'bairro', 'cidade', 'uf', 'atendente',
  'tecnico', 'agendado_para', 'previsao_conclusao', 'equipamento_modelo',
  'numero_serie', 'defeito_relatado', 'diagnostico_tecnico',
  'servico_executado', 'itens', 'total_ordem', 'pagamento',
]
export const ITEM_FIELDS = [
  'descricao', 'quantidade', 'valor_unitario', 'desconto', 'valor_total',
  'garantia_validade',
]
export const PAYMENT_FIELDS = [
  'forma', 'condicao', 'parcelas', 'primeiro_vencimento', 'valor_total',
  'comprovante_id', 'responsavel',
]

export function nomeArquivo(data, ext = 'docx') {
  return nomeArquivoDocumento('ordem', data.data, data.cliente, ext)
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

  for (const f of ['defeito_relatado', 'diagnostico_tecnico', 'servico_executado']) {
    if (String(data[f] ?? '').length > 180) errors.push(`${f} excede 180 caracteres`)
  }
  for (const [field, value] of Object.entries(data)) {
    if (['itens', 'pagamento', 'defeito_relatado', 'diagnostico_tecnico', 'servico_executado'].includes(field)) continue
    const limit = ['endereco', 'email'].includes(field) ? 120 : 80
    if (String(value ?? '').length > limit) errors.push(`${field} excede ${limit} caracteres`)
  }

  if (errors.length) throw new Error(errors.join('; '))
}

// -------------------------------------------------------------- preenchimento

export function fillDocumentXml(xml, data) {
  validate(data)

  const displayDate = data.data == null ? '' : formatDate(data.data).display
  const editor = criarEditor(xml, 7)
  const setCell = (...args) => editor.setCell(...args)

  // Tabela 1 — identificação
  setCell(1, 0, 0, labeled('OS Nº:', data.os_numero, 7.9))
  setCell(1, 0, 1, labeled('DATA:', displayDate, 7.9))
  setCell(1, 0, 2, labeled('HORA:', data.hora, 7.9))
  setCell(1, 0, 3, labeled(
    'STATUS:',
    `${checked(data.status, 'aberta')} Aberta  ${checked(data.status, 'concluida')} Concluída`,
    7.7,
  ))
  setCell(1, 1, 0, labeled(
    'TIPO DE ATENDIMENTO:',
    [
      `${checked(data.tipo_atendimento, 'instalacao')} Instalação`,
      `${checked(data.tipo_atendimento, 'manutencao')} Manutenção`,
      `${checked(data.tipo_atendimento, 'troca de filtro')} Troca de filtro`,
      `${checked(data.tipo_atendimento, 'visita tecnica')} Visita técnica`,
    ].join('  '),
    7.4,
  ))

  // Tabela 2 — cliente e atendimento
  const customerFields = [
    [1, 0, 'Cliente / Empresa:', data.cliente],
    [1, 2, 'Autorizado por:', data.autorizado_por],
    [2, 0, 'CPF/CNPJ:', data.cpf_cnpj],
    [2, 2, 'Telefone / WhatsApp:', data.telefone_whatsapp],
    [2, 3, 'E-mail:', data.email],
    [3, 0, 'Endereço:', data.endereco],
    [3, 2, 'Nº / Complemento:', data.numero_complemento],
    [3, 3, 'CEP:', data.cep],
    [4, 0, 'Bairro:', data.bairro],
    [4, 1, 'Cidade:', data.cidade],
    [4, 3, 'UF:', data.uf],
    [5, 0, 'Atendente:', data.atendente],
    [5, 2, 'Técnico responsável:', data.tecnico],
    [6, 0, 'Agendado para:', data.agendado_para],
    [6, 2, 'Previsão de conclusão:', data.previsao_conclusao],
  ]
  for (const [row, col, label, value] of customerFields) {
    setCell(2, row, col, labeled(label, value, 7.5))
  }

  // Tabela 3 — equipamento e serviço
  setCell(3, 1, 0, multiline([
    ['Equipamento / modelo:', data.equipamento_modelo],
    ['Nº de série:', data.numero_serie],
  ]))
  setCell(3, 1, 1, multiline([['Defeito relatado pelo cliente:', data.defeito_relatado]], 7.1))
  setCell(3, 2, 0, multiline([['Diagnóstico técnico:', data.diagnostico_tecnico]], 7.1))
  setCell(3, 2, 1, multiline([['Serviço executado / observações:', data.servico_executado]], 7.1))

  // Tabela 4 — itens e total
  const items = data.itens || []
  for (let rowIndex = 0; rowIndex < 4; rowIndex++) {
    const item = items[rowIndex] || {}
    ITEM_FIELDS.forEach((key, columnIndex) => {
      const align = columnIndex === 0 || columnIndex === 5 ? null : 'center'
      setCell(4, rowIndex + 2, columnIndex, plain(item[key] ?? '', 7.2, align))
    })
  }
  setCell(4, 6, 5, plain(data.total_ordem || 'R$', 7.8))

  // Tabela 5 — pagamento
  const payment = data.pagamento || {}
  setCell(5, 1, 0, labeled(
    'Forma:',
    [
      `${checked(payment.forma, 'pix')} PIX`,
      `${checked(payment.forma, 'credito')} Crédito`,
      `${checked(payment.forma, 'debito')} Débito`,
      `${checked(payment.forma, 'dinheiro')} Dinheiro`,
      `${checked(payment.forma, 'boleto')} Boleto`,
      `${checked(payment.forma, 'transferencia')} Transferência`,
    ].join('  '),
    7.2,
  ))
  setCell(5, 2, 0, labeled(
    'Condição:',
    `${checked(payment.condicao, 'a vista')} À vista  ${checked(payment.condicao, 'parcelado')} Parcelado`,
    7.2,
  ))
  setCell(5, 2, 1, labeled('Parcelas:', payment.parcelas, 7.2))
  setCell(5, 2, 2, labeled('1º vencimento:', payment.primeiro_vencimento, 7.2))
  setCell(5, 2, 3, labeled('Valor total:', payment.valor_total, 7.2))
  setCell(5, 3, 0, labeled('Comprovante / NSU / ID da transação:', payment.comprovante_id, 7.1))
  setCell(5, 3, 3, labeled('Responsável pelo pagamento:', payment.responsavel, 7.0))

  return editor.aplicar()
}
