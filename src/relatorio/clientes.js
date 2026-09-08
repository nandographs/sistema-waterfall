// Relatório da lista de clientes em PDF.
//
// Mesma divisão do relatório financeiro (ver ./html.js): aqui só se MONTA o
// documento em JavaScript puro, e ../documentos/pdf.js rasteriza. A quebra em
// folhas é decidida aqui, por número de linhas, para nunca cortar um cliente ao
// meio.
//
// O relatório sai do que está NA TELA: a mesma busca, os mesmos filtros e a
// mesma ordem. Se a tela diz "12 clientes", o PDF tem 12 — é isso que faz o
// papel valer como conferência.

import { logoDataUri, gerarPdfDePaginas } from '../documentos/pdf.js'
import { esc } from './html.js'
import { dataBR } from '../lib/datas.js'

// Quantas linhas cabem em cada folha. A primeira leva cabeçalho, título e a
// linha dos filtros, então sobra menos espaço.
const LINHAS_PRIMEIRA_FOLHA = 26
const LINHAS_DEMAIS_FOLHAS = 34

export function repartirEmFolhas(linhas, naPrimeira = LINHAS_PRIMEIRA_FOLHA, nasDemais = LINHAS_DEMAIS_FOLHAS) {
  if (linhas.length === 0) return [[]]
  const folhas = [linhas.slice(0, naPrimeira)]
  for (let i = naPrimeira; i < linhas.length; i += nasDemais) {
    folhas.push(linhas.slice(i, i + nasDemais))
  }
  return folhas
}

function linhaCliente(c, i) {
  const local = [c.cidade, c.uf ? String(c.uf).toUpperCase() : ''].filter(Boolean).join('/')
  return `<tr>
    <td class="c cinza">${i}</td>
    <td class="l"><strong>${esc(c.nome)}</strong></td>
    <td class="l">${esc((c.telefones || []).join(' · '))}</td>
    <td class="l">${esc(local)}</td>
    <td class="l cinza">${esc(c.conjugeNome || '')}</td>
    <td class="c cinza">${esc(c.criadoEm ? dataBR(c.criadoEm) : '')}</td>
    <td class="l">${esc((c.situacao || []).join(' · '))}</td>
  </tr>`
}

function cabecalhoFolha(logo, subtitulo) {
  return `<div class="cab">
      <img src="${logo}" alt="Waterfall" />
      <div class="end">Rua 291, 191 | Meia Praia, Itapema - SC &nbsp;&nbsp; WhatsApp: (47) 99186-8646</div>
    </div>
    <h1>Relatório de clientes</h1>
    <div class="sub">${esc(subtitulo)}</div>`
}

// `dados`:
//   clientes: [{ nome, telefones[], cidade, uf, conjugeNome, criadoEm, situacao[] }]
//   filtros:  ['Cidade: Itapema', …]   — o que estava ligado na tela
//   ordem:    'Mais recentes'
//   emitidoEm: ISO
export function montarHtmlClientes(dados, logo = '') {
  const { clientes = [], filtros = [], ordem = '', emitidoEm } = dados

  const total = `${clientes.length} cliente${clientes.length === 1 ? '' : 's'}`
  const subtitulo = filtros.length ? `${total} — ${filtros.join(' · ')}` : `${total} — todos os clientes`

  const cabecalhoTabela = `<tr class="cabecalho">
      <th class="c">#</th><th class="l">Nome</th><th class="l">Telefone</th>
      <th class="l">Cidade/UF</th><th class="l">Cônjuge</th>
      <th class="c">Cadastro</th><th class="l">Situação</th>
    </tr>`

  const folhas = repartirEmFolhas(clientes)
  let numero = 0

  return folhas.map((bloco, i) => {
    const primeira = i === 0
    const corpo = bloco.length
      ? `<table class="mov">${cabecalhoTabela}${bloco.map((c) => linhaCliente(c, ++numero)).join('')}</table>`
      : '<p class="vazio">Nenhum cliente para os filtros escolhidos.</p>'

    return `<div class="pagina">
      ${cabecalhoFolha(logo, primeira ? subtitulo : `${subtitulo} — continuação`)}
      <div class="bloco">
        <h3>Clientes${folhas.length > 1 ? ` (${i + 1} de ${folhas.length})` : ''}${ordem ? ` — ${esc(ordem)}` : ''}</h3>
        ${corpo}
      </div>
      <div class="rodape">Emitido em ${esc(dataBR(emitidoEm))} · Sistema Waterfall</div>
    </div>`
  }).join('')
}

export function cssClientes() {
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
  .cinza{color:#555}
  .bloco{margin-bottom:6mm}
  .vazio{font-size:8.5pt;color:#777;padding:2mm 0}
  .rodape{position:absolute;left:12mm;right:12mm;bottom:6mm;
    font-size:7pt;color:#777;text-align:center;border-top:1px solid #ddd;padding-top:2mm}
  `
}

// "clientes-itapema-08-09-2026.pdf"
export function nomeArquivoClientes(filtros = [], emitidoEm) {
  const limpo = (s) => String(s || '')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase()
  const partes = ['clientes', ...filtros.map(limpo), limpo(dataBR(emitidoEm))].filter(Boolean)
  return partes.join('-') + '.pdf'
}

export async function gerarClientesPdf(dados) {
  if (import.meta.env.DEV) window.__ultimoRelatorioClientes = dados
  const logo = await logoDataUri()
  return gerarPdfDePaginas({
    html: montarHtmlClientes(dados, logo),
    css: cssClientes(),
    seletorPagina: '.pagina',
    nome: nomeArquivoClientes(dados.filtros, dados.emitidoEm),
  })
}
