// Plumbing compartilhado dos documentos Waterfall (Ordem de Serviço e Pedido).
//
// Os dois modelos são .docx da mesma família: tabelas de nível superior, sem
// aninhamento e sem vMerge, com células mescladas só na horizontal (gridSpan).
// Isso permite editar direto o word/document.xml por spans de texto —
// preservando 100% do visual, já que nada além das células mapeadas é tocado.
//
// Cada documento traz o seu próprio fill.js com a validação e o mapa de
// células; aqui fica só o que é idêntico entre eles.

// ------------------------------------------------------------------ texto

export function normalize(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

// Marca a opção escolhida num grupo de caixas: "[X] PIX" / "[ ] Boleto".
export function checked(selected, option) {
  return normalize(selected) === normalize(option) ? '[X]' : '[ ]'
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

function hojeNomeArquivo() {
  const now = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${p(now.getDate())}-${p(now.getMonth() + 1)}-${now.getFullYear()}`
}

// "<prefixo> <cliente> <DD-MM-AAAA>.<ext>" — padrão de nome das skills.
// Sem data informada, usa a de hoje.
export function nomeArquivoDocumento(prefixo, data, cliente, ext = 'docx') {
  const filenameDate = data === null || data === undefined || data === ''
    ? hojeNomeArquivo()
    : formatDate(data).filename
  return `${prefixo} ${safeFilenamePart(cliente || 'sem cliente')} ${filenameDate}.${ext}`
}

// ------------------------------------------------- varredura de spans no XML

// Encontra spans <tag ...>...</tag> de nível superior no trecho dado.
// Sem aninhamento do mesmo tag (garantido pela estrutura dos modelos).
export function findSpans(xml, tag, from = 0, to = xml.length) {
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

// Células da linha indexadas pela grade (expandindo gridSpan), replicando
// table.cell(r, c) do python-docx: uma célula mesclada ocupa vários índices.
function cellGrid(xml, rowSpan) {
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

// Mantém <w:tcPr> (bordas, largura, sombreado) e troca todo o conteúdo.
function rebuildCell(xml, cellSpan, paragraphsXml) {
  const content = xml.slice(cellSpan.start, cellSpan.end)
  const tcPrMatch = content.match(/<w:tcPr>[\s\S]*?<\/w:tcPr>/)
  const tcPr = tcPrMatch ? tcPrMatch[0] : ''
  return `<w:tc>${tcPr}${paragraphsXml}</w:tc>`
}

// Editor de células de um document.xml.
//
// As edições são acumuladas e aplicadas só no fim, da última posição para a
// primeira — assim os índices coletados na varredura continuam válidos
// enquanto o texto vai sendo substituído.
export function criarEditor(xml, tabelasEsperadas) {
  const tables = findSpans(xml, 'w:tbl')
  if (tables.length !== tabelasEsperadas) {
    throw new Error(
      `o modelo retido não possui a estrutura esperada de ${tabelasEsperadas} tabelas ` +
      `(encontradas ${tables.length})`,
    )
  }

  const edits = []

  return {
    setCell(tableIndex, row, col, paragraphs) {
      const rows = findSpans(xml, 'w:tr', tables[tableIndex].start, tables[tableIndex].end)
      if (!rows[row]) throw new Error(`linha ${row} não encontrada na tabela ${tableIndex}`)
      const cell = cellGrid(xml, rows[row])[col]
      if (!cell) throw new Error(`célula (${row},${col}) não encontrada na tabela ${tableIndex}`)
      edits.push({ span: cell, xml: rebuildCell(xml, cell, paragraphs) })
    },

    aplicar() {
      // Células mescladas aparecem em vários índices da grade e podem gerar
      // edições duplicadas do mesmo span; a última vence.
      const unique = new Map()
      for (const edit of edits) unique.set(edit.span.start, edit)
      const ordered = [...unique.values()].sort((a, b) => b.span.start - a.span.start)

      let result = xml
      for (const { span, xml: cellXml } of ordered) {
        result = result.slice(0, span.start) + cellXml + result.slice(span.end)
      }
      return result
    },
  }
}

// ------------------------------------------------------ construção de runs

export const escapeXml = (s) => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')

// <w:sz> é medido em meios-pontos, daí o size * 2.
export function runXml(text, size, bold) {
  const sz = Math.round(size * 2)
  const b = bold ? '<w:b/>' : '<w:b w:val="0"/>'
  return (
    `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>${b}` +
    `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr>` +
    `<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`
  )
}

export function paragraphXml(runsXml, align) {
  const jc = align ? `<w:jc w:val="${align}"/>` : ''
  return (
    `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>${jc}</w:pPr>` +
    runsXml + '</w:p>'
  )
}

// Uma linha com um ou mais pares "Rótulo: valor" (rótulo em negrito).
// Vários pares na mesma célula ficam separados por um espaço largo.
export function linha(segmentos, size, valueSize) {
  let runs = ''
  segmentos.forEach(([rotulo, valor], index) => {
    if (index) runs += runXml('    ', size, false)
    runs += runXml(rotulo, size, true)
    if (valor) runs += runXml(` ${valor}`, valueSize || size, false)
  })
  return paragraphXml(runs)
}

// Atalho para o caso mais comum: um único par na célula.
export function labeled(label, value, size, valueSize) {
  return linha([[label, value]], size, valueSize)
}

// Vários pares empilhados na mesma célula (quebra de linha entre eles).
export function multiline(entries, bodySize = 7.4, labelSize = 7.5) {
  let runs = ''
  entries.forEach(([label, value], index) => {
    if (index) runs += '<w:r><w:br/></w:r>'
    runs += runXml(label, labelSize, true)
    if (value) runs += runXml(` ${value}`, bodySize, false)
  })
  return paragraphXml(runs)
}

// Só o valor, sem rótulo (células da tabela de itens).
export function plain(value, size, align) {
  return paragraphXml(runXml(String(value ?? ''), size, false), align)
}

// ------------------------------------------------------------- validação

// Regras comuns às duas validações: todo campo declarado precisa existir na
// carga (nada de esquecer campo) e string vazia é recusada — para "não se
// aplica" o valor tem de ser explicitamente null.
export function checarCamposObrigatorios(dados, campos, prefixo = '') {
  const erros = []
  const faltando = campos.filter((f) => !(f in dados))
  const vazios = campos.filter(
    (f) => f in dados && typeof dados[f] === 'string' && !dados[f].trim(),
  )
  if (faltando.length) erros.push(`${prefixo}campos sem resposta: ` + faltando.join(', '))
  if (vazios.length) {
    erros.push(`${prefixo}campos vazios sem confirmação de não se aplica: ` + vazios.join(', '))
  }
  return erros
}
