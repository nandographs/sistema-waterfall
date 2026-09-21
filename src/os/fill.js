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
  checked, criarEditor, labeled, multiline, plain, paragraphXml, runXml,
  formatDate, nomeArquivoDocumento, checarCamposObrigatorios,
} from '../documentos/docx.js'

// Reexportado: gerarPdf.js e os testes importam formatDate daqui.
export { formatDate }

export const TOP_LEVEL_FIELDS = [
  'os_numero', 'data', 'hora', 'status', 'cliente',
  'autorizado_por', 'cpf_cnpj', 'telefone_whatsapp', 'email', 'endereco',
  'numero_complemento', 'cep', 'bairro', 'cidade', 'uf', 'atendente',
  'tecnico', 'agendado_para', 'previsao_conclusao', 'equipamento_modelo',
  'numero_serie', 'servico_executado', 'itens', 'total_ordem', 'pagamento',
]
export const ITEM_FIELDS = [
  'descricao', 'quantidade', 'valor_unitario', 'desconto', 'valor_total',
  'garantia_validade',
]
// Pagamento resumido: só a forma marcada e o valor pago.
export const PAYMENT_FIELDS = ['forma', 'valor']
export const FORMAS_PAGAMENTO = [
  ['pix', 'PIX'], ['credito', 'Crédito'], ['debito', 'Débito'],
  ['dinheiro', 'Dinheiro'], ['boleto', 'Boleto'], ['transferencia', 'Transferência'],
]

// O que vai na via do cliente: os itens da ordem numa linha só ("2x Refil,
// Instalação") — ou o equipamento, se não houver itens — e o valor cobrado.
export function resumoViaCliente(data) {
  const itens = (data.itens || [])
    .filter((item) => item.descricao)
    .map((item) => (Number(item.quantidade) > 1 ? `${item.quantidade}x ${item.descricao}` : item.descricao))
  return {
    servico: itens.join(', ') || data.equipamento_modelo || '',
    valor: data.total_ordem || data.pagamento?.valor || '',
  }
}

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

  if (String(data.servico_executado ?? '').length > 180) errors.push('servico_executado excede 180 caracteres')
  for (const [field, value] of Object.entries(data)) {
    if (['itens', 'pagamento', 'servico_executado'].includes(field)) continue
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

  // Tabela 3 — equipamento e serviço (a observação abre a seção)
  setCell(3, 1, 0, multiline([['Observação:', data.servico_executado]], 7.1))
  setCell(3, 1, 1, multiline([
    ['Equipamento / modelo:', data.equipamento_modelo],
    ['Nº de série:', data.numero_serie],
  ]))

  // Tabela 4 — itens, total e pagamento resumido
  const items = data.itens || []
  for (let rowIndex = 0; rowIndex < 4; rowIndex++) {
    const item = items[rowIndex] || {}
    ITEM_FIELDS.forEach((key, columnIndex) => {
      const align = columnIndex === 0 || columnIndex === 5 ? null : 'center'
      setCell(4, rowIndex + 2, columnIndex, plain(item[key] ?? '', 7.2, align))
    })
  }
  setCell(4, 6, 5, plain(data.total_ordem || 'R$', 7.8))

  const payment = data.pagamento || {}
  setCell(4, 7, 0, labeled(
    'PAGAMENTO:',
    FORMAS_PAGAMENTO.map(([valor, rotulo]) => `${checked(payment.forma, valor)} ${rotulo}`).join('  '),
    7.6,
  ))
  setCell(4, 7, 5, plain(payment.valor || 'R$', 7.8))

  // Tabela 6 — via do cliente, destacável no pé da página
  const via = resumoViaCliente(data)
  setCell(6, 0, 3, paragraphXml(
    runXml('VIA DO CLIENTE', 8, true) + '<w:r><w:br/></w:r>' +
    runXml('OS Nº:', 7.5, true) + (data.os_numero ? runXml(` ${data.os_numero}`, 7.5, false) : ''),
    'center',
  ))
  setCell(6, 1, 0, labeled('Serviço:', via.servico, 7.5))
  setCell(6, 1, 2, labeled('Valor:', via.valor, 7.5))
  setCell(6, 1, 3, labeled('Data:', displayDate, 7.5))
  setCell(6, 2, 0, labeled('Técnico responsável:', data.tecnico, 7.5))

  return editor.aplicar()
}
