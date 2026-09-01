// Estado da conexão do WhatsApp e o QR code para parear.
//
// É o que a tela de configuração mostra: se o número está conectado, com que
// nome, e — quando cair — o QR para ler de novo. Exige login (verify_jwt).

import { chamarEvolution, configuracaoAusente, json, erro, preflight } from '../_compartilhado/evolution.ts'

Deno.serve(async (req) => {
  const opcoes = preflight(req)
  if (opcoes) return opcoes

  const faltando = configuracaoAusente()
  if (faltando) return erro(faltando, 500)

  const status = await chamarEvolution('/instance/status')

  if (!status.ok) {
    return json({
      conectado: false,
      erro: 'não foi possível falar com a Evolution',
      detalhe: String(status.corpo?.message ?? status.corpo ?? '').slice(0, 300),
      status: status.status,
    }, 502)
  }

  const dados = status.corpo?.data ?? {}
  const conectado = dados.Connected === true && dados.LoggedIn === true

  // O QR só faz sentido quando o número NÃO está conectado — e pedir à toa faz
  // a Evolution gerar um código novo sem necessidade.
  let qr: string | null = null
  if (!conectado) {
    const resposta = await chamarEvolution('/instance/qr')
    if (resposta.ok) {
      qr = resposta.corpo?.data?.qrcode ?? resposta.corpo?.data?.code ?? resposta.corpo?.qrcode ?? null
    }
  }

  return json({
    conectado,
    nome: dados.Name ?? '',
    qr,
  })
})
