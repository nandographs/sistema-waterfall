// Os números de WhatsApp: estado, QR para parear, desconectar, reiniciar — e o
// vigia. Exige login (verify_jwt).
//
// UM NÚMERO POR USUÁRIO (migração 034). Cada pessoa conecta o próprio celular e
// mexe só nele; a gestão vê e usa todos, inclusive o da empresa. A conferência
// é `podeUsar`, a mesma regra de `pode_usar_instancia()` no banco.
//
// Corpo:  { acao?, instancia? }   — sem `instancia`, vale o número de quem
// chamou (ou o da empresa, para a gestão que ainda não conectou o seu).
//
//   * listar: os números que a pessoa pode usar, só do banco — nenhuma
//     chamada à Evolution. É o que o seletor da tela mostra.
//
//   * verificar (padrão): pergunta à Evolution como está o número. Se estiver
//     conectado, REGRAVA o webhook (ver _compartilhado/conexao.ts) — é o que faz
//     uma reconexão feita pelo painel da Evolution se corrigir sozinha. Também
//     responde se o webhook está MUDO: conectado, mas sem nenhum evento desde o
//     último envio.
//
//   * qr: o mesmo que verificar, e mais o QR quando desconectado. Só a janela
//     de conectar usa.
//
//   * conectar: liga a instância já com a URL do webhook e os eventos, e devolve
//     o QR. Quem ainda não tem número ganha um aqui (precisa da chave global
//     da Evolution). É o único jeito certo de parear: pelo painel da Evolution,
//     o número conecta sem webhook e nada chega ao sistema.
//
//   * desconectar: tira o celular da Evolution (o mesmo que "sair" em
//     Dispositivos conectados). Para voltar, é ler o QR de novo.
//
//   * reiniciar: derruba e refaz a conexão sem deslogar — para o número que
//     está conectado mas parou de receber.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { chamarEvolution, configuracaoAusente, json, erro, preflight } from '../_compartilhado/evolution.ts'
import { quemChamou, podeUsar, type Quem } from '../_compartilhado/acesso.ts'
import { regravarWebhook } from '../_compartilhado/conexao.ts'
import { jidParaNumero } from '../_compartilhado/telefone.ts'
import {
  INSTANCIA_EMPRESA, carregarInstancia, instanciaDoUsuario, criarInstanciaDoUsuario, gravarEstado,
  aplicarConfiguracoes,
  type Instancia,
} from '../_compartilhado/instancias.ts'

// service_role: o acesso já foi conferido por `quemChamou` + `podeUsar`, e o
// cadastro dos números é escrito por esta função e pelo webhook — que não tem
// usuário. As chaves (`whatsapp_tokens`) só esta chave lê.
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// Quanto tempo depois de um envio o eco dele precisa ter chegado. A Evolution
// devolve o evento SendMessage em segundos; cinco minutos sem nada não é
// lentidão, é webhook parado.
const ESPERA_DO_ECO_MS = 5 * 60 * 1000

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function lerQr(token: string): Promise<string | null> {
  const resposta = await chamarEvolution('/instance/qr', { token })
  if (!resposta.ok) return null
  const bruto = resposta.corpo?.data?.qrcode ?? resposta.corpo?.data?.code ?? resposta.corpo?.qrcode ?? null
  // A Evolution guarda "data:image/png;base64,...|<código>"; a rota já corta no
  // "|", mas versões antigas devolviam inteiro.
  return bruto ? String(bruto).split('|')[0] : null
}

// O webhook deste número está mudo? Compara o último envio feito pelo sistema
// por ele com o último evento que chegou dele. Cada envio gera um eco
// (SendMessage) e recibos — se depois dele não chegou NADA, a Evolution não está
// falando com o sistema.
//
// Só olha envios do sistema (`enviado_por` preenchido), e não mensagens
// recebidas: silêncio de cliente é normal, silêncio depois de um envio não é.
async function webhookMudo(instancia: string, ultimoEventoEm: string | null): Promise<boolean> {
  const { data } = await supabase
    .from('mensagens')
    .select('ocorrido_em, conversas!inner(instancia)')
    .eq('conversas.instancia', instancia)
    .eq('direcao', 'saida')
    .not('enviado_por', 'is', null)
    .neq('status', 'falhou')
    .order('ocorrido_em', { ascending: false })
    .limit(1)
    .maybeSingle()

  const envio = data?.ocorrido_em ? new Date(data.ocorrido_em).getTime() : 0
  if (!envio || Date.now() - envio < ESPERA_DO_ECO_MS) return false
  const evento = ultimoEventoEm ? new Date(ultimoEventoEm).getTime() : 0
  return evento < envio
}

const motivoEvolution = (corpo: any) =>
  String(corpo?.message ?? corpo?.error ?? (typeof corpo === 'string' ? corpo : JSON.stringify(corpo ?? ''))).slice(0, 300)

// Os números que esta pessoa pode usar, com o nome do dono — só do banco.
async function listar(quem: Quem) {
  let consulta = supabase
    .from('whatsapp_estado')
    .select('instancia, dono_id, conectado, nome, numero, ultimo_evento_em, motivo')
    .order('criado_em')
  if (!quem.gestao) consulta = consulta.eq('dono_id', quem.userId)
  const { data: numeros, error } = await consulta
  if (error) return erro(`não foi possível listar os números: ${error.message}`, 500)

  const donos = [...new Set((numeros ?? []).map((n) => n.dono_id).filter(Boolean))]
  const { data: perfis } = donos.length
    ? await supabase.from('perfis').select('user_id, nome').in('user_id', donos)
    : { data: [] }
  const nomeDe = new Map((perfis ?? []).map((p) => [p.user_id, p.nome]))

  return json({
    numeros: (numeros ?? []).map((n) => ({
      instancia: n.instancia,
      dono: n.dono_id ? (nomeDe.get(n.dono_id) || 'usuário') : 'Empresa',
      empresa: !n.dono_id,
      meu: n.dono_id === quem.userId,
      conectado: !!n.conectado,
      nome: n.nome ?? '',
      numero: n.numero ?? '',
      ultimoEventoEm: n.ultimo_evento_em,
      motivo: n.motivo,
    })),
    meu: (numeros ?? []).find((n) => n.dono_id === quem.userId)?.instancia ?? null,
    gestao: quem.gestao,
  })
}

// Qual número a chamada quer dizer. Sem `instancia`: o da pessoa; a gestão sem
// número próprio cai no da empresa — é o que ela usava antes desta divisão.
async function resolver(quem: Quem, pedido: unknown): Promise<Instancia | null> {
  if (pedido) return await carregarInstancia(supabase, String(pedido))
  const minha = await instanciaDoUsuario(supabase, quem.userId)
  if (minha) return minha
  return quem.gestao ? await carregarInstancia(supabase, INSTANCIA_EMPRESA) : null
}

Deno.serve(async (req) => {
  const opcoes = preflight(req)
  if (opcoes) return opcoes

  const faltando = configuracaoAusente()
  if (faltando) return erro(faltando, 500)

  const { quem, recusa } = await quemChamou(req)
  if (recusa) return recusa

  let corpo: any = {}
  try { corpo = await req.json() } catch { /* corpo vazio: verificar o próprio número */ }
  const acao = ['listar', 'qr', 'conectar', 'desconectar', 'reiniciar'].includes(corpo?.acao)
    ? corpo.acao
    : 'verificar'

  if (acao === 'listar') return await listar(quem!)

  let instancia = await resolver(quem!, corpo?.instancia)

  // Conectar sem ter número: nasce o da pessoa. Vale também para a gestão —
  // "conectar outro" é conectar o PRÓPRIO celular, ao lado do da empresa.
  if (!instancia || (acao === 'conectar' && corpo?.novo && !instancia.dono_id)) {
    if (acao !== 'conectar') {
      return json({ semNumero: true, conectado: false })
    }
    const existente = await instanciaDoUsuario(supabase, quem!.userId)
    if (existente) {
      instancia = existente
    } else {
      const criada = await criarInstanciaDoUsuario(supabase, {
        userId: quem!.userId, unidadeId: quem!.unidadeId, nome: quem!.nome,
      })
      if (criada.erro) return erro(criada.erro, 502)
      instancia = criada.instancia!
    }
  }

  if (!podeUsar(quem!, instancia)) return erro('este número é de outra pessoa', 403)
  if (!instancia.token) return erro('este número não tem chave da Evolution guardada no sistema', 500)
  const { token } = instancia
  const nome = instancia.instancia

  if (acao === 'conectar') {
    const ligada = await regravarWebhook(token)
    if (!ligada.ok) {
      return json({
        instancia: nome,
        conectado: false,
        erro: 'a Evolution recusou a conexão',
        detalhe: motivoEvolution(ligada.corpo),
        status: ligada.status,
      }, 502)
    }
    // Grupos e Status desligados — vale para o número criado agora e para o
    // que existia antes desta regra (ver CONFIGURACOES_DO_NUMERO).
    await aplicarConfiguracoes(instancia)

    // Número novo começa a contagem do histórico do zero.
    await gravarEstado(supabase, nome, { historico_mensagens: 0, motivo: null })

    // O cliente da Evolution sobe em segundo plano; o QR leva um instante para
    // existir. Três tentativas curtas antes de devolver sem ele — a tela volta a
    // perguntar a cada poucos segundos de qualquer jeito.
    let qr: string | null = null
    for (let tentativa = 0; tentativa < 3 && !qr; tentativa++) {
      await espera(1500)
      qr = await lerQr(token)
    }
    return json({ instancia: nome, conectado: false, qr })
  }

  if (acao === 'desconectar') {
    const saiu = await chamarEvolution('/instance/logout', { metodo: 'DELETE', token })
    // Já desconectado não é erro: o que a pessoa queria já é verdade.
    const jaEstava = !saiu.ok && /not (logged|connected)|no session|não/i.test(motivoEvolution(saiu.corpo))
    if (!saiu.ok && !jaEstava) {
      return json({ instancia: nome, erro: 'a Evolution não desconectou', detalhe: motivoEvolution(saiu.corpo) }, 502)
    }
    await gravarEstado(supabase, nome, {
      conectado: false,
      motivo: `desconectado pelo sistema por ${quem!.nome || 'um usuário'}`,
    })
    return json({ instancia: nome, conectado: false })
  }

  if (acao === 'reiniciar') {
    const refeita = await chamarEvolution('/instance/reconnect', { metodo: 'POST', token })
    if (!refeita.ok) {
      return json({
        instancia: nome,
        erro: 'a Evolution não reiniciou a conexão — se o número estiver desconectado, conecte pelo QR',
        detalhe: motivoEvolution(refeita.corpo),
      }, 502)
    }
    // A conexão leva um instante para voltar; a verificação abaixo responde
    // como ela ficou.
    await espera(3000)
  }

  const status = await chamarEvolution('/instance/status', { token })

  if (!status.ok) {
    return json({
      instancia: nome,
      conectado: false,
      erro: status.status === 401
        ? 'a Evolution não reconhece a chave deste número (a instância foi apagada no painel?)'
        : 'não foi possível falar com a Evolution',
      detalhe: motivoEvolution(status.corpo),
      status: status.status,
    }, 502)
  }

  const dados = status.corpo?.data ?? {}
  const conectado = dados.Connected === true && dados.LoggedIn === true

  // Conectado: garante que o webhook continua apontado para cá. Desconectado:
  // NÃO chama o connect — ele sobe a instância e começa a gerar QR, e isso só
  // deve acontecer quando alguém pediu para conectar.
  let webhookOk = true
  let numero: string | null = null
  if (conectado) {
    const regravado = await regravarWebhook(token)
    webhookOk = regravado.ok
    if (!regravado.ok) console.warn(`${nome}: não consegui regravar o webhook:`, regravado.status)
    // O `connect` devolve o JID do celular pareado — é de onde sai o número.
    numero = jidParaNumero(regravado.corpo?.data?.jid) || null
  }

  // O QR só faz sentido quando o número NÃO está conectado, e só quando a
  // janela de conectar pediu (acao 'qr'): é ali que a tela vai buscando o
  // código novo (ele muda a cada ~20 s) até alguém ler.
  //
  // NUNCA na verificação de rotina: na Evolution Go, ler o QR sem sessão ativa
  // SOBE a instância. O aviso que roda em toda tela fazia isso a cada 5 minutos
  // com o número desconectado — e cada subida abria conexões no Postgres da
  // Evolution que nunca eram fechadas (11/2026, "too many clients").
  const qr = conectado || acao !== 'qr' ? null : await lerQr(token)

  await gravarEstado(supabase, nome, {
    conectado,
    nome: dados.Name || null,
    ...(numero ? { numero } : {}),
    ...(conectado ? { motivo: null } : {}),
    ultima_verificacao_em: new Date().toISOString(),
  })
  const estado = await carregarInstancia(supabase, nome)
  const mudo = conectado ? await webhookMudo(nome, estado?.ultimo_evento_em ?? null) : false

  return json({
    instancia: nome,
    conectado,
    nome: dados.Name ?? '',
    numero: numero ?? estado?.numero ?? '',
    qr,
    webhookOk,
    mudo,
    ultimoEventoEm: estado?.ultimo_evento_em ?? null,
    historicoMensagens: estado?.historico_mensagens ?? 0,
    motivo: conectado ? null : (estado?.motivo ?? null),
  })
})
