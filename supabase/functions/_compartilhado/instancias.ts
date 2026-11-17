// Os números de WhatsApp do sistema — um por usuário, mais o da empresa.
//
// Cada número é uma INSTÂNCIA na Evolution Go, com a sua própria chave. O
// cadastro fica em `whatsapp_estado` (quem é o dono, de que unidade, se está
// conectado) e a chave em `whatsapp_tokens`, tabela que o navegador não lê
// (migração 034).
//
// O NÚMERO DA EMPRESA é a exceção: ele existia antes desta divisão, e a chave
// dele está nos segredos (`EVOLUTION_TOKEN_INSTANCIA`). Ler dali quando a
// tabela não tem a chave evita ter de copiar um segredo para o banco à mão.
//
// CRIAR uma instância exige a chave GLOBAL da Evolution
// (`EVOLUTION_GLOBAL_KEY`): a chave de uma instância só mexe nela mesma.

import { chamarEvolution } from './evolution.ts'

export const INSTANCIA_EMPRESA = Deno.env.get('EVOLUTION_INSTANCIA') ?? 'waterfall'
const TOKEN_EMPRESA = Deno.env.get('EVOLUTION_TOKEN_INSTANCIA') ?? ''
const CHAVE_GLOBAL = Deno.env.get('EVOLUTION_GLOBAL_KEY') ?? ''

// Como todo número do sistema fica configurado na Evolution.
//
// GRUPOS E STATUS DESLIGADOS: o WhatsApp do sistema é atendimento a cliente.
// Grupo e Status ("stories") não são atendimento — o webhook já os descartava,
// mas a Evolution continuava processando e despachando cada um. Ligado aqui, ela
// para antes. (Não impede o WhatsApp de ENVIAR o Status ao aparelho: isso o
// protocolo não deixa escolher.)
export const CONFIGURACOES_DO_NUMERO = {
  alwaysOnline: false,
  rejectCall: false,
  msgRejectCall: '',
  readMessages: false,
  ignoreGroups: true,
  ignoreStatus: true,
}

// O id interno da Evolution, que a rota de configurações pede no caminho. Só a
// lista geral (chave global) diz qual é a partir do nome.
async function idNaEvolution(nome: string): Promise<string | null> {
  if (!CHAVE_GLOBAL) return null
  const lista = await chamarEvolution('/instance/all', { token: CHAVE_GLOBAL })
  const todas = lista.corpo?.data ?? lista.corpo ?? []
  return Array.isArray(todas) ? (todas.find((i: any) => i.name === nome)?.id ?? null) : null
}

// Garante as configurações acima num número. Silenciosa: falhar aqui não pode
// impedir a pessoa de conectar — o webhook continua descartando grupo e Status.
export async function aplicarConfiguracoes(instancia: { instancia: string; token: string }) {
  const id = await idNaEvolution(instancia.instancia)
  if (!id) return
  const feita = await chamarEvolution(`/instance/${id}/advanced-settings`, {
    metodo: 'PUT', token: instancia.token, corpo: CONFIGURACOES_DO_NUMERO,
  })
  if (!feita.ok) console.warn(`${instancia.instancia}: configurações não aplicadas (${feita.status})`)
}

export type Instancia = {
  instancia: string
  token: string
  dono_id: string | null
  unidade_id: string | null
  conectado: boolean | null
  nome: string | null
  numero: string | null
  ultimo_evento_em: string | null
  historico_mensagens: number | null
  motivo: string | null
}

// O que o webhook e a importação do histórico precisam saber do número que
// recebeu: onde gravar, com que chave baixar mídia, e de quem é o cliente.
//
// `soDaUnidade`: o número de um distribuidor reconhece só os clientes da
// unidade dele. Sem isto, o cliente da Waterfall que escrevesse para o
// distribuidor seria vinculado a uma ficha que o distribuidor não pode abrir.
export type ContextoDoNumero = {
  instancia: string
  token: string
  unidadeId: string | null
  soDaUnidade: boolean
}

export async function contextoDoNumero(supabase: any, instancia: Instancia): Promise<ContextoDoNumero> {
  let soDaUnidade = false
  if (instancia.dono_id) {
    const { data } = await supabase.from('perfis').select('papel').eq('user_id', instancia.dono_id).maybeSingle()
    soDaUnidade = data?.papel !== 'gestao'
  }
  return { instancia: instancia.instancia, token: instancia.token, unidadeId: instancia.unidade_id, soDaUnidade }
}

// O cadastro + a chave de um número. Null quando ele não existe.
export async function carregarInstancia(supabase: any, nome: string): Promise<Instancia | null> {
  if (!nome) return null
  const [{ data: estado }, { data: chave }] = await Promise.all([
    supabase.from('whatsapp_estado').select('*').eq('instancia', nome).maybeSingle(),
    supabase.from('whatsapp_tokens').select('token').eq('instancia', nome).maybeSingle(),
  ])
  const token = chave?.token || (nome === INSTANCIA_EMPRESA ? TOKEN_EMPRESA : '')
  if (!estado && !token) return null
  return {
    instancia: nome,
    token,
    dono_id: estado?.dono_id ?? null,
    unidade_id: estado?.unidade_id ?? null,
    conectado: estado?.conectado ?? null,
    nome: estado?.nome ?? null,
    numero: estado?.numero ?? null,
    ultimo_evento_em: estado?.ultimo_evento_em ?? null,
    historico_mensagens: estado?.historico_mensagens ?? 0,
    motivo: estado?.motivo ?? null,
  }
}

// O número de uma pessoa, ou null se ela ainda não conectou nenhum.
export async function instanciaDoUsuario(supabase: any, userId: string): Promise<Instancia | null> {
  const { data } = await supabase
    .from('whatsapp_estado').select('instancia').eq('dono_id', userId).maybeSingle()
  return data ? await carregarInstancia(supabase, data.instancia) : null
}

// De qual número veio um evento do webhook. A Evolution manda o nome da
// instância em cada evento; sem ele (versão antiga), é o da empresa.
export function nomeDaInstanciaDoEvento(evento: any): string {
  return String(evento?.instanceName ?? '') || INSTANCIA_EMPRESA
}

export async function gravarEstado(supabase: any, instancia: string, campos: Record<string, unknown>) {
  const { error } = await supabase
    .from('whatsapp_estado')
    .upsert({ instancia, ...campos }, { onConflict: 'instancia' })
  if (error) console.warn('whatsapp_estado:', error.message)
}

// Cria a instância de uma pessoa na Evolution e no cadastro.
//
// O nome leva o começo do id do usuário — único e estável —, e a chave é
// gerada aqui: a Evolution aceita a que mandarmos, e assim ela nasce já guardada
// no banco, sem depender de ler a resposta.
export async function criarInstanciaDoUsuario(
  supabase: any,
  dono: { userId: string; unidadeId: string | null; nome: string },
): Promise<{ instancia?: Instancia; erro?: string }> {
  if (!CHAVE_GLOBAL) {
    return { erro: 'falta a chave global da Evolution (EVOLUTION_GLOBAL_KEY) para criar números novos' }
  }
  const instancia = `usuario-${dono.userId.slice(0, 8)}`
  const token = crypto.randomUUID()

  const criada = await chamarEvolution('/instance/create', {
    metodo: 'POST',
    token: CHAVE_GLOBAL,
    corpo: { name: instancia, token, advancedSettings: CONFIGURACOES_DO_NUMERO },
  })
  // Já existir na Evolution (uma tentativa anterior que caiu no meio) não é
  // erro: o que falta é o cadastro, e ele vem a seguir com a chave nova.
  const jaExistia = !criada.ok && /exist|already|duplic/i.test(JSON.stringify(criada.corpo ?? ''))
  if (!criada.ok && !jaExistia) {
    return { erro: `a Evolution recusou criar o número (${criada.status}): ${JSON.stringify(criada.corpo).slice(0, 200)}` }
  }
  if (jaExistia) {
    return { erro: 'já existe uma instância com esse nome na Evolution, mas sem chave no sistema — apague-a no painel e tente de novo' }
  }

  const { error: erroEstado } = await supabase.from('whatsapp_estado').upsert({
    instancia, dono_id: dono.userId, unidade_id: dono.unidadeId, conectado: false,
  }, { onConflict: 'instancia' })
  if (erroEstado) return { erro: `não foi possível cadastrar o número: ${erroEstado.message}` }

  const { error: erroToken } = await supabase.from('whatsapp_tokens').upsert({ instancia, token })
  if (erroToken) return { erro: `não foi possível guardar a chave do número: ${erroToken.message}` }

  return { instancia: (await carregarInstancia(supabase, instancia))! }
}
