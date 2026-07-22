// Busca de endereço por CEP. Tenta a ViaCEP primeiro; se falhar (fora do ar,
// erro de rede) ou não encontrar o CEP, tenta a BrasilAPI como reserva.
// Retorna null se nenhuma das duas encontrar o CEP.

async function buscarViaCep(cep) {
  const resp = await fetch(`https://viacep.com.br/ws/${cep}/json/`)
  if (!resp.ok) throw new Error('ViaCEP indisponível')
  const dados = await resp.json()
  if (dados.erro) return null
  return {
    endereco: dados.logradouro || '',
    bairro: dados.bairro || '',
    cidade: dados.localidade || '',
    uf: dados.uf || '',
  }
}

async function buscarBrasilApi(cep) {
  const resp = await fetch(`https://brasilapi.com.br/api/cep/v1/${cep}`)
  if (!resp.ok) return null
  const dados = await resp.json()
  return {
    endereco: dados.street || '',
    bairro: dados.neighborhood || '',
    cidade: dados.city || '',
    uf: dados.state || '',
  }
}

export async function buscarCep(cepBruto) {
  const cep = String(cepBruto ?? '').replace(/\D/g, '')
  if (cep.length !== 8) return null

  try {
    const resultado = await buscarViaCep(cep)
    if (resultado) return resultado
  } catch {
    // segue para o serviço de reserva
  }

  try {
    return await buscarBrasilApi(cep)
  } catch {
    return null
  }
}
