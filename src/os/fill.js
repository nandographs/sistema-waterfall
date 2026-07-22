// Preenchimento da Ordem de Serviço Waterfall.
//
// Porta fiel de scripts/fill_order.py da skill
// "artifact-template-ordem-de-servico-waterfall": mesma validação, mesmo
// mapeamento de células e mesmos limites. Opera direto no word/document.xml
// do modelo (reference.docx), preservando todo o visual — nada além das
// células mapeadas é alterado.
//
// O modelo tem 7 tabelas de nível superior e nenhuma tabela aninhada nem
// vMerge (verificado), então a varredura por spans de <w:tbl>/<w:tr>/<w:tc>
// é segura. Células mescladas horizontalmente usam gridSpan, e a indexação
// de colunas replica o comportamento do python-docx (expansão pela grade).

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

// ---------------------------------------------------------------- utilidades

function normalize(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

export function formatDate(value) {
  const raw = String(value ?? '').trim()
  const patterns = [
    [/^(\d{2})\/(\d{2})\/(\d{4})$/, (m) => [m[3], m[2], m[1]]],
    [/^(\d{2})-(\d{2})-(\d{4})$/, (m) => [m[3], m[2], m[1]]],
    [/^(\d{4})-(\d{2})-(\d{2})$/, (m) => [m[1], m[2], m[3]]],
  ]
  for (const [re, pick] of patterns) {
    const m = raw.match(re)
    if (!m) continue
    const [y, mo, d] = pick(m)
    const dt = new Date(Number(y), Number(mo) - 1, Number(d))
    if (dt.getFullYear() === Number(y) && dt.getMonth() === Number(mo) - 1 && dt.getDate() === Number(d)) {
      return { display: `${d}/${mo}/${y}`, filename: `${d}-${mo}-${y}` }
    }
  }
  throw new Error('data deve estar em DD/MM/AAAA, DD-MM-AAAA ou AAAA-MM-DD')
}

function safeFilenamePart(value) {
  const cleaned = String(value).trim()
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[ .]+|[ .]+$/g, '')
  if (!cleaned) throw new Error('cliente não pode resultar em nome de arquivo vazio')
  return cleaned
}

export function nomeArquivo(data, ext = 'docx') {
  const filenameDate = data.data === null || data.data === undefined || data.data === ''
    ? hojeNomeArquivo()
    : formatDate(data.data).filename
  const client = safeFilenamePart(data.cliente || 'sem cliente')
  return `ordem ${client} ${filenameDate}.${ext}`
}

function hojeNomeArquivo() {
  const now = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${p(now.getDate())}-${p(now.getMonth() + 1)}-${now.getFullYear()}`
}

function checked(selected, option) {
  return normalize(selected) === normalize(option) ? '[X]' : '[ ]'
}

// ---------------------------------------------------------------- validação

export function validate(data) {
  const errors = []
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('os dados precisam ser um objeto JSON')
  }

  const missing = TOP_LEVEL_FIELDS.filter((f) => !(f in data))
  const unanswered = TOP_LEVEL_FIELDS.filter(
    (f) => f in data && typeof data[f] === 'string' && !data[f].trim(),
  )
  if (missing.length) errors.push('campos sem resposta: ' + missing.join(', '))
  if (unanswered.length) errors.push('campos vazios sem confirmação de não se aplica: ' + unanswered.join(', '))

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
      const itemMissing = ITEM_FIELDS.filter((f) => !(f in item))
      const itemUnanswered = ITEM_FIELDS.filter(
        (f) => f in item && typeof item[f] === 'string' && !item[f].trim(),
      )
      if (itemMissing.length) errors.push(`item ${n} sem resposta: ` + itemMissing.join(', '))
      if (itemUnanswered.length) errors.push(`item ${n} vazio sem não se aplica: ` + itemUnanswered.join(', '))
      if (String(item.descricao ?? '').length > 70) errors.push(`descrição do item ${n} excede 70 caracteres`)
    })
  }

  const payment = data.pagamento
  if (payment !== null && payment !== undefined) {
    if (typeof payment !== 'object' || Array.isArray(payment)) {
      errors.push('pagamento deve ser um objeto completo ou null para não se aplica')
    } else {
      const payMissing = PAYMENT_FIELDS.filter((f) => !(f in payment))
      const payUnanswered = PAYMENT_FIELDS.filter(
        (f) => f in payment && typeof payment[f] === 'string' && !payment[f].trim(),
      )
      if (payMissing.length) errors.push('pagamento sem resposta: ' + payMissing.join(', '))
      if (payUnanswered.length) {
        errors.push('pagamento vazio sem confirmação de não se aplica: ' + payUnanswered.join(', '))
      }
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

// ------------------------------------------------- varredura de spans no XML

function findSpans(xml, tag, from = 0, to = xml.length) {
  // Encontra spans <tag ...>...</tag> de nível superior no trecho dado.
  // Sem aninhamento do mesmo tag (garantido pela estrutura do modelo).
  const spans = []
  const open = new RegExp(`<${tag}(?=[\\s>])`, 'g')
  open.lastIndex = from
  let m
  while ((m = open.exec(xml)) && m.index < to) {
    const closeTag = `</${tag}>`
    const end = xml.indexOf(closeTag, m.index)
    if (end === -1 || end > to) break
    spans.push({ start: m.index, end: end + closeTag.length })
    open.lastIndex = end + closeTag.length
  }
  return spans
}

function cellGrid(xml, rowSpan) {
  // Retorna células da linha indexadas pela grade (expandindo gridSpan),
  // replicando table.cell(r, c) do python-docx.
  const cells = findSpans(xml, 'w:tc', rowSpan.start, rowSpan.end)
  const grid = []
  for (const cell of cells) {
    const content = xml.slice(cell.start, cell.end)
    const spanMatch = content.match(/<w:gridSpan w:val="(\d+)"\/>/)
    const span = spanMatch ? Number(spanMatch[1]) : 1
    for (let i = 0; i < span; i++) grid.push(cell)
  }
  return grid
}

function rebuildCell(xml, cellSpan, paragraphsXml) {
  // Mantém <w:tcPr> e substitui todo o conteúdo da célula.
  const content = xml.slice(cellSpan.start, cellSpan.end)
  const tcPrMatch = content.match(/<w:tcPr>[\s\S]*?<\/w:tcPr>/)
  const tcPr = tcPrMatch ? tcPrMatch[0] : ''
  return `<w:tc>${tcPr}${paragraphsXml}</w:tc>`
}

// ------------------------------------------------------ construção de runs

const escapeXml = (s) => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')

function runXml(text, size, bold) {
  const sz = Math.round(size * 2)
  const b = bold ? '<w:b/>' : '<w:b w:val="0"/>'
  return (
    `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>${b}` +
    `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr>` +
    `<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`
  )
}

function paragraphXml(runsXml, align) {
  const jc = align ? `<w:jc w:val="${align}"/>` : ''
  return (
    `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>${jc}</w:pPr>` +
    runsXml + '</w:p>'
  )
}

function labeled(label, value, size, valueSize) {
  let runs = runXml(label, size, true)
  if (value) runs += runXml(` ${value}`, valueSize || size, false)
  return paragraphXml(runs)
}

function multiline(entries, bodySize = 7.4) {
  let runs = ''
  entries.forEach(([label, value], index) => {
    if (index) runs += '<w:r><w:br/></w:r>'
    runs += runXml(label, 7.5, true)
    if (value) runs += runXml(` ${value}`, bodySize, false)
  })
  return paragraphXml(runs)
}

function plain(value, size, align) {
  return paragraphXml(runXml(String(value ?? ''), size, false), align)
}

// -------------------------------------------------------------- preenchimento

export function fillDocumentXml(xml, data) {
  validate(data)

  const displayDate = data.data == null ? '' : formatDate(data.data).display

  const tables = findSpans(xml, 'w:tbl')
  if (tables.length !== 7) {
    throw new Error('o modelo retido não possui a estrutura esperada de 7 tabelas')
  }

  // Cada edição é registrada como {span, xml} e aplicada em ordem reversa
  // para não invalidar os índices.
  const edits = []
  const setCell = (tableIndex, row, col, paragraphs) => {
    const rows = findSpans(xml, 'w:tr', tables[tableIndex].start, tables[tableIndex].end)
    const grid = cellGrid(xml, rows[row])
    const cell = grid[col]
    if (!cell) throw new Error(`célula (${row},${col}) não encontrada na tabela ${tableIndex}`)
    edits.push({ span: cell, xml: rebuildCell(xml, cell, paragraphs) })
  }

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

  // Aplicar edições da última para a primeira (índices permanecem válidos).
  // Células repetidas na grade (gridSpan) podem gerar edições duplicadas do
  // mesmo span; deduplicar pelo início.
  const unique = new Map()
  for (const edit of edits) unique.set(edit.span.start, edit)
  const ordered = [...unique.values()].sort((a, b) => b.span.start - a.span.start)

  let result = xml
  for (const { span, xml: cellXml } of ordered) {
    result = result.slice(0, span.start) + cellXml + result.slice(span.end)
  }
  return result
}
