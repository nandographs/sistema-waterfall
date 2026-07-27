// Teste da geração do Pedido de Venda (fora do navegador).
// Gera um DOCX de exemplo e valida a estrutura do XML resultante.
// Uso: node scripts/testar-pedido.mjs

import JSZip from 'jszip'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fillDocumentXml, nomeArquivo, validate } from '../src/pedido/fill.js'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const exemplo = {
  pedido_numero: '0007',
  data: '2026-07-25',
  validade_dias: '15',
  status: 'confirmado',
  tipo: 'venda',
  canal: 'whatsapp',
  cliente: 'Maria da Silva & Filhos <Ltda>',
  nome_contato: 'Maria',
  cpf_cnpj: '123.456.789-00',
  rg_inscricao: null,
  data_nascimento: null,
  endereco: 'Rua das Flores',
  numero_complemento: '123, ap. 4',
  cep: '88220-000',
  bairro: 'Centro',
  cidade: 'Itapema',
  uf: 'SC',
  telefone_whatsapp: '(47) 99999-0000',
  email: 'maria@example.com',
  consultor: 'Carla',
  consultor_telefone: '(47) 98888-1111',
  distribuidor: null,
  distribuidor_telefone: null,
  entrega: 'endereco acima',
  entrega_endereco: null,
  entrega_previsao: '30/07/2026',
  itens: [
    {
      descricao: 'IonCenter — purificador',
      quantidade: '1',
      valor_unitario: 'R$ 2.990,00',
      desconto: 'R$ 100,00',
      valor_total: 'R$ 2.890,00',
    },
    {
      descricao: 'Refil IonCenter',
      quantidade: '2',
      valor_unitario: 'R$ 180,00',
      desconto: null,
      valor_total: 'R$ 360,00',
    },
  ],
  subtotal: 'R$ 3.350,00',
  desconto_total: 'R$ 100,00',
  frete: 'R$ 0,00',
  total_pedido: 'R$ 3.250,00',
  pagamento: {
    forma: 'pix',
    condicao: 'parcelado',
    entrada: 'R$ 250,00',
    parcelas: '3',
    primeiro_vencimento: '25/08/2026',
    comprovante_id: null,
    responsavel: 'Maria da Silva',
  },
  observacoes: 'Instalação inclusa. Entrega no período da manhã.',
}

let falhas = 0
const check = (cond, msg) => {
  console.log(`${cond ? 'ok ' : 'FALHOU'} ${msg}`)
  if (!cond) falhas++
}

// 1. Validação deve recusar objetos incompletos
try {
  validate({ pedido_numero: '1' })
  check(false, 'validate recusa objeto incompleto')
} catch {
  check(true, 'validate recusa objeto incompleto')
}
try {
  validate({ ...exemplo, cliente: '' })
  check(false, 'validate recusa string vazia sem "não se aplica"')
} catch {
  check(true, 'validate recusa string vazia sem "não se aplica"')
}
try {
  validate({ ...exemplo, itens: [1, 2, 3, 4, 5].map(() => exemplo.itens[0]) })
  check(false, 'validate recusa mais de 4 itens')
} catch {
  check(true, 'validate recusa mais de 4 itens')
}

// 2. Preencher o modelo real
const zip = await JSZip.loadAsync(await readFile(resolve(raiz, 'src/pedido/reference.docx')))
const original = await zip.file('word/document.xml').async('string')
const preenchido = fillDocumentXml(original, exemplo)

// 3. Estrutura: tags balanceadas e 8 tabelas preservadas
for (const tag of ['w:tbl', 'w:tr', 'w:tc', 'w:p', 'w:r', 'w:t']) {
  const abre = (preenchido.match(new RegExp(`<${tag}(?=[\\s>])`, 'g')) || []).length
  const fecha = (preenchido.match(new RegExp(`</${tag}>`, 'g')) || []).length
  check(abre === fecha, `tags ${tag} balanceadas (${abre}/${fecha})`)
}
check((preenchido.match(/<w:tbl>/g) || []).length === 8, 'mantém 8 tabelas')

// 4. Conteúdo preenchido nas células certas
const contem = (txt) => preenchido.includes(txt)
check(contem('PEDIDO Nº:') && contem('> 0007<'), 'número do pedido')
check(contem('> 25/07/2026<'), 'data formatada DD/MM/AAAA')
check(contem('> 15 dias<'), 'validade em dias')
check(contem('[ ] Proposta  [X] Confirmado'), 'status marcado como confirmado')
check(contem('[X] Venda  [ ] Orçamento'), 'tipo marcado como venda')
check(contem('[X] WhatsApp'), 'canal marcado como WhatsApp')
check(contem('Maria da Silva &amp; Filhos &lt;Ltda&gt;'), 'caracteres especiais escapados')
check(contem('> Carla<'), 'consultor')
check(contem('[X] Entrega no endereço acima'), 'entrega marcada')
// Células da tabela de itens e os totais são escritas sem rótulo, então o
// valor encosta no fim da tag (">valor<"); as com rótulo têm um espaço antes.
check(contem('>IonCenter — purificador<'), 'descrição do item 1')
check(contem('>Refil IonCenter<'), 'descrição do item 2')
check(contem('>R$ 2.890,00<'), 'valor total do item 1')
check(contem('>R$ 3.350,00<'), 'subtotal')
check(contem('>R$ 3.250,00<'), 'total do pedido')
check(contem('[X] PIX'), 'forma de pagamento PIX marcada')
check(contem('[ ] À vista  [X] Parcelado'), 'condição parcelado marcada')
check(contem('> R$ 250,00<'), 'valor de entrada')
check(contem('Instalação inclusa.'), 'observações')
check(!contem('undefined') && !contem('[object'), 'sem vazamentos de undefined/objetos')

// 5. Rótulos preservados em campos "não se aplica"
check(contem('RG / Inscrição estadual:'), 'rótulo RG/IE preservado')
check(contem('Distribuidor / Responsável:'), 'rótulo distribuidor preservado')

// 6. O texto fixo de aceite e as assinaturas não podem ter sido tocados
check(contem('Declaro que conferi os produtos'), 'texto de aceite preservado')
check(contem('Consultor / Vendedor'), 'bloco de assinaturas preservado')

// 7. Nome do arquivo no padrão da skill
const nome = nomeArquivo(exemplo)
check(nome === 'pedido Maria da Silva & Filhos Ltda 25-07-2026.docx', `nome do arquivo: "${nome}"`)

// 8. Gravar o DOCX de exemplo para inspeção manual
zip.file('word/document.xml', preenchido)
const buffer = await zip.generateAsync({ type: 'nodebuffer' })
const saida = resolve(raiz, 'scripts/saida-teste')
await mkdir(saida, { recursive: true })
await writeFile(resolve(saida, nome), buffer)
console.log(`\nDOCX de teste salvo em scripts/saida-teste/${nome}`)

process.exit(falhas ? 1 : 0)
