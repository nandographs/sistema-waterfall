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

// Tempo limite de cada chamada.
//
// EXISTE POR CAUSA DE UM CASO REAL, e não por precaução genérica: pedir a foto
// de perfil com o número no formato errado faz a Evolution NUNCA responder —
// não devolve erro, apenas não volta. Sem este limite, a Edge Function ficava
// pendurada até a plataforma matá-la, sem gravar nada e sem dizer por quê.
//
// Um `fetch` sem timeout é uma promessa que pode nunca se resolver. Num
// servidor que responde em 0,3 s quando está bem, 20 s já é generoso: se
// passou disso, não é lentidão, é travamento.
const LIMITE_MS = 20_000

export async function chamarEvolution(
  caminho: string,
  init: { metodo?: string; corpo?: unknown; limiteMs?: number } = {},
): Promise<Resposta> {
  const url = `${URL_BASE.replace(/\/+$/, '')}${caminho}`

  const cancelador = new AbortController()
  const alarme = setTimeout(() => cancelador.abort(), init.limiteMs ?? LIMITE_MS)

  let resposta: Response
  try {
    resposta = await fetch(url, {
      method: init.metodo ?? 'GET',
      headers: {
        'apikey': TOKEN,
        'Content-Type': 'application/json',
      },
      body: init.corpo === undefined ? undefined : JSON.stringify(init.corpo),
      signal: cancelador.signal,
    })
  } catch (falha) {
    // 504 (tempo esgotado) é a tradução honesta de "não respondeu": quem chama
    // trata como erro de infraestrutura e tenta de novo depois, em vez de
    // concluir que o contato não tem foto.
    const expirou = (falha as Error)?.name === 'AbortError'
    return {
      ok: false,
      status: expirou ? 504 : 0,
      corpo: { error: expirou ? `sem resposta em ${(init.limiteMs ?? LIMITE_MS) / 1000}s` : String(falha) },
    }
  } finally {
    clearTimeout(alarme)
  }

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

// Irmã de `chamarEvolution` para quando a resposta pode ser um ARQUIVO.
//
// `chamarEvolution` lê o corpo como texto para parsear JSON — com uma foto ou um
// áudio, isso corromperia os bytes sem dar erro nenhum: a imagem chegaria ao
// bucket inteira no tamanho e ilegível no conteúdo. Aqui o corpo vem como
// ArrayBuffer, e quem chama decide se é JSON (com base64 dentro) ou o arquivo
// em si, olhando o `content-type`.
export async function chamarEvolutionBinario(
  caminho: string,
  corpo: unknown,
  limiteMs = 45_000,
): Promise<{ ok: boolean; status: number; tipo: string; bytes: ArrayBuffer | null; erro?: string }> {
  const url = `${URL_BASE.replace(/\/+$/, '')}${caminho}`
  const cancelador = new AbortController()
  // Mais folga que o padrão: baixar e decifrar a mídia do servidor do WhatsApp
  // é trabalho de verdade do lado da Evolution, não uma consulta.
  const alarme = setTimeout(() => cancelador.abort(), limiteMs)
  try {
    const resposta = await fetch(url, {
      method: 'POST',
      headers: { 'apikey': TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
      signal: cancelador.signal,
    })
    return {
      ok: resposta.ok,
      status: resposta.status,
      tipo: resposta.headers.get('content-type') ?? '',
      bytes: await resposta.arrayBuffer(),
    }
  } catch (falha) {
    const expirou = (falha as Error)?.name === 'AbortError'
    return { ok: false, status: expirou ? 504 : 0, tipo: '', bytes: null, erro: String(falha) }
  } finally {
    clearTimeout(alarme)
  }
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
