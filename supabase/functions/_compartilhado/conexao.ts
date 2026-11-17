// O que liga a instância da Evolution ao sistema — e o registro de que ela
// continua ligada.
//
// A LIÇÃO QUE ESTE ARQUIVO GUARDA: no Evolution Go, a URL do webhook e a lista
// de eventos são gravadas no `POST /instance/connect`, e SÓ ali. Conectar sem
// informá-las (o botão do painel da Evolution faz exatamente isso) grava uma URL
// vazia por cima da que existia — conferido no código-fonte, em
// pkg/instance/service/instance_service.go. Foi assim que o sistema passou de
// 24/09 a 30/10/2026 sem receber uma mensagem, sem erro nenhum em lugar nenhum.
//
// Por isso a URL nunca é configurada à mão: `regravarWebhook` é chamado pelo
// próprio sistema ao conectar e a cada verificação de estado. Com a instância já
// rodando, o `connect` só atualiza as configurações, sem derrubar nada — então
// repetir é barato, e qualquer reconexão feita por fora se corrige sozinha na
// verificação seguinte.

import { chamarEvolution } from './evolution.ts'

// Os nomes vêm de pkg/internal/event_types/event_types.go. Nome errado não dá
// erro: a Evolution descarta em silêncio, e o evento simplesmente nunca chega.
//
//   MESSAGE       mensagem recebida e a que você manda pelo celular
//   SEND_MESSAGE  a que sai pela API (o eco do que o sistema enviou)
//   READ_RECEIPT  ✓✓, lida, e "você leu no celular" (zera as não lidas)
//   HISTORY_SYNC  as conversas que o celular manda ao parear
//   CONNECTION    conectou, caiu, deslogou, banimento temporário
//
// Presença ("digitando…") fica de fora por enquanto: é um evento por tecla, e
// cada um seria uma chamada à função.
export const EVENTOS_ASSINADOS = ['MESSAGE', 'SEND_MESSAGE', 'READ_RECEIPT', 'HISTORY_SYNC', 'CONNECTION']

export function urlDoWebhook(): string | null {
  const base = Deno.env.get('SUPABASE_URL') ?? ''
  const token = Deno.env.get('WEBHOOK_TOKEN') ?? ''
  if (!base || !token) return null
  // O segredo vai na query string porque a Evolution Go não manda header
  // personalizado (ver o cabeçalho de wa-webhook/index.ts).
  return `${base.replace(/\/+$/, '')}/functions/v1/wa-webhook?token=${encodeURIComponent(token)}`
}

// Cada número tem a sua chave: quem chama passa a do número a regravar.
export async function regravarWebhook(token: string) {
  const webhookUrl = urlDoWebhook()
  if (!webhookUrl) return { ok: false, status: 0, corpo: { error: 'WEBHOOK_TOKEN não configurado' } }
  return await chamarEvolution('/instance/connect', {
    metodo: 'POST',
    token,
    corpo: { webhookUrl, subscribe: EVENTOS_ASSINADOS, immediate: true },
  })
}
