// O relatório financeiro em HTML, pronto para virar PDF.
//
// Mesma divisão da Ordem de Serviço e do Pedido: aqui só se MONTA o documento,
// em JavaScript puro; quem rasteriza é ../documentos/pdf.js. A vantagem é que o
// conteúdo do relatório é testável no Node, sem navegador — e os números de um
// relatório financeiro são exatamente o tipo de coisa que precisa de teste.
//
// A diferença para os outros dois documentos é o tamanho: OS e Pedido cabem numa
// folha sempre. Um relatório anual pode ter centenas de lançamentos, então este
// arquivo QUEBRA o conteúdo em folhas (`<div class="pagina">`) e o rasterizador
// transforma cada folha numa página. Decidir a quebra aqui, e não fatiando a
// imagem por altura, é o que impede uma linha de ser cortada ao meio.

import { formatBRL, variacao } from '../data/financeiro.js'
import { dataBR } from '../lib/datas.js'

export const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

// Quantas linhas de movimento cabem em cada folha.
//
// A primeira leva o cabeçalho, o resumo e as categorias, então sobra bem menos
// espaço. Os números vieram de medir a folha renderizada, não de estimativa.
const LINHAS_PRIMEIRA_FOLHA = 14
const LINHAS_DEMAIS_FOLHAS = 34

// Reparte uma lista em blocos do tamanho de cada folha.
export function repartirEmFolhas(linhas, naPrimeira = LINHAS_PRIMEIRA_FOLHA, nasDemais = LINHAS_DEMAIS_FOLHAS) {
  const total = linhas.length
  if (total === 0) return [[]]

  const folhas = [linhas.slice(0, naPrimeira)]
  for (let i = naPrimeira; i < total; i += nasDemais) {
    folhas.push(linhas.slice(i, i + nasDemais))
  }
  return folhas
}

// A variação percentual já formatada, com o sinal. Sem base anterior não existe
// percentual — devolve '—', e não um "+100%" que sugeriria um crescimento que
// ninguém pode afirmar.
function variacaoTexto(atual, anterior) {
  const v = variacao(atual, anterior)
  if (v === null) return '—'
  const arredondada = Math.round(v)
  return `${arredondada > 0 ? '+' : ''}${arredondada}%`
}

function linhaResumo({ rotulo, atual, anterior, destaque = false, negativoRuim = false }) {
  const classe = [
    destaque ? 'forte' : '',
    negativoRuim && Number(atual) < 0 ? 'ruim' : '',
    destaque && Number(atual) >= 0 ? 'bom' : '',
  ].filter(Boolean).join(' ')

  return `<tr class="${classe}">
    <td class="l">${esc(rotulo)}</td>
    <td class="n">${esc(formatBRL(atual))}</td>
    <td class="n cinza">${esc(formatBRL(anterior))}</td>
    <td class="n cinza">${esc(variacaoTexto(atual, anterior))}</td>
  </tr>`
}

function tabelaCategorias(titulo, itens, total, nomeCategoria) {
  if (!itens.length) {
    return `<div class="bloco">
      <h3>${esc(titulo)}</h3>
      <p class="vazio">Nada no período.</p>
    </div>`
  }

  const linhas = itens.map(({ categoria, total: valor }) => {
    const fatia = total > 0 ? Math.round((valor / total) * 100) : 0
    return `<tr>
      <td class="l">${esc(nomeCategoria(categoria))}</td>
      <td class="n">${esc(formatBRL(valor))}</td>
      <td class="n cinza">${fatia}%</td>
    </tr>`
  }).join('')

  return `<div class="bloco">
    <h3>${esc(titulo)}</h3>
    <table class="cat">${linhas}</table>
  </div>`
}

function linhaMovimento(l, nomeCategoria, nomeCliente) {
  const quando = l.status === 'realizado' ? l.dataPagamento : l.vencimento
  const sinal = l.tipo === 'entrada' ? '' : '−'
  return `<tr>
    <td class="c">${esc(dataBR(quando))}</td>
    <td class="l">${esc(l.descricao || 'Sem descrição')}</td>
    <td class="l cinza">${esc(nomeCliente(l.clienteId))}</td>
    <td class="l cinza">${esc(nomeCategoria(l.categoria))}</td>
    <td class="n ${l.tipo === 'entrada' ? 'bom' : 'ruim'}">${sinal}${esc(formatBRL(l.valor))}</td>
  </tr>`
}

function cabecalhoFolha(logo, titulo, subtitulo) {
  return `<div class="cab">
      <img src="${logo}" alt="Waterfall" />
      <div class="end">Rua 291, 191 | Meia Praia, Itapema - SC &nbsp;&nbsp; WhatsApp: (47) 99186-8646</div>
    </div>
    <h1>${esc(titulo)}</h1>
    <div class="sub">${esc(subtitulo)}</div>`
}

// Monta o documento inteiro.
//
// `dados`:
//   escala, rotuloPeriodo, emCurso, emitidoEm
//   resumo, resumoAnterior  (saída de resumoDoPeriodo)
//   nomeCategoria(chave) -> rótulo
//   nomeCliente(id)      -> nome ou ''
export function montarHtmlRelatorio(dados, logo = '') {
  const {
    rotuloPeriodo, rotuloEscala, emCurso, emitidoEm,
    resumo, resumoAnterior,
    nomeCategoria = (c) => c,
    nomeCliente = () => '',
  } = dados

  const titulo = 'Relatório financeiro'
  const subtitulo = `${rotuloEscala} — ${rotuloPeriodo}`

  const realizados = resumo.movimentos?.realizados ?? []
  const previstos = resumo.movimentos?.previstos ?? []
  const folhas = repartirEmFolhas(realizados)

  const resumoHtml = `
    <table class="resumo">
      <tr class="cabecalho">
        <th class="l">&nbsp;</th>
        <th class="n">Período</th>
        <th class="n">Anterior</th>
        <th class="n">Variação</th>
      </tr>
      ${linhaResumo({ rotulo: 'Entradas recebidas', atual: resumo.entradas.realizado, anterior: resumoAnterior.entradas.realizado })}
      ${linhaResumo({ rotulo: 'Entradas a receber', atual: resumo.entradas.previsto, anterior: resumoAnterior.entradas.previsto })}
      ${linhaResumo({ rotulo: 'Saídas pagas', atual: resumo.saidas.realizado, anterior: resumoAnterior.saidas.realizado })}
      ${linhaResumo({ rotulo: 'Saídas a pagar', atual: resumo.saidas.previsto, anterior: resumoAnterior.saidas.previsto })}
      ${linhaResumo({ rotulo: 'Resultado do caixa', atual: resumo.resultado, anterior: resumoAnterior.resultado, destaque: true, negativoRuim: true })}
      ${linhaResumo({ rotulo: 'Projetado (com o previsto)', atual: resumo.projetado, anterior: resumoAnterior.projetado, negativoRuim: true })}
    </table>
    <p class="nota">
      <strong>Resultado</strong> é o dinheiro que de fato se moveu no período, pela data de pagamento.
      <strong>Projetado</strong> é como o período termina se tudo que está previsto se confirmar.
    </p>`

  const categoriasHtml = `<div class="colunas">
      ${tabelaCategorias('Saídas por categoria', resumo.categorias.saidas, resumo.saidas.realizado, nomeCategoria)}
      ${tabelaCategorias('Entradas por categoria', resumo.categorias.entradas, resumo.entradas.realizado, nomeCategoria)}
    </div>`

  const cabecalhoMovimentos = `<tr class="cabecalho">
      <th class="c">Data</th><th class="l">Descrição</th>
      <th class="l">Cliente</th><th class="l">Categoria</th><th class="n">Valor</th>
    </tr>`

  const paginas = folhas.map((bloco, i) => {
    const primeira = i === 0
    const corpo = bloco.length
      ? `<table class="mov">${cabecalhoMovimentos}${bloco.map((l) => linhaMovimento(l, nomeCategoria, nomeCliente)).join('')}</table>`
      : '<p class="vazio">Nenhuma movimentação realizada no período.</p>'

    return `<div class="pagina">
      ${cabecalhoFolha(logo, titulo, primeira ? subtitulo : `${subtitulo} — continuação`)}
      ${primeira ? resumoHtml + categoriasHtml : ''}
      <div class="bloco">
        <h3>Movimentações realizadas${folhas.length > 1 ? ` (${i + 1} de ${folhas.length})` : ''}</h3>
        ${corpo}
      </div>
      ${primeira && emCurso ? '<p class="aviso">Período ainda em curso — os números podem mudar até o fechamento.</p>' : ''}
      <div class="rodape">Emitido em ${esc(dataBR(emitidoEm))} · Sistema Waterfall</div>
    </div>`
  })

  // O que está em aberto vai numa folha própria, e só quando existe: é outra
  // pergunta ("o que ainda falta entrar/sair"), e misturá-la com o que já
  // aconteceu é como um relatório passa a ser lido errado.
  if (previstos.length) {
    const blocos = repartirEmFolhas(previstos, LINHAS_DEMAIS_FOLHAS, LINHAS_DEMAIS_FOLHAS)
    blocos.forEach((bloco, i) => {
      paginas.push(`<div class="pagina">
        ${cabecalhoFolha(logo, titulo, `${subtitulo} — em aberto`)}
        <div class="bloco">
          <h3>Em aberto no período${blocos.length > 1 ? ` (${i + 1} de ${blocos.length})` : ''}</h3>
          <table class="mov">${cabecalhoMovimentos}${bloco.map((l) => linhaMovimento(l, nomeCategoria, nomeCliente)).join('')}</table>
        </div>
        <div class="rodape">Emitido em ${esc(dataBR(emitidoEm))} · Sistema Waterfall</div>
      </div>`)
    })
  }

  return paginas.join('')
}

export function cssRelatorio() {
  return `
  .pagina{width:210mm;min-height:297mm;padding:12mm 12mm 10mm;box-sizing:border-box;
    font-family:Arial,Helvetica,sans-serif;color:#111;background:#fff;position:relative}
  .cab{text-align:center;border-bottom:2px solid #111;padding-bottom:4mm;margin-bottom:5mm}
  .cab img{height:14mm;object-fit:contain}
  .cab .end{font-size:7.5pt;color:#444;margin-top:1.5mm}
  h1{font-size:15pt;text-align:center;letter-spacing:.5px}
  .sub{font-size:9.5pt;text-align:center;color:#444;margin:1.5mm 0 6mm}
  h3{font-size:9.5pt;margin:0 0 2mm;padding-bottom:1mm;border-bottom:1px solid #bbb}
  table{width:100%;border-collapse:collapse;font-size:8.5pt}
  th{font-weight:bold;font-size:8pt;color:#333}
  td,th{padding:1.4mm 1.5mm;border-bottom:1px solid #e2e2e2;vertical-align:top}
  .cabecalho th{border-bottom:1.5px solid #888}
  .l{text-align:left}.c{text-align:center;white-space:nowrap}
  .n{text-align:right;white-space:nowrap}
  .cinza{color:#555}
  .bom{color:#0a6b3d}.ruim{color:#a11}
  .forte td{font-weight:bold;font-size:9.5pt;border-top:1.5px solid #888}
  .resumo{margin-bottom:2mm}
  .nota{font-size:7.5pt;color:#555;margin-bottom:6mm;line-height:1.4}
  .colunas{display:flex;gap:6mm;margin-bottom:6mm}
  .colunas .bloco{flex:1}
  .bloco{margin-bottom:6mm}
  .cat td{padding:1.2mm 1.5mm}
  .vazio{font-size:8.5pt;color:#777;padding:2mm 0}
  .aviso{font-size:8pt;color:#8a6100;background:#fff6e0;border:1px solid #f0d79a;
    padding:2mm 3mm;border-radius:1.5mm;margin-bottom:4mm}
  .rodape{position:absolute;left:12mm;right:12mm;bottom:6mm;
    font-size:7pt;color:#777;text-align:center;border-top:1px solid #ddd;padding-top:2mm}
  `
}

// "relatorio financeiro mensal agosto-de-2026.pdf"
export function nomeArquivoRelatorio(rotuloEscala, rotuloPeriodo) {
  const limpo = (s) => String(s || '')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase()
  return `relatorio-financeiro-${limpo(rotuloEscala)}-${limpo(rotuloPeriodo)}.pdf`
}
