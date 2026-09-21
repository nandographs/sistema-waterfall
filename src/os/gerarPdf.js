// Geração da Ordem de Serviço em PDF (Caminho A: modelo HTML paralelo ao
// reference.docx). Reproduz fiel o layout de uma página A4 do modelo oficial —
// cabeçalho com logo + endereço, seções, tabela de itens com o pagamento e
// assinaturas — e baixa um .pdf com o mesmo padrão de nome do DOCX.
//
// Usa os MESMOS dados já montados/validados pelo OrdemServicoModal (o objeto
// com null para "não se aplica", itens[] e pagamento{}), então DOCX e PDF saem
// idênticos em conteúdo.

import {
  validate, formatDate, nomeArquivo, FORMAS_PAGAMENTO, resumoViaCliente,
} from './fill.js'
import { checked } from '../documentos/docx.js'
import {
  esc, campo, campoHtml, grupo, logoDataUri, cssDocumento, gerarPdfDeHtml,
} from '../documentos/pdf.js'
import { ENDERECO, WHATSAPP, SITE, INSTAGRAM } from '../documentos/empresa.js'

// --- montagem do HTML do documento ---

// Dados da empresa empilhados, para ficar ao lado do logo (cabeçalho e via do
// cliente) em vez de embaixo dele.
const dadosEmpresa = () => `<div class="dados">
      <b>${ENDERECO}</b><br>${WHATSAPP}<br>${SITE}&nbsp;&nbsp;·&nbsp;&nbsp;${INSTAGRAM}
    </div>`

export function montarHtmlOS(data, logo) {
  const displayDate = data.data == null ? '' : formatDate(data.data).display
  const p = data.pagamento || {}
  const itens = data.itens || []
  const via = resumoViaCliente(data)
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
    <div class="cab cab-lado">
      <img src="${logo}" alt="Waterfall" />
      ${dadosEmpresa()}
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
        <td>${campo('Observação:', data.servico_executado)}</td>
        <td>${campo('Equipamento / modelo:', data.equipamento_modelo)}<br>${campo('Nº de série:', data.numero_serie)}</td>
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
      <tr>
        <td colspan="5" class="l">${campoHtml('PAGAMENTO:', grupo(
          FORMAS_PAGAMENTO.map(([valor, rotulo]) => `${checked(p.forma, valor)} ${rotulo}`),
        ))}</td>
        <td class="l">${esc(p.valor || 'R$')}</td>
      </tr>
    </table>

    <div class="banda">4. AUTORIZAÇÃO E ACEITE</div>
    <div class="aceite">
      <p>Autorizo a execução dos serviços descritos nesta ordem e declaro estar ciente dos valores, condições de pagamento e garantia informados. Autorizo o uso dos dados acima exclusivamente para atendimento, contato e registro desta ordem, conforme a LGPD.</p>
      <div class="assin">
        <div>Assinatura do Cliente:<br><br>____________________________________________&nbsp;&nbsp;&nbsp;&nbsp;Data: ___/___/_____</div>
      </div>
    </div>

    <div class="recorte"><span>✂ recorte aqui — via do cliente</span></div>
    <table class="via">
      <tr>
        <td class="via-logo"><img src="${logo}" alt="Waterfall" /></td>
        <td colspan="2">${dadosEmpresa()}</td>
        <td class="via-tit"><span class="lbl">VIA DO CLIENTE</span><br>${campo('OS Nº:', data.os_numero)}</td>
      </tr>
      <tr>
        <td colspan="2">${campo('Serviço:', via.servico)}</td>
        <td>${campo('Valor:', via.valor)}</td>
        <td>${campo('Data:', displayDate)}</td>
      </tr>
      <tr class="via-assin">
        <td colspan="2">${campo('Técnico responsável:', data.tecnico)}</td>
        <td colspan="2" class="topo">${campo('Assinatura do técnico:', '')}</td>
      </tr>
    </table>
  </div>`
}

export const CSS = cssDocumento('.os') + `
  .os td { padding: 5px 9px; }
  .os .ident td, .os .grade4 td, .os .itens td { height: 30px; }
  .os .banda { padding: 5px 9px; }
  .os .grade2 td { height: 46px; vertical-align: top; }
  .os .aceite { border: 1px solid #000; padding: 8px 10px; }
  .os .aceite p { margin: 0 0 14px; text-align: justify; line-height: 1.45; }
  .os .assin { display: flex; gap: 20px; margin-top: 4px; }
  .os .assin > div { flex: 1; line-height: 1.95; }
  .os .cab-lado { display: flex; align-items: center; justify-content: space-between;
                  text-align: right; padding: 6px 10px; }
  .os .cab-lado img { margin-bottom: 0; }
  .os .dados { font-size: 7.5pt; line-height: 1.5; text-align: right; }
  /* Folha com no mínimo a altura do A4: a via do cliente vai para o pé da página */
  .os { min-height: 297mm; display: flex; flex-direction: column; }
  .os .aceite { margin-bottom: 14px; }
  .os .recorte { border-top: 1px dashed #000; margin: auto 0 6px; padding-top: 0; text-align: center; }
  .os .recorte span { position: relative; top: -7px; background: #fff; padding: 0 8px; font-size: 7pt; }
  .os .via { margin-bottom: 0; }
  .os .via .via-logo { width: 25%; }
  .os .via .via-logo img { height: 8mm; width: auto; display: block; }
  .os .via .dados { font-size: 7pt; }
  .os .via .via-tit { width: 20%; text-align: center; background: #E8E8E8; }
  .os .via td { height: 24px; }
  .os .via .via-assin td { height: 56px; }
  .os .via .topo { vertical-align: top; }
`

export async function gerarOrdemServicoPdf(data) {
  validate(data)
  const logo = await logoDataUri()
  return gerarPdfDeHtml({
    html: montarHtmlOS(data, logo),
    css: CSS,
    seletor: '.os',
    nome: nomeArquivo(data, 'pdf'),
  })
}

// Exposto no modo dev para testes no navegador
if (import.meta.env.DEV) {
  window.__gerarOSPdf = gerarOrdemServicoPdf
}
