// Estado da conexão do WhatsApp, o QR code para parear — e o vigia.
//
// É o que a tela de conexão mostra: se o número está conectado, com que nome,
// e — quando cair — o QR para ler de novo. Exige login (verify_jwt).
//
// Corpo (opcional):  { acao?: 'verificar' | 'conectar' }
//
//   * verificar (padrão): pergunta à Evolution como está a instância. Se estiver
//     conectada, REGRAVA o webhook (ver _compartilhado/conexao.ts) — é o que faz
//     uma reconexão feita pelo painel da Evolution se corrigir sozinha. Também
//     responde se o webhook está MUDO: conectado, mas sem nenhum evento desde o
//     último envio.
//
//   * conectar: liga a instância já com a URL do webhook e os eventos, e devolve
//     o QR. É o único jeito certo de parear: pelo painel da Evolution, o número
//     conecta sem webhook e nada chega ao sistema.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { chamarEvolution, configuracaoAusente, json, erro, preflight } from '../_compartilhado/evolution.ts'
import { exigirGestao } from '../_compartilhado/acesso.ts'
import { regravarWebhook, gravarEstado, lerEstado } from '../_compartilhado/conexao.ts'

// service_role: o login já foi conferido pelo Supabase antes de chegar aqui
// (verify_jwt), e o estado é escrito por esta função e pelo webhook — que não
// tem usuário. Uma chave só para os dois evita depender da política de RLS.
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// Quanto tempo depois de um envio o eco dele precisa ter chegado. A Evolution
// devolve o evento SendMessage em segundos; cinco minutos sem nada não é
// lentidão, é webhook parado.
const ESPERA_DO_ECO_MS = 5 * 60 * 1000

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function lerQr(): Promise<string | null> {
  const resposta = await chamarEvolution('/instance/qr')
  if (!resposta.ok) return null
  const bruto = resposta.corpo?.data?.qrcode ?? resposta.corpo?.data?.code ?? resposta.corpo?.qrcode ?? null
  // A Evolution guarda "data:image/png;base64,...|<código>"; a rota já corta no
  // "|", mas versões antigas devolviam inteiro.
  return bruto ? String(bruto).split('|')[0] : null
}

// O webhook está mudo? Compara o último envio feito pelo sistema com o último
// evento que chegou. Cada envio gera um eco (SendMessage) e recibos — se depois
// dele não chegou NADA, a Evolution não está falando com o sistema.
//
// Só olha envios do sistema (`enviado_por` preenchido), e não mensagens
// recebidas: silêncio de cliente é normal, silêncio depois de um envio não é.
async function webhookMudo(ultimoEventoEm: string | null): Promise<{ mudo: boolean; desde: string | null }> {
  const { data } = await supabase
    .from('mensagens')
    .select('ocorrido_em')
    .eq('direcao', 'saida')
    .not('enviado_por', 'is', null)
    .neq('status', 'falhou')
    .order('ocorrido_em', { ascending: false })
    .limit(1)
    .maybeSingle()

  const envio = data?.ocorrido_em ? new Date(data.ocorrido_em).getTime() : 0
  if (!envio || Date.now() - envio < ESPERA_DO_ECO_MS) return { mudo: false, desde: null }
  const evento = ultimoEventoEm ? new Date(ultimoEventoEm).getTime() : 0
  return evento >= envio ? { mudo: false, desde: null } : { mudo: true, desde: ultimoEventoEm }
}

Deno.serve(async (req) => {
  const opcoes = preflight(req)
  if (opcoes) return opcoes

  const faltando = configuracaoAusente()
  if (faltando) return erro(faltando, 500)

  const recusa = await exigirGestao(req)
  if (recusa) return recusa

  let corpo: any = {}
  try { corpo = await req.json() } catch { /* GET ou corpo vazio: só verificar */ }
  const acao = corpo?.acao === 'conectar' ? 'conectar' : 'verificar'

  if (acao === 'conectar') {
    const ligada = await regravarWebhook()
    if (!ligada.ok) {
      return json({
        conectado: false,
        erro: 'a Evolution recusou a conexão',
        detalhe: String(ligada.corpo?.message ?? ligada.corpo?.error ?? ligada.corpo ?? '').slice(0, 300),
        status: ligada.status,
      }, 502)
    }
    // Número novo começa a contagem do histórico do zero.
    await gravarEstado(supabase, { historico_mensagens: 0, motivo: null })

    // O cliente da Evolution sobe em segundo plano; o QR leva um instante para
    // existir. Três tentativas curtas antes de devolver sem ele — a tela volta a
    // perguntar a cada poucos segundos de qualquer jeito.
    let qr: string | null = null
    for (let tentativa = 0; tentativa < 3 && !qr; tentativa++) {
      await espera(1500)
      qr = await lerQr()
    }
    return json({ conectado: false, qr })
  }

  const status = await chamarEvolution('/instance/status')

  if (!status.ok) {
    return json({
      conectado: false,
      erro: status.status === 401
        ? 'a Evolution não reconhece o token da instância (ela foi apagada ou trocada?)'
        : 'não foi possível falar com a Evolution',
      detalhe: String(status.corpo?.message ?? status.corpo?.error ?? status.corpo ?? '').slice(0, 300),
      status: status.status,
    }, 502)
  }

  const dados = status.corpo?.data ?? {}
  const conectado = dados.Connected === true && dados.LoggedIn === true

  // Conectado: garante que o webhook continua apontado para cá. Desconectado:
  // NÃO chama o connect — ele sobe a instância e começa a gerar QR, e isso só
  // deve acontecer quando alguém pediu para conectar.
  let webhookOk = true
  if (conectado) {
    const regravado = await regravarWebhook()
    webhookOk = regravado.ok
    if (!regravado.ok) console.warn('não consegui regravar o webhook:', regravado.status)
  }

  // O QR só faz sentido quando o número NÃO está conectado. Depois de um
  // "conectar", é aqui que a tela vai buscando o código novo (ele muda a cada
  // ~20 s) até alguém ler.
  const qr = conectado ? null : await lerQr()

  await gravarEstado(supabase, {
    conectado,
    nome: dados.Name || null,
    ultima_verificacao_em: new Date().toISOString(),
  })
  const estado = await lerEstado(supabase)
  const silencio = conectado ? await webhookMudo(estado?.ultimo_evento_em ?? null) : { mudo: false, desde: null }

  return json({
    conectado,
    nome: dados.Name ?? '',
    qr,
    webhookOk,
    mudo: silencio.mudo,
    ultimoEventoEm: estado?.ultimo_evento_em ?? null,
    historicoMensagens: estado?.historico_mensagens ?? 0,
    motivo: conectado ? null : (estado?.motivo ?? null),
  })
})
