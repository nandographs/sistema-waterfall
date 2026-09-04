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
