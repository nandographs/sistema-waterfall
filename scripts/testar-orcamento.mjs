// Teste da proposta comercial (src/orcamento/html.js).
// Não toca no banco nem no navegador. Uso: node scripts/testar-orcamento.mjs
//
// O que este arquivo protege: a proposta é o papel que vai para a mão do
// cliente, e o preço nela vira compromisso. Um total errado não volta como bug —
// volta como discussão no fechamento. Por isso o teste é do CONTEÚDO (valores,
// validade e escape), não de layout.

import {
  montarHtmlOrcamento, montarDadosOrcamento, nomeArquivoOrcamento, validaAte, esc,
} from '../src/orcamento/html.js'
import { ENDERECO } from '../src/documentos/empresa.js'
import { totaisDaVenda, formatBRL } from '../src/data/financeiro.js'

let falhas = 0
const check = (cond, msg) => {
  console.log(`${cond ? 'ok ' : 'FALHOU'} ${msg}`)
  if (!cond) falhas++
}
const eq = (a, b, msg) => check(a === b, `${msg}${a === b ? '' : ` — esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`}`)

const cliente = {
  nome: 'Maria & Filhos <Ltda>',
  cpfCnpj: '12.345.678/0001-90',
  endereco: 'Rua das Flores', numeroComplemento: '191', bairro: 'Meia Praia',
  cidade: 'Itapema', uf: 'SC', telefone: '(47) 99186-8646', email: 'maria@exemplo.com',
}

const itens = [
  { descricao: 'Purificador WF-100', quantidade: 1, valorUnitario: 1200, desconto: 0, valorTotal: 1200 },
  { descricao: 'Refil WF-100', quantidade: 2, valorUnitario: 150, desconto: 50, valorTotal: 250 },
]

// Os totais saem da MESMA função que grava a venda — se um dia o cálculo mudar,
// o documento muda junto e este teste acompanha.
const { subtotal, total } = totaisDaVenda(itens, 100, 0)
const venda = {
  numero: '0042', data: '2026-09-09', validadeDias: 15,
  subtotal, desconto: 100, frete: 0, total,
  observacoes: 'Instalação inclusa.',
  consultor: 'Fernando', consultorTelefone: '(47) 90000-0000',
}

console.log('--- totais e validade ---')
eq(subtotal, 1450, 'subtotal soma os itens já com o desconto de linha')
eq(total, 1350, 'total desconta os R$ 100 da proposta')
eq(validaAte('2026-09-09', 15), '2026-09-24', 'validade de 15 dias cai em 24/09')
eq(validaAte('2026-09-09', 0), '', 'sem prazo não inventa data de validade')
eq(validaAte('', 15), '', 'sem data da proposta não há data de validade')

console.log('--- dados montados a partir da venda ---')
const dados = montarDadosOrcamento(venda, cliente, itens)
eq(dados.total, 1350, 'o total do documento é o total gravado')
eq(dados.cliente.cidade, 'Itapema', 'cidade vem do cadastro do cliente')
eq(dados.itens.length, 2, 'os dois itens entram na proposta')
eq(dados.condicoes, 'Instalação inclusa.', 'as observações da venda são as condições da proposta')
eq(montarDadosOrcamento({}, null, null).total, 0, 'venda vazia não quebra a montagem')

console.log('--- HTML do documento ---')
const html = montarHtmlOrcamento(dados, 'data:image/png;base64,LOGO')
// Comparado via formatBRL, e não com a string escrita à mão: o Intl separa
// "R$" do número com espaço NÃO quebrável, e um teste com espaço comum falharia
// por um caractere invisível.
check(html.includes(formatBRL(1350)), 'o total aparece no documento')
check(html.includes(formatBRL(1450)), 'o subtotal aparece no documento')
check(html.includes('24/09/2026'), 'a data de validade aparece no documento')
check(html.includes('Purificador WF-100'), 'o produto aparece no documento')
check(html.includes('Instalação inclusa.'), 'as condições aparecem no documento')
// O endereço da empresa já saiu errado em cinco documentos de uma vez ("Rua 291"
// em vez de "Rua 295"). Agora é uma constante só — este teste é o alarme caso
// alguém volte a escrever o cabeçalho à mão aqui dentro.
check(html.includes(ENDERECO), 'o cabeçalho traz o endereço da empresa')
check(!html.includes('Rua 291'), 'o endereço antigo e errado não voltou')
check(!html.includes('<Ltda>'), 'o nome do cliente é escapado (não injeta HTML)')
check(html.includes('Maria &amp; Filhos &lt;Ltda&gt;'), 'o nome escapado aparece legível')
eq(esc('a & <b>'), 'a &amp; &lt;b&gt;', 'esc trata & e sinais de tag')

// Sem frete e sem desconto o documento não mostra linhas zeradas: "Frete R$ 0,00"
// numa proposta faz o cliente perguntar por um frete que não existe.
const semExtras = montarHtmlOrcamento(
  montarDadosOrcamento({ ...venda, desconto: 0, frete: 0, total: subtotal }, cliente, itens),
  'x',
)
check(!semExtras.includes('Frete'), 'sem frete, a linha de frete não aparece')
// Pelo rótulo da LINHA de total: a palavra "Desconto" também é cabeçalho de
// coluna dos itens, e procurá-la solta acusaria falso.
check(!semExtras.includes('rot">Desconto'), 'sem desconto na proposta, a linha de total não aparece')

console.log('--- nome do arquivo ---')
eq(
  nomeArquivoOrcamento(dados),
  'orcamento Maria & Filhos Ltda 09-09-2026.pdf',
  'nome traz cliente e data, sem caracteres proibidos no Windows',
)
eq(
  nomeArquivoOrcamento({ data: '2026-01-02', cliente: {} }),
  'orcamento sem cliente 02-01-2026.pdf',
  'sem cliente o arquivo ainda tem nome utilizável',
)

console.log(falhas === 0 ? '\nTudo certo.' : `\n${falhas} falha(s).`)
process.exit(falhas === 0 ? 0 : 1)
