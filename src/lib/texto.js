// Comparação de texto para busca.
//
// Sem dependências, para poder ser testado direto no Node.

// Texto pronto para comparar: sem acento, sem caixa, sem espaço nas pontas.
//
// Existe porque numa base de centenas de nomes ninguém acerta o acento na
// primeira: quem procura "chapeco" espera achar Chapecó, e quem digita "joao"
// espera achar João. Uma busca que exige o acento certo é uma busca que não se
// usa — e o efeito prático é a pessoa concluir que o cliente não está cadastrado.
//
// NFD separa o acento da letra; \p{Diacritic} então descarta só o acento,
// preservando o ç -> c e o ñ -> n.
export const semAcento = (texto) =>
  String(texto ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()

// O termo digitado aparece em algum dos campos? Campo vazio ou nulo é ignorado.
// Termo vazio casa com tudo — é o estado "não filtrei nada ainda".
export function combina(termo, ...campos) {
  const alvo = semAcento(termo)
  if (!alvo) return true
  return campos.some((campo) => semAcento(campo).includes(alvo))
}

// Cada PALAVRA digitada aparece em algum dos campos, em qualquer ordem.
//
// É o que faz "maria silva" achar "Maria da Silva" e "torneira branca" achar a
// torneira de cor branca: comparar o texto inteiro exigiria digitar o nome
// exatamente como foi cadastrado, com o "da" no meio.
export function casaPalavras(termo, ...campos) {
  const palavras = semAcento(termo).split(/\s+/).filter(Boolean)
  if (!palavras.length) return true
  const alvo = campos.map(semAcento).filter(Boolean).join(' ')
  return palavras.every((p) => alvo.includes(p))
}

// ---- Busca das listas ----
//
// Cada tela tinha a sua própria busca, e elas discordavam: uma exigia acento,
// outra só achava o texto inteiro colado, outra não achava telefone digitado
// sem a máscara. Aqui fica a regra única. Duas metades:
//
//   indexarBusca   — o que cada item oferece, montado UMA vez quando os dados
//                    mudam (não a cada tecla: com 2.600 clientes, refazer o
//                    texto de todos por letra digitada é o que engasgava).
//   prepararBusca  — o que foi digitado, lido UMA vez por tecla.
//   pontuarBusca   — compara as duas: -1 quando não casa, senão a relevância
//                    (0 é o melhor), para quem quiser ordenar por ela.

const soDigitosDe = (texto) => String(texto ?? '').replace(/\D+/g, '')

// "silva," e "(maria)" viram "silva" e "maria". Pontuação no meio fica
// ("1.500,00", "d'avila"): é parte do que está cadastrado.
const semPontas = (palavra) => palavra.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')

// `principal` é o que dá nome ao item (nome do cliente, do produto): é por ele
// que a relevância é medida. `outros` entram na busca sem pesar na ordem.
// `numeros` são telefones e afins, comparados só pelos dígitos — é o que faz
// "47991234" achar "(47) 99123-4567".
export function indexarBusca({ principal = '', outros = [], numeros = [] } = {}) {
  const p = semAcento(principal)
  return {
    principal: p,
    texto: [p, ...outros.map(semAcento)].filter(Boolean).join(' \u0001 '),
    // Separados por espaço: uma sequência digitada não pode começar no fim de
    // um telefone e terminar no começo do outro.
    digitos: numeros.map(soDigitosDe).filter(Boolean).join(' '),
  }
}

export function prepararBusca(termo) {
  const texto = semAcento(termo)
  const palavras = texto.split(/\s+/).map(semPontas).filter(Boolean)
  let digitos = soDigitosDe(termo)
  // Colou o número do WhatsApp com o 55 na frente: o cadastro não tem o DDI.
  if (digitos.length >= 12 && digitos.startsWith('55')) digitos = digitos.slice(2)
  return {
    texto: palavras.join(' '),
    palavras,
    digitos,
    // Só máscara de telefone e dígitos: "(47) 9912-3" é UM número, não três
    // palavras soltas.
    telefone: /^[\d\s()+.\-/]+$/.test(texto) && digitos.length >= 3,
    vazia: palavras.length === 0,
  }
}

// -1 = não casa. Senão, quanto menor melhor:
//   0  o nome começa com tudo o que foi digitado     ("maria da" → MARIA DA SILVA)
//   1  o nome começa com a primeira palavra          ("maria silva" → MARIA CARMEM DA SILVA)
//   2  outra palavra do nome começa com ela          ("maria silva" → ADRIANE MARIA DA SILVA)
//   3  todas as palavras estão no nome, no meio
//   4  casou por outro campo (cidade, cônjuge, telefone…)
export function pontuarBusca(consulta, indice) {
  if (!consulta || consulta.vazia) return 0
  if (!indice) return -1

  if (consulta.telefone) {
    if (indice.digitos.includes(consulta.digitos)) return 4
    // Número que não é telefone: código do produto, nº do pedido, valor.
    return indice.texto.includes(consulta.texto) ? 4 : -1
  }

  // Cada palavra em qualquer campo, em qualquer ordem: "maria silva" acha
  // "Maria da Silva", "maria 9912" acha a Maria daquele telefone.
  for (const palavra of consulta.palavras) {
    if (indice.texto.includes(palavra)) continue
    const d = soDigitosDe(palavra)
    if (d.length >= 2 && d.length === palavra.replace(/[^\p{L}\p{N}]/gu, '').length && indice.digitos.includes(d)) continue
    return -1
  }

  const nome = indice.principal
  if (!nome) return 4
  const emTodas = consulta.palavras.every((p) => nome.includes(p))
  if (nome.startsWith(consulta.texto)) return 0
  // Só conta se o resto também está no nome: "maria pato branco" não deve
  // pôr a Maria de Chapecó no topo só porque ela se chama Maria.
  if (emTodas && nome.startsWith(consulta.palavras[0])) return 1
  if (emTodas && (' ' + nome).includes(' ' + consulta.palavras[0])) return 2
  if (emTodas) return 3
  return 4
}

// Filtra e, se pedido, ordena pela relevância — empate fica na ordem que a
// lista já tinha (o sort do JS é estável), então "mais recentes" continua
// valendo dentro de cada faixa.
export function filtrarPorBusca(itens, consulta, indiceDe, { porRelevancia = false } = {}) {
  if (!consulta || consulta.vazia) return itens
  const casam = []
  for (const item of itens) {
    const nota = pontuarBusca(consulta, indiceDe(item))
    if (nota >= 0) casam.push([nota, item])
  }
  if (porRelevancia) casam.sort((a, b) => a[0] - b[0])
  return casam.map(([, item]) => item)
}
