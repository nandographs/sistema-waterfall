// Geração de PDF dos documentos Waterfall (Ordem de Serviço e Pedido).
//
// Caminho A: cada documento tem um modelo HTML paralelo ao .docx, que reproduz
// fiel o layout de uma página A4 do modelo oficial. Aqui ficam os helpers de
// montagem do HTML, o CSS comum aos dois e a rasterização em PDF.

import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import logoUrl from './logo-waterfall.png?url'

// ------------------------------------------------------- montagem do HTML

export const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')

// Rótulo em negrito seguido do valor (ou vazio). O valor é texto do usuário,
// então é escapado.
export function campo(label, value) {
  const v = value == null || value === '' ? '' : ` ${esc(value)}`
  return `<span class="lbl">${esc(label)}</span>${v}`
}

// Rótulo em negrito seguido de HTML já pronto e seguro (grupos de opção).
// Só o rótulo é escapado; o html é inserido como está (não pode conter dados
// do usuário sem escape).
export function campoHtml(label, html) {
  return `<span class="lbl">${esc(label)}</span> ${html}`
}

// Grupo de opções (checkboxes). Cada item já é texto estático seguro
// ("[X] PIX" etc.); o espaçamento entre eles vem do CSS (.opt), não de &nbsp;.
export function grupo(items) {
  return items.map((t) => `<span class="opt">${t}</span>`).join('')
}

// Converte a URL do logo (asset do Vite) em data URI, para não haver corrida de
// carregamento durante a rasterização do PDF.
export async function logoDataUri() {
  const resp = await fetch(logoUrl)
  const blob = await resp.blob()
  return await new Promise((resolve) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result)
    fr.readAsDataURL(blob)
  })
}

// ------------------------------------------------------------------- CSS

// Regras comuns aos dois documentos. `raiz` é o seletor da folha (ex.: '.os'),
// para os estilos não vazarem entre eles.
export function cssDocumento(raiz) {
  return `
  ${raiz} { width: 210mm; box-sizing: border-box; padding: 8mm 11.5mm 7mm;
        background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif;
        font-size: 8pt; line-height: 1.3; }
  ${raiz} * { box-sizing: border-box; }
  ${raiz} .cab { border: 1px solid #000; text-align: center; padding: 6px 6px 7px; margin-bottom: 6px; }
  ${raiz} .cab img { height: 14mm; width: auto; margin-bottom: 4px; }
  ${raiz} .cab .end { font-size: 7.5pt; line-height: 1.45; }
  ${raiz} table { width: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 6px; }
  ${raiz} td { border: 1px solid #000; padding: 4px 6px; vertical-align: middle;
           word-wrap: break-word; overflow-wrap: break-word; }
  ${raiz} .lbl { font-weight: bold; }
  ${raiz} .opt { display: inline-block; margin-right: 16px; white-space: nowrap; }
  ${raiz} .w25 { width: 25%; }
  ${raiz} .banda { background: #E8E8E8; border: 1px solid #000; border-bottom: none;
               font-weight: bold; font-size: 8pt; padding: 4px 7px; margin-top: 2px; }
  ${raiz} .banda + table { margin-top: 0; }
  ${raiz} .ident td { height: 24px; }
  ${raiz} .grade4 td { height: 24px; }
  ${raiz} .itens .cab-itens td { background: #F4F4F4; font-weight: bold; text-align: center; height: 22px; }
  ${raiz} .itens td { height: 24px; }
  ${raiz} .itens .l { text-align: left; }
  ${raiz} .itens .c { text-align: center; }
  ${raiz} .itens .total-lbl { text-align: right; font-weight: bold; }
`
}

// ------------------------------------------------------------ rasterização

// Renderiza o HTML num iframe ISOLADO e gera o PDF (A4, 1 página).
// O iframe é essencial: o html2canvas não entende as cores oklch() que o
// Tailwind injeta globalmente na página; num documento próprio, sem esse CSS,
// ele só enxerga o nosso estilo (cores em hex).
export async function gerarPdfDeHtml({ html, css, seletor, nome }) {
  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.left = '-10000px'
  iframe.style.top = '0'
  iframe.style.width = '210mm'
  iframe.style.height = '300mm'
  iframe.style.border = '0'
  document.body.appendChild(iframe)

  const doc = iframe.contentDocument
  doc.open()
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<style>*{margin:0;padding:0}html,body{background:#fff}${css}</style></head>` +
    `<body>${html}</body></html>`,
  )
  doc.close()

  // Garante que o logo (data URI) terminou de carregar antes de rasterizar.
  const img = doc.querySelector(`${seletor} .cab img`)
  if (img && !img.complete) {
    await new Promise((res) => { img.onload = res; img.onerror = res })
  }

  try {
    // html2canvas clona o documento do próprio elemento (o iframe limpo),
    // então não vê as cores oklch do Tailwind e rasteriza sem erro.
    const canvas = await html2canvas(doc.querySelector(seletor), {
      scale: 3,
      useCORS: true,
      backgroundColor: '#ffffff',
    })

    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
    const larguraPagina = pdf.internal.pageSize.getWidth() // 210 mm
    const alturaPagina = pdf.internal.pageSize.getHeight() // 297 mm

    // Encaixa em UMA página: normalmente usa a largura toda; se o conteúdo ficar
    // mais alto que a página (documento muito cheio), reduz proporcionalmente
    // para não cortar o rodapé, centralizando na horizontal.
    let larguraImg = larguraPagina
    let alturaImg = (canvas.height * larguraPagina) / canvas.width
    if (alturaImg > alturaPagina) {
      alturaImg = alturaPagina
      larguraImg = (canvas.width * alturaPagina) / canvas.height
    }
    const x = (larguraPagina - larguraImg) / 2
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.98), 'JPEG', x, 0, larguraImg, alturaImg)
    pdf.save(nome)
  } finally {
    document.body.removeChild(iframe)
  }
  return nome
}
