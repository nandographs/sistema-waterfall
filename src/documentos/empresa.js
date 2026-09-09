// Os dados da Waterfall que aparecem no cabeçalho dos documentos.
//
// Existe porque este endereço estava copiado em cinco arquivos (OS, pedido,
// orçamento e os dois relatórios) e saiu errado nos cinco ao mesmo tempo: era
// "Rua 291" no lugar de "Rua 295". Corrigir em cinco lugares é corrigir em
// quatro e esquecer o quinto — e o esquecido é justo o documento que só se
// imprime uma vez por mês, então o erro volta sem ninguém notar.
//
// Só o HTML mora aqui. O cabeçalho dos .docx vem do reference.docx de cada
// documento (é modelo do Word, não HTML), então uma mudança de endereço precisa
// ser feita nos dois lugares — não há como o Word ler esta constante.

export const ENDERECO = 'Rua 295, 191 | Meia Praia, Itapema - SC'
export const WHATSAPP = 'WhatsApp: (47) 99186-8646'
export const SITE = 'www.waterfall.ind.br'
export const INSTAGRAM = '@waterfallcompanybr'

// O cabeçalho pronto. `espaco` é o afastamento entre as duas colunas de cada
// linha: os formulários (OS/pedido) usam quatro espaços, os relatórios dois.
export function cabecalhoEmpresa(logo, { espaco = 4, comRedes = true } = {}) {
  const gap = '&nbsp;'.repeat(espaco)
  return `<img src="${logo}" alt="Waterfall" />
      <div class="end">${ENDERECO} ${gap} ${WHATSAPP}</div>` +
    (comRedes ? `\n      <div class="end">${SITE} ${gap} ${INSTAGRAM}</div>` : '')
}
