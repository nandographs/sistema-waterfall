// Geração da proposta comercial em PDF, no navegador.
//
// Mesma técnica da OS e do Pedido: monta o HTML, renderiza num iframe isolado e
// rasteriza. Uma folha só — `gerarPdfDeHtml` encolhe se o conteúdo passar da
// página, o que só acontece com muitos itens (ver MAX_ITENS em ./html.js).

import { logoDataUri, gerarPdfDeHtml } from '../documentos/pdf.js'
import { montarHtmlOrcamento, cssOrcamento, nomeArquivoOrcamento } from './html.js'

export async function gerarOrcamentoPdf(dados) {
  if (!dados?.itens?.length) throw new Error('a proposta precisa de pelo menos um produto')
  const logo = await logoDataUri()
  return gerarPdfDeHtml({
    html: montarHtmlOrcamento(dados, logo),
    css: cssOrcamento(),
    seletor: '.orc',
    nome: nomeArquivoOrcamento(dados),
  })
}

// Exposto no modo dev para inspecionar o documento sem baixar o PDF — mesmo
// recurso do relatório. O PDF é a rasterização exata deste HTML, então ver o
// HTML é ver o PDF.
if (import.meta.env.DEV) {
  window.__gerarOrcamentoPdf = gerarOrcamentoPdf
  window.__previewOrcamento = async (dados = window.__ultimoOrcamento) => {
    const alvo = document.createElement('div')
    alvo.id = 'preview-orcamento'
    alvo.style.cssText = 'position:fixed;inset:0;z-index:99999;overflow:auto;background:#fff'
    alvo.innerHTML = `<style>${cssOrcamento()}</style>` + montarHtmlOrcamento(dados, await logoDataUri())
    document.body.appendChild(alvo)
    return alvo
  }
}
