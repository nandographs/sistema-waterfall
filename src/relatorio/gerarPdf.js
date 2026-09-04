// Geração do relatório financeiro em PDF, no navegador.
//
// Mesma técnica da OS e do Pedido: monta o HTML, renderiza num iframe isolado e
// rasteriza. A diferença é o número de páginas — `gerarPdfDePaginas` transforma
// cada `<div class="pagina">` numa folha do PDF, porque um relatório anual não
// cabe numa página só.

import { logoDataUri, gerarPdfDePaginas } from '../documentos/pdf.js'
import { montarHtmlRelatorio, cssRelatorio, nomeArquivoRelatorio } from './html.js'

export async function gerarRelatorioPdf(dados) {
  if (import.meta.env.DEV) window.__ultimoRelatorio = dados
  const logo = await logoDataUri()
  return gerarPdfDePaginas({
    html: montarHtmlRelatorio(dados, logo),
    css: cssRelatorio(),
    seletorPagina: '.pagina',
    nome: nomeArquivoRelatorio(dados.rotuloEscala, dados.rotuloPeriodo),
  })
}

// Exposto no modo dev para permitir inspecionar o documento sem baixar o PDF —
// mesmo recurso que ../pedido/gerar.js usa. O PDF é a rasterização exata deste
// HTML, então ver o HTML é ver o PDF.
if (import.meta.env.DEV) {
  // Sem argumento, mostra o último relatório gerado pelo botão da tela.
  window.__previewRelatorio = async (dados = window.__ultimoRelatorio) => {
    const { montarHtmlRelatorio: montar, cssRelatorio: css } = await import('./html.js')
    const { logoDataUri: logo } = await import('../documentos/pdf.js')
    const alvo = document.createElement('div')
    alvo.id = 'preview-relatorio'
    alvo.style.cssText = 'position:fixed;inset:0;z-index:99999;overflow:auto;background:#fff'
    alvo.innerHTML = `<style>${css()}</style>` + montar(dados, await logo())
    document.body.appendChild(alvo)
    return alvo.querySelectorAll('.pagina').length
  }
}
