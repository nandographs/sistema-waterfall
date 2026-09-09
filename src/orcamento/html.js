// A proposta comercial (orçamento) em HTML, pronta para virar PDF.
//
// Mesma divisão da OS, do Pedido e do relatório: aqui só se MONTA o documento,
// em JavaScript puro; quem rasteriza é ../documentos/pdf.js. Assim o conteúdo —
// que é onde moram os valores que o cliente vai ler — é testável no Node.
//
// Por que não reusar o modelo do Pedido: aquele é o formulário de fechamento,
// com pagamento, entrega, aceite e três assinaturas. A proposta é o passo ANTES
// disso, e campos de pagamento em branco numa folha entregue ao cliente parecem
// pendência, não proposta. Esta folha mostra só o que se está propondo:
// produtos, valores, validade e condições.

import { formatBRL } from '../data/financeiro.js'
import { dataBR, somarDias } from '../lib/datas.js'
import { cabecalhoEmpresa } from '../documentos/empresa.js'

export const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

// Quantos itens cabem na folha sem empurrar o rodapé para fora.
//
// Medido na folha renderizada, não estimado. Passando disso o rasterizador
// encolhe a página inteira para caber, e uma proposta em letra miúda é uma
// proposta que não se lê.
export const MAX_ITENS = 12

// Até quando a proposta vale. É o dado que faz a proposta ter efeito: sem data
// de fim, o cliente volta em março com o preço de janeiro.
export function validaAte(data, dias) {
  const n = Number(dias || 0)
  if (!data || !Number.isFinite(n) || n <= 0) return ''
  return somarDias(data, n)
}

export function nomeArquivoOrcamento({ data, cliente }) {
  const quando = String(data || '').slice(0, 10).split('-').reverse().join('-')
  const nome = String(cliente?.nome || '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim() || 'sem cliente'
  return `orcamento ${nome} ${quando}.pdf`
}

// Traduz uma venda do sistema (tipo "orcamento") para os dados do documento.
//
// Existe para que a folha saia igual venha ela do modal de criação ou do botão
// "Baixar proposta" da lista: um só lugar decide o que é o documento, e não dois
// que divergem no primeiro ajuste.
export function montarDadosOrcamento(venda, cliente, itens) {
  return {
    numero: venda.numero || '',
    data: venda.data || '',
    validadeDias: venda.validadeDias,
    cliente: {
      nome: cliente?.nome || '',
      cpfCnpj: cliente?.cpfCnpj || '',
      endereco: cliente?.endereco || '',
      numeroComplemento: cliente?.numeroComplemento || '',
      bairro: cliente?.bairro || '',
      cidade: cliente?.cidade || '',
      uf: cliente?.uf || '',
      telefone: cliente?.telefone || '',
      email: cliente?.email || '',
    },
    itens: (itens || []).map((i) => ({
      descricao: i.descricao,
      quantidade: Number(i.quantidade || 1),
      valorUnitario: Number(i.valorUnitario || 0),
      desconto: Number(i.desconto || 0),
      valorTotal: Number(i.valorTotal || 0),
    })),
    subtotal: Number(venda.subtotal || 0),
    desconto: Number(venda.desconto || 0),
    frete: Number(venda.frete || 0),
    total: Number(venda.total || 0),
    condicoes: venda.observacoes || '',
    consultor: { nome: venda.consultor || '', telefone: venda.consultorTelefone || '' },
  }
}

// Quantidade e valores alinhados à direita porque é assim que se confere uma
// coluna de dinheiro: pelas casas, não pelo começo do número.
const linhaItem = (item) => `<tr>
  <td class="desc">${esc(item.descricao)}</td>
  <td class="c">${esc(Number(item.quantidade || 1))}</td>
  <td class="r">${esc(formatBRL(item.valorUnitario))}</td>
  <td class="r">${Number(item.desconto) > 0 ? '- ' + esc(formatBRL(item.desconto)) : '—'}</td>
  <td class="r forte">${esc(formatBRL(item.valorTotal))}</td>
</tr>`

const linhaTotal = (rotulo, valor, classe = '') => `<tr class="${classe}">
  <td colspan="4" class="r rot">${esc(rotulo)}</td>
  <td class="r">${esc(formatBRL(valor))}</td>
</tr>`

export function montarHtmlOrcamento(dados, logo) {
  const c = dados.cliente || {}
  const itens = (dados.itens || []).slice(0, MAX_ITENS)
  const ate = validaAte(dados.data, dados.validadeDias)

  // Só junta o que existe: "Itapema /" solto no documento denuncia campo vazio.
  const cidadeUf = [c.cidade, c.uf].filter(Boolean).join(' / ')
  const local = [c.endereco, c.numeroComplemento, c.bairro].filter(Boolean).join(', ')

  return `<div class="orc">
    <div class="cab">
      ${cabecalhoEmpresa(logo)}
    </div>

    <div class="titulo">
      <h1>Proposta comercial</h1>
      <div class="meta">
        ${dados.numero ? `<span><b>Nº</b> ${esc(dados.numero)}</span>` : ''}
        <span><b>Data</b> ${esc(dataBR(dados.data))}</span>
        ${ate ? `<span><b>Válida até</b> ${esc(dataBR(ate))}</span>` : ''}
      </div>
    </div>

    <div class="banda">Cliente</div>
    <table class="dados">
      <tr>
        <td colspan="3"><span class="lbl">Nome</span>${esc(c.nome || '—')}</td>
        <td><span class="lbl">CPF / CNPJ</span>${esc(c.cpfCnpj || '—')}</td>
      </tr>
      <tr>
        <td colspan="2"><span class="lbl">Endereço</span>${esc(local || '—')}</td>
        <td><span class="lbl">Cidade / UF</span>${esc(cidadeUf || '—')}</td>
        <td><span class="lbl">Telefone</span>${esc(c.telefone || '—')}</td>
      </tr>
      ${c.email ? `<tr><td colspan="4"><span class="lbl">E-mail</span>${esc(c.email)}</td></tr>` : ''}
    </table>

    <div class="banda">Proposta</div>
    <table class="itens">
      <tr class="cab-itens">
        <td class="desc">Produto</td>
        <td class="c">Qtd.</td>
        <td class="r">Valor un.</td>
        <td class="r">Desconto</td>
        <td class="r">Total</td>
      </tr>
      ${itens.map(linhaItem).join('')}
      ${linhaTotal('Subtotal', dados.subtotal)}
      ${Number(dados.desconto) > 0 ? linhaTotal('Desconto', -Number(dados.desconto)) : ''}
      ${Number(dados.frete) > 0 ? linhaTotal('Frete', dados.frete) : ''}
      ${linhaTotal('Total da proposta', dados.total, 'total-final')}
    </table>

    <div class="banda">Condições</div>
    <div class="condicoes">${esc(dados.condicoes || '') || '&nbsp;'}</div>

    <p class="nota">
      ${ate
        ? `Valores válidos até ${esc(dataBR(ate))}; depois dessa data a proposta precisa ser reconfirmada.`
        : 'Valores sujeitos a confirmação no fechamento do pedido.'}
      Esta proposta não gera cobrança: a venda só existe com o pedido fechado.
    </p>

    <table class="assin">
      <tr>
        <td>________________________________<br>${esc(dados.consultor?.nome || 'Consultor Waterfall')}${
          dados.consultor?.telefone ? `<br>${esc(dados.consultor.telefone)}` : ''}</td>
        <td>________________________________<br>De acordo — ${esc(c.nome || 'Cliente')}<br>Data: ___/___/_____</td>
      </tr>
    </table>
  </div>`
}

// Fora do padrão dos formulários (OS/Pedido) de propósito: proposta é peça de
// venda, não formulário — menos grade preta, mais respiro e hierarquia. Cores
// em hex porque o html2canvas não entende o oklch() do Tailwind.
export function cssOrcamento() {
  return `
  .orc { width: 210mm; box-sizing: border-box; padding: 10mm 13mm 8mm;
         background: #fff; color: #111; font-family: Arial, Helvetica, sans-serif;
         font-size: 9pt; line-height: 1.4; }
  .orc * { box-sizing: border-box; }
  .orc .cab { text-align: center; padding-bottom: 7px; border-bottom: 2px solid #111; }
  .orc .cab img { height: 15mm; width: auto; margin-bottom: 5px; }
  .orc .cab .end { font-size: 8pt; color: #444; line-height: 1.5; }

  .orc .titulo { display: flex; align-items: flex-end; justify-content: space-between;
                 margin: 12px 0 14px; }
  .orc .titulo h1 { font-size: 16pt; letter-spacing: .5px; text-transform: uppercase; }
  .orc .titulo .meta { font-size: 8.5pt; color: #333; text-align: right; }
  .orc .titulo .meta span { display: inline-block; margin-left: 14px; }
  .orc .titulo .meta b { font-weight: bold; color: #111; }

  .orc .banda { background: #111; color: #fff; font-weight: bold; font-size: 8.5pt;
                letter-spacing: .6px; text-transform: uppercase; padding: 4px 8px;
                margin-top: 12px; }
  .orc table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .orc td { border: 1px solid #CFCFCF; padding: 5px 8px; vertical-align: middle;
            word-wrap: break-word; overflow-wrap: break-word; }
  .orc .lbl { display: block; font-size: 7pt; text-transform: uppercase;
              letter-spacing: .4px; color: #777; }
  .orc .dados td { height: 30px; }

  .orc .itens .cab-itens td { background: #F2F2F2; font-weight: bold; height: 24px; }
  .orc .itens td { height: 26px; }
  .orc .itens .desc { width: 46%; text-align: left; }
  .orc .itens .c { text-align: center; }
  .orc .itens .r { text-align: right; }
  .orc .itens .forte { font-weight: bold; }
  .orc .itens .rot { font-weight: bold; color: #444; }
  .orc .itens .total-final td { background: #F2F2F2; font-size: 11pt; font-weight: bold;
                                color: #111; height: 32px; }

  .orc .condicoes { border: 1px solid #CFCFCF; border-top: none; padding: 7px 8px;
                    min-height: 46px; white-space: pre-wrap; }
  .orc .nota { font-size: 7.5pt; color: #555; margin-top: 10px; line-height: 1.5; }
  .orc .assin { margin-top: 22px; }
  .orc .assin td { border: none; text-align: center; padding-top: 12px; line-height: 1.7;
                   font-size: 8.5pt; }
`
}
