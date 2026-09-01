// Cliente HTTP da Evolution Go — o único lugar do projeto que conhece a chave.
//
// POR QUE ISTO RODA AQUI E NÃO NO NAVEGADOR: a chave da instância dá poder
// total sobre o WhatsApp (mandar mensagem por você, ler conversas, derrubar a
// sessão). Tudo que vai para o navegador é público — é o mesmo raciocínio da
// migração 007 sobre a ANON_KEY. Por isso o front fala com estas funções, e só
// elas falam com a Evolution.
//
// DESCOBERTAS SOBRE A API (conferidas no Swagger da instância, não na
// documentação da versão Node, que é diferente):
//   * o header de autenticação é `apikey` (Authorization/Bearer devolvem 401);
//   * operações da instância — enviar, status, QR — usam o TOKEN DA INSTÂNCIA;
//     a chave global só serve para gerenciar instâncias (/instance/all, create);
//   * o caminho de envio é `POST /send/text` com { number, text }: a instância
//     vem do token, e não do caminho como na versão Node.

const URL_BASE = Deno.env.get('EVOLUTION_URL') ?? ''
const TOKEN = Deno.env.get('EVOLUTION_TOKEN_INSTANCIA') ?? ''

export function configuracaoAusente(): string | null {
  if (!URL_BASE) return 'EVOLUTION_URL não configurada'
  if (!TOKEN) return 'EVOLUTION_TOKEN_INSTANCIA não configurado'
  return null
}

type Resposta = { ok: boolean; status: number; corpo: any }

export async function chamarEvolution(
  caminho: string,
  init: { metodo?: string; corpo?: unknown } = {},
): Promise<Resposta> {
  const url = `${URL_BASE.replace(/\/+$/, '')}${caminho}`
  const resposta = await fetch(url, {
    method: init.metodo ?? 'GET',
    headers: {
      'apikey': TOKEN,
      'Content-Type': 'application/json',
    },
    body: init.corpo === undefined ? undefined : JSON.stringify(init.corpo),
  })

  // A Evolution devolve JSON em tudo, mas um proxy no meio do caminho pode
  // devolver HTML numa falha — ler como texto primeiro evita que o erro real
  // vire "Unexpected token < in JSON".
  const texto = await resposta.text()
  let corpo: any = texto
  try {
    corpo = texto ? JSON.parse(texto) : null
  } catch {
    /* mantém o texto cru, que é o que ajuda a diagnosticar */
  }

  return { ok: resposta.ok, status: resposta.status, corpo }
}

// CORS. Sem estes cabeçalhos o navegador BLOQUEIA a resposta — e o sintoma é
// traiçoeiro: a função responde 200, o servidor vê tudo certo, e no aplicativo
// a chamada simplesmente falha. Como `functions.invoke` manda o JWT no header
// Authorization, o navegador faz um OPTIONS antes de cada chamada, e é ele que
// precisa ser respondido.
//
// Origin '*' é aceitável aqui porque a autorização não vem da origem: quem não
// tiver um JWT válido é recusado pelo próprio Supabase antes de chegar no
// código (ver verify_jwt no config.toml).
export const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

// Responde o preflight. Devolve null quando não é OPTIONS, para o handler
// seguir o fluxo normal.
export function preflight(req: Request): Response | null {
  return req.method === 'OPTIONS' ? new Response('ok', { headers: CORS }) : null
}

// Respostas padronizadas. O front lê `erro` para mostrar na tela; nenhuma
// resposta daqui devolve a chave nem o corpo cru da Evolution.
export function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

export function erro(mensagem: string, status = 400): Response {
  return json({ erro: mensagem }, status)
}
