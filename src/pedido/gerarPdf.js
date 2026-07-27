// Geração do Pedido de Venda em PDF — modelo HTML paralelo ao reference.docx.
// Reproduz o layout de uma página A4 do modelo oficial: cabeçalho com logo,
// identificação, cliente, atendimento/entrega, produtos, pagamento, aceite e
// assinaturas. Baixa um .pdf com o mesmo padrão de nome do DOCX.
//
// Usa os MESMOS dados já montados/validados pelo PedidoModal (objeto com null
// para "não se aplica", itens[] e pagamento{}), então DOCX e PDF saem idênticos
// em conteúdo.

import { validate, formatDate, nomeArquivo } from './fill.js'
import { checked } from '../documentos/docx.js'
import {
  esc, campo, campoHtml, grupo, logoDataUri, cssDocumento, gerarPdfDeHtml,
} from '../documentos/pdf.js'

// Monta um grupo de caixas a partir de [valor, rótulo]
const opcoes = (escolhido, lista) =>
  grupo(lista.map(([valor, rotulo]) => `${checked(escolhido, valor)} ${rotulo}`))

export function montarHtmlPedido(data, logo) {
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
    </tr>`
  }

  return `<div class="ped">
    <div class="cab">
      <img src="${logo}" alt="Waterfall" />
      <div class="end">Rua 291, 191 | Meia Praia, Itapema - SC &nbsp;&nbsp;&nbsp;&nbsp; WhatsApp: (47) 99186-8646</div>
      <div class="end">www.waterfall.ind.br &nbsp;&nbsp;&nbsp;&nbsp; @waterfallcompanybr</div>
    </div>

    <table class="ident">
      <tr>
        <td class="w34">${campo('PEDIDO Nº:', data.pedido_numero)}</td>
        <td class="w20">${campo('DATA:', displayDate)}</td>
        <td class="w17">${campo('VALIDADE:', data.validade_dias ? `${data.validade_dias} dias` : '')}</td>
        <td class="w29">${campoHtml('STATUS:', opcoes(data.status, [
          ['proposta', 'Proposta'], ['confirmado', 'Confirmado'],
        ]))}</td>
      </tr>
      <tr>
        <td colspan="4">
          ${campoHtml('TIPO:', opcoes(data.tipo, [['venda', 'Venda'], ['orcamento', 'Orçamento']]))}
          &nbsp;&nbsp;
          ${campoHtml('CANAL:', opcoes(data.canal, [
            ['loja', 'Loja'], ['whatsapp', 'WhatsApp'], ['telefone', 'Telefone'], ['externo', 'Externo'],
          ]))}
        </td>
      </tr>
    </table>

    <div class="banda">1. CLIENTE</div>
    <table class="grade4">
      <tr>
        <td colspan="2">${campo('Cliente / Razão social:', data.cliente)}</td>
        <td colspan="2">${campo('Nome para contato:', data.nome_contato)}</td>
      </tr>
      <tr>
        <td colspan="2">${campo('CPF/CNPJ:', data.cpf_cnpj)}</td>
        <td>${campo('RG / Inscrição estadual:', data.rg_inscricao)}</td>
        <td>${campo('Data de nascimento:', data.data_nascimento)}</td>
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
        <td colspan="2">${campo('Telefone / WhatsApp:', data.telefone_whatsapp)}</td>
        <td colspan="2">${campo('E-mail:', data.email)}</td>
      </tr>
    </table>

    <div class="banda">2. ATENDIMENTO E ENTREGA</div>
    <table class="grade4">
      <tr>
        <td colspan="2">${campo('Consultor / Vendedor:', data.consultor)}</td>
        <td colspan="2">${campo('Telefone:', data.consultor_telefone)}</td>
      </tr>
      <tr>
        <td colspan="2">${campo('Distribuidor / Responsável:', data.distribuidor)}</td>
        <td colspan="2">${campo('Telefone:', data.distribuidor_telefone)}</td>
      </tr>
      <tr>
        <td colspan="4">
          ${campoHtml('Entrega:', opcoes(data.entrega, [
            ['retirada', 'Retirada'],
            ['endereco acima', 'Entrega no endereço acima'],
            ['outro', 'Outro endereço:'],
          ]))}
          ${data.entrega_endereco ? esc(data.entrega_endereco) : ''}
          &nbsp;&nbsp;${campo('Previsão:', data.entrega_previsao)}
        </td>
      </tr>
    </table>

    <div class="banda">3. PRODUTOS</div>
    <table class="itens">
      <tr class="cab-itens">
        <td class="l">Descrição / Modelo</td>
        <td class="c">Qtd.</td>
        <td class="c">Valor un.</td>
        <td class="c">Desconto</td>
        <td class="c">Valor total</td>
      </tr>
      ${linhaItem(0)}${linhaItem(1)}${linhaItem(2)}${linhaItem(3)}
      <tr>
        <td colspan="4" class="total-lbl">SUBTOTAL:</td>
        <td class="c">${esc(data.subtotal || 'R$')}</td>
      </tr>
      <tr>
        <td colspan="4" class="total-lbl">
          ${campo('DESCONTO TOTAL:', data.desconto_total)}
          &nbsp;&nbsp;${campo('FRETE:', data.frete)}
          &nbsp;&nbsp;<span class="lbl">TOTAL DO PEDIDO:</span>
        </td>
        <td class="c forte">${esc(data.total_pedido || 'R$')}</td>
      </tr>
    </table>

    <div class="banda">4. PAGAMENTO</div>
    <table class="grade4">
      <tr>
        <td colspan="4">${campoHtml('Forma:', opcoes(p.forma, [
          ['pix', 'PIX'], ['credito', 'Crédito'], ['debito', 'Débito'],
          ['dinheiro', 'Dinheiro'], ['boleto', 'Boleto'], ['transferencia', 'Transferência'],
        ]))}</td>
      </tr>
      <tr>
        <td>${campoHtml('Condição:', opcoes(p.condicao, [
          ['a vista', 'À vista'], ['parcelado', 'Parcelado'],
        ]))}</td>
        <td>${campo('Entrada:', p.entrada)}</td>
        <td>${campo('Parcelas:', p.parcelas)}</td>
        <td>${campo('1º vencimento:', p.primeiro_vencimento)}</td>
      </tr>
      <tr>
        <td colspan="3">${campo('Comprovante / NSU / ID da transação:', p.comprovante_id)}</td>
        <td>${campo('Responsável pelo pagamento:', p.responsavel)}</td>
      </tr>
    </table>

    <div class="banda">5. OBSERVAÇÕES E ACEITE</div>
    <table class="obs">
      <tr>
        <td>${campo('Observações / condições especiais:', data.observacoes)}</td>
        <td>Declaro que conferi os produtos, valores, forma de pagamento e condições de entrega
            deste pedido. Estou ciente das orientações de garantia, troca e devolução aplicáveis.</td>
      </tr>
    </table>

    <table class="assin">
      <tr>
        <td>________________________________<br>Cliente &nbsp;&nbsp;&nbsp;&nbsp;Data: ___/___/_____</td>
        <td>________________________________<br>Consultor / Vendedor</td>
        <td>________________________________<br>Distribuidor / Responsável</td>
      </tr>
    </table>
  </div>`
}

export const CSS = cssDocumento('.ped') + `
  .ped .w34 { width: 34%; }
  .ped .w20 { width: 20%; }
  .ped .w17 { width: 17%; }
  .ped .w29 { width: 29%; }
  .ped .itens .forte { font-weight: bold; }
  .ped .obs td { height: 62px; vertical-align: top; line-height: 1.45; }
  .ped .assin td { height: 40px; vertical-align: bottom; text-align: center;
                   border: none; padding-top: 10px; line-height: 1.6; }
`

export async function gerarPedidoPdf(data) {
  validate(data)
  const logo = await logoDataUri()
  return gerarPdfDeHtml({
    html: montarHtmlPedido(data, logo),
    css: CSS,
    seletor: '.ped',
    nome: nomeArquivo(data, 'pdf'),
  })
}

// Exposto no modo dev para testes no navegador
if (import.meta.env.DEV) {
  window.__gerarPedidoPdf = gerarPedidoPdf
}
