// Geração da Ordem de Serviço em PDF (Caminho A: modelo HTML paralelo ao
// reference.docx). Reproduz fiel o layout de uma página A4 do modelo oficial —
// cabeçalho com logo + endereço, seções, tabela de itens, pagamento e
// assinaturas — e baixa um .pdf com o mesmo padrão de nome do DOCX.
//
// Usa os MESMOS dados já montados/validados pelo OrdemServicoModal (o objeto
// com null para "não se aplica", itens[] e pagamento{}), então DOCX e PDF saem
// idênticos em conteúdo.

import { validate, formatDate, nomeArquivo } from './fill.js'
import { checked } from '../documentos/docx.js'
import {
  esc, campo, campoHtml, grupo, logoDataUri, cssDocumento, gerarPdfDeHtml,
} from '../documentos/pdf.js'

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

export const CSS = cssDocumento('.os') + `
  .os .grade2 td { height: 46px; vertical-align: top; }
  .os .aceite { border: 1px solid #000; padding: 8px 10px; }
  .os .aceite p { margin: 0 0 14px; text-align: justify; line-height: 1.45; }
  .os .assin { display: flex; gap: 20px; margin-top: 4px; }
  .os .assin > div { flex: 1; line-height: 1.95; }
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
