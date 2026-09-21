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
