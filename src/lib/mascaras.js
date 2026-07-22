// Máscaras de digitação para campos de formulário (CPF/CNPJ e telefone).
// Aplicadas conforme o usuário digita: mantém só dígitos internamente e
// formata a exibição.

export function mascararCpfCnpj(value) {
  const digitos = String(value ?? '').replace(/\D/g, '').slice(0, 14)
  if (digitos.length <= 11) {
    // CPF: 000.000.000-00
    return digitos
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2')
  }
  // CNPJ: 00.000.000/0000-00
  return digitos
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2')
}

export function mascararCep(value) {
  const digitos = String(value ?? '').replace(/\D/g, '').slice(0, 8)
  return digitos.replace(/^(\d{5})(\d)/, '$1-$2')
}

export function mascararTelefone(value) {
  // Aceita fixo (DDD + 8 dígitos) e celular (DDD + 9º dígito + 8 dígitos)
  const digitos = String(value ?? '').replace(/\D/g, '').slice(0, 11)
  if (digitos.length <= 2) return digitos.replace(/^(\d*)/, '($1')
  if (digitos.length <= 6) return digitos.replace(/^(\d{2})(\d*)/, '($1) $2')
  if (digitos.length <= 10) {
    // fixo: (00) 0000-0000
    return digitos.replace(/^(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3').replace(/-$/, '')
  }
  // celular: (00) 00000-0000
  return digitos.replace(/^(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3').replace(/-$/, '')
}
