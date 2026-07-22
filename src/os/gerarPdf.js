// Geração da Ordem de Serviço em PDF (Caminho A: modelo HTML paralelo ao
// reference.docx). Reproduz fiel o layout de uma página A4 do modelo oficial —
// cabeçalho com logo + endereço, seções, tabela de itens, pagamento e
// assinaturas — e baixa um .pdf com o mesmo padrão de nome do DOCX.
//
// Usa os MESMOS dados já montados/validados pelo OrdemServicoModal (o objeto
// com null para "não se aplica", itens[] e pagamento{}), então DOCX e PDF saem
// idênticos em conteúdo.

import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import { validate, formatDate, nomeArquivo } from './fill.js'
import logoUrl from './logo-os.png?url'

// --- helpers de exibição (espelham fill.js) ---

function normalize(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

function checked(selected, option) {
  return normalize(selected) === normalize(option) ? '[X]' : '[ ]'
}

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')

// Rótulo em negrito seguido do valor (ou vazio). O valor é texto do usuário,
// então é escapado.
function campo(label, value) {
  const v = value == null || value === '' ? '' : ` ${esc(value)}`
  return `<span class="lbl">${esc(label)}</span>${v}`
}

// Rótulo em negrito seguido de HTML já pronto e seguro (grupos de opção).
// Só o rótulo é escapado; o html é inserido como está (não pode conter dados
// do usuário sem escape).
function campoHtml(label, html) {
  return `<span class="lbl">${esc(label)}</span> ${html}`
}

// Grupo de opções (checkboxes). Cada item já é texto estático seguro
// ("[X] PIX" etc.); o espaçamento entre eles vem do CSS (.opt), não de &nbsp;.
function grupo(items) {
  return items.map((t) => `<span class="opt">${t}</span>`).join('')
}

// Converte a URL do logo (asset do Vite) em data URI, para não haver corrida de
// carregamento durante a rasterização do PDF.
async function logoDataUri() {
  const resp = await fetch(logoUrl)
  const blob = await resp.blob()
  return await new Promise((resolve) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result)
    fr.readAsDataURL(blob)
  })
}

// --- montagem do HTML do documento ---

export function montarHtmlOS(data, logo) {
  const displayDate = data.data == null ? '' : formatDate(data.data).display
  const p = data.pagamento || {}
  const itens = data.itens || []
  const linhaItem = (i) => {
    const it = itens[i] || {}
    return `<tr>
      <td class="l">${esc(it.descricao || '')}</td>
      <td class="c">${esc(it.quantidade || '')}</td>
      <td class="c">${esc(it.valor_unitario || '')}</td>
      <td class="c">${esc(it.desconto || '')}</td>
      <td class="c">${esc(it.valor_total || '')}</td>
      <td class="l">${esc(it.garantia_validade || '')}</td>
    </tr>`
  }

  return `<div class="os">
    <div class="cab">
      <img src="${logo}" alt="Waterfall" />
      <div class="end">Rua 291, 191 | Meia Praia, Itapema - SC &nbsp;&nbsp;&nbsp;&nbsp; WhatsApp: (47) 99186-8646</div>
      <div class="end">www.waterfall.ind.br &nbsp;&nbsp;&nbsp;&nbsp; @waterfallcompanybr</div>
    </div>

    <table class="ident">
      <tr>
        <td class="w25">${campo('OS Nº:', data.os_numero)}</td>
        <td class="w25">${campo('DATA:', displayDate)}</td>
        <td class="w25">${campo('HORA:', data.hora)}</td>
        <td class="w25">${campoHtml('STATUS:', grupo([
          `${checked(data.status, 'aberta')} Aberta`,
          `${checked(data.status, 'concluida')} Concluída`,
        ]))}</td>
      </tr>
      <tr>
        <td colspan="4">${campoHtml('TIPO DE ATENDIMENTO:', grupo([
          `${checked(data.tipo_atendimento, 'instalacao')} Instalação`,
          `${checked(data.tipo_atendimento, 'manutencao')} Manutenção`,
          `${checked(data.tipo_atendimento, 'troca de filtro')} Troca de filtro`,
          `${checked(data.tipo_atendimento, 'visita tecnica')} Visita técnica`,
        ]))}</td>
      </tr>
    </table>

    <div class="banda">1. CLIENTE E ATENDIMENTO</div>
    <table class="grade4">
      <tr>
        <td colspan="2">${campo('Cliente / Empresa:', data.cliente)}</td>
        <td colspan="2">${campo('Autorizado por:', data.autorizado_por)}</td>
      </tr>
      <tr>
        <td colspan="2">${campo('CPF/CNPJ:', data.cpf_cnpj)}</td>
        <td>${campo('Telefone / WhatsApp:', data.telefone_whatsapp)}</td>
        <td>${campo('E-mail:', data.email)}</td>
      </tr>
      <tr>
        <td colspan="2">${campo('Endereço:', data.endereco)}</td>
        <td>${campo('Nº / Complemento:', data.numero_complemento)}</td>
        <td>${campo('CEP:', data.cep)}</td>
      </tr>
      <tr>
        <td>${campo('Bairro:', data.bairro)}</td>
        <td colspan="2">${campo('Cidade:', data.cidade)}</td>
        <td>${campo('UF:', data.uf)}</td>
      </tr>
      <tr>
        <td colspan="2">${campo('Atendente:', data.atendente)}</td>
        <td colspan="2">${campo('Técnico responsável:', data.tecnico)}</td>
      </tr>
      <tr>
        <td colspan="2">${campo('Agendado para:', data.agendado_para)}</td>
        <td colspan="2">${campo('Previsão de conclusão:', data.previsao_conclusao)}</td>
      </tr>
    </table>

    <div class="banda">2. EQUIPAMENTO E SERVIÇO</div>
    <table class="grade2">
      <tr>
        <td>${campo('Equipamento / modelo:', data.equipamento_modelo)}<br>${campo('Nº de série:', data.numero_serie)}</td>
        <td>${campo('Defeito relatado pelo cliente:', data.defeito_relatado)}</td>
      </tr>
      <tr>
        <td>${campo('Diagnóstico técnico:', data.diagnostico_tecnico)}</td>
        <td>${campo('Serviço executado / observações:', data.servico_executado)}</td>
      </tr>
    </table>

    <div class="banda">3. PRODUTOS, PEÇAS E SERVIÇOS</div>
    <table class="itens">
      <tr class="cab-itens">
        <td class="l">Descrição</td>
        <td class="c">Qtd.</td>
        <td class="c">Valor un.</td>
        <td class="c">Desconto</td>
        <td class="c">Valor total</td>
        <td class="l">Garantia / validade</td>
      </tr>
      ${linhaItem(0)}${linhaItem(1)}${linhaItem(2)}${linhaItem(3)}
      <tr>
        <td colspan="5" class="total-lbl">TOTAL DA ORDEM:</td>
        <td class="l">${esc(data.total_ordem || 'R$')}</td>
      </tr>
    </table>

    <div class="banda">4. PAGAMENTO</div>
    <table class="grade4">
      <tr>
        <td colspan="4">${campoHtml('Forma:', grupo([
          `${checked(p.forma, 'pix')} PIX`,
          `${checked(p.forma, 'credito')} Crédito`,
          `${checked(p.forma, 'debito')} Débito`,
          `${checked(p.forma, 'dinheiro')} Dinheiro`,
          `${checked(p.forma, 'boleto')} Boleto`,
          `${checked(p.forma, 'transferencia')} Transferência`,
        ]))}</td>
      </tr>
      <tr>
        <td>${campoHtml('Condição:', grupo([
          `${checked(p.condicao, 'a vista')} À vista`,
          `${checked(p.condicao, 'parcelado')} Parcelado`,
        ]))}</td>
        <td>${campo('Parcelas:', p.parcelas)}</td>
        <td>${campo('1º vencimento:', p.primeiro_vencimento)}</td>
        <td>${campo('Valor total:', p.valor_total)}</td>
      </tr>
      <tr>
        <td colspan="3">${campo('Comprovante / NSU / ID da transação:', p.comprovante_id)}</td>
        <td>${campo('Responsável pelo pagamento:', p.responsavel)}</td>
      </tr>
    </table>

    <div class="banda">5. AUTORIZAÇÃO E ACEITE</div>
    <div class="aceite">
      <p>Autorizo a execução dos serviços descritos nesta ordem e declaro estar ciente dos valores, condições de pagamento e garantia informados. Autorizo o uso dos dados acima exclusivamente para atendimento, contato e registro desta ordem, conforme a LGPD.</p>
      <div class="assin">
        <div>Assinatura do Cliente:<br><br>____________________________________________&nbsp;&nbsp;&nbsp;&nbsp;Data: ___/___/_____</div>
        <div>Assinatura do Técnico:<br><br>____________________________________________&nbsp;&nbsp;&nbsp;&nbsp;Data: ___/___/_____</div>
      </div>
    </div>
  </div>`
}

export const CSS = `
  .os { width: 210mm; box-sizing: border-box; padding: 8mm 11.5mm 7mm;
        background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif;
        font-size: 8pt; line-height: 1.3; }
  .os * { box-sizing: border-box; }
  .os .cab { border: 1px solid #000; text-align: center; padding: 6px 6px 7px; margin-bottom: 6px; }
  .os .cab img { height: 14mm; width: auto; margin-bottom: 4px; }
  .os .cab .end { font-size: 7.5pt; line-height: 1.45; }
  .os table { width: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 6px; }
  .os td { border: 1px solid #000; padding: 4px 6px; vertical-align: middle;
           word-wrap: break-word; overflow-wrap: break-word; }
  .os .lbl { font-weight: bold; }
  .os .opt { display: inline-block; margin-right: 16px; white-space: nowrap; }
  .os .w25 { width: 25%; }
  .os .banda { background: #E8E8E8; border: 1px solid #000; border-bottom: none;
               font-weight: bold; font-size: 8pt; padding: 4px 7px; margin-top: 2px; }
  .os .banda + table { margin-top: 0; }
  .os .ident td { height: 24px; }
  .os .grade4 td { height: 24px; }
  .os .grade2 td { height: 46px; vertical-align: top; }
  .os .itens .cab-itens td { background: #F4F4F4; font-weight: bold; text-align: center; height: 22px; }
  .os .itens td { height: 24px; }
  .os .itens .l { text-align: left; }
  .os .itens .c { text-align: center; }
  .os .itens .total-lbl { text-align: right; font-weight: bold; }
  .os .aceite { border: 1px solid #000; padding: 8px 10px; }
  .os .aceite p { margin: 0 0 14px; text-align: justify; line-height: 1.45; }
  .os .assin { display: flex; gap: 20px; margin-top: 4px; }
  .os .assin > div { flex: 1; line-height: 1.95; }
`

// Renderiza o HTML num iframe ISOLADO e gera o PDF (A4, 1 página).
// O iframe é essencial: o html2canvas não entende as cores oklch() que o
// Tailwind injeta globalmente na página; num documento próprio, sem esse CSS,
// ele só enxerga o nosso estilo (cores em hex).
export async function gerarOrdemServicoPdf(data) {
  validate(data)
  const logo = await logoDataUri()

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
    `<style>*{margin:0;padding:0}html,body{background:#fff}${CSS}</style></head>` +
    `<body>${montarHtmlOS(data, logo)}</body></html>`,
  )
  doc.close()

  // Garante que o logo (data URI) terminou de carregar antes de rasterizar.
  const img = doc.querySelector('.os .cab img')
  if (img && !img.complete) {
    await new Promise((res) => { img.onload = res; img.onerror = res })
  }

  const nome = nomeArquivo(data, 'pdf')
  try {
    // html2canvas clona o documento do próprio elemento (o iframe limpo),
    // então não vê as cores oklch do Tailwind e rasteriza sem erro.
    const canvas = await html2canvas(doc.querySelector('.os'), {
      scale: 3,
      useCORS: true,
      backgroundColor: '#ffffff',
    })

    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
    const larguraPagina = pdf.internal.pageSize.getWidth() // 210 mm
    const alturaPagina = pdf.internal.pageSize.getHeight() // 297 mm

    // Encaixa em UMA página: normalmente usa a largura toda; se o conteúdo ficar
    // mais alto que a página (OS muito cheia), reduz proporcionalmente para não
    // cortar o rodapé, centralizando na horizontal.
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

// Exposto no modo dev para testes no navegador
if (import.meta.env.DEV) {
  window.__gerarOSPdf = gerarOrdemServicoPdf
}
