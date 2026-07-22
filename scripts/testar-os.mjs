// Teste da geração de Ordem de Serviço (fora do navegador).
// Gera um DOCX de exemplo e valida a estrutura do XML resultante.
// Uso: node scripts/testar-os.mjs

import JSZip from 'jszip'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fillDocumentXml, nomeArquivo, validate } from '../src/os/fill.js'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const exemplo = {
  os_numero: '0001',
  data: '2026-07-25',
  hora: '14:30',
  status: 'aberta',
  tipo_atendimento: 'instalacao',
  cliente: 'Maria da Silva & Filhos <Ltda>',
  autorizado_por: 'Maria da Silva',
  cpf_cnpj: '123.456.789-00',
  telefone_whatsapp: '(47) 99999-0000',
  email: 'maria@example.com',
  endereco: 'Rua das Flores',
  numero_complemento: '123, ap. 4',
  cep: '88220-000',
  bairro: 'Centro',
  cidade: 'Itapema',
  uf: 'SC',
  atendente: 'Carla',
  tecnico: 'João',
  agendado_para: '25/07/2026 14:30',
  previsao_conclusao: null,
  equipamento_modelo: 'IonCenter',
  numero_serie: 'WF-2026-001',
  defeito_relatado: null,
  diagnostico_tecnico: null,
  servico_executado: 'Instalação com teste de vazão.',
  itens: [
    {
      descricao: 'IonCenter',
      quantidade: '1',
      valor_unitario: 'R$ 2.990,00',
      desconto: null,
      valor_total: 'R$ 2.990,00',
      garantia_validade: '12 meses',
    },
  ],
  total_ordem: 'R$ 2.990,00',
  pagamento: {
    forma: 'pix',
    condicao: 'a vista',
    parcelas: null,
    primeiro_vencimento: null,
    valor_total: 'R$ 2.990,00',
    comprovante_id: null,
    responsavel: 'Maria da Silva',
  },
}

let falhas = 0
const check = (cond, msg) => {
  console.log(`${cond ? 'ok ' : 'FALHOU'} ${msg}`)
  if (!cond) falhas++
}

// 1. Validação deve recusar objetos incompletos
try {
  validate({ os_numero: '1' })
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

// 2. Preencher o modelo real
const zip = await JSZip.loadAsync(await readFile(resolve(raiz, 'src/os/reference.docx')))
const original = await zip.file('word/document.xml').async('string')
const preenchido = fillDocumentXml(original, exemplo)

// 3. Estrutura: tags balanceadas e 7 tabelas preservadas
for (const tag of ['w:tbl', 'w:tr', 'w:tc', 'w:p', 'w:r', 'w:t']) {
  const abre = (preenchido.match(new RegExp(`<${tag}(?=[\\s>])`, 'g')) || []).length
  const fecha = (preenchido.match(new RegExp(`</${tag}>`, 'g')) || []).length
  check(abre === fecha, `tags ${tag} balanceadas (${abre}/${fecha})`)
}
check((preenchido.match(/<w:tbl>/g) || []).length === 7, 'mantém 7 tabelas')

// 4. Conteúdo preenchido nas células certas
const contem = (txt) => preenchido.includes(txt)
check(contem('OS Nº:') && contem('> 0001<'), 'número da OS')
check(contem('> 25/07/2026<'), 'data formatada DD/MM/AAAA')
check(contem('[X] Aberta  [ ] Concluída'), 'status marcado como aberta')
check(contem('[X] Instalação  [ ] Manutenção'), 'tipo de atendimento marcado')
check(contem('Maria da Silva &amp; Filhos &lt;Ltda&gt;'), 'caracteres especiais escapados')
check(contem('> João<'), 'técnico')
check(contem('> IonCenter<'), 'equipamento e item')
check(contem('> R$ 2.990,00<'), 'valores monetários')
check(contem('[X] PIX'), 'forma de pagamento PIX marcada')
check(contem('[X] À vista  [ ] Parcelado'), 'condição à vista marcada')
check(!contem('undefined') && !contem('[object'), 'sem vazamentos de undefined/objetos')

// 5. Campos null ficam com o rótulo sem valor (célula existe, sem texto extra)
check(contem('CPF/CNPJ:'), 'rótulo CPF/CNPJ preservado')
check(contem('Previsão de conclusão:'), 'rótulo previsão preservado')

// 6. Nome do arquivo no padrão da skill
const nome = nomeArquivo(exemplo)
check(nome === 'ordem Maria da Silva & Filhos Ltda 25-07-2026.docx', `nome do arquivo: "${nome}"`)

// 7. Gravar o DOCX de exemplo para inspeção manual
zip.file('word/document.xml', preenchido)
const buffer = await zip.generateAsync({ type: 'nodebuffer' })
const saida = resolve(raiz, 'scripts/saida-teste')
await mkdir(saida, { recursive: true })
await writeFile(resolve(saida, nome), buffer)
console.log(`\nDOCX de teste salvo em scripts/saida-teste/${nome}`)

process.exit(falhas ? 1 : 0)
