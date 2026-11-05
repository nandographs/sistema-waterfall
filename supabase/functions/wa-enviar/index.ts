// Envia uma mensagem de texto pelo WhatsApp.
//
// Só quem está logado no Waterfall chega aqui: `verify_jwt = true` no
// config.toml faz o Supabase recusar a chamada sem o token do usuário. O
// navegador chama com `supabase.functions.invoke`, que já manda o JWT da
// sessão — nenhuma credencial da Evolution passa perto do front.
//
// Corpo esperado:
//   { conversaId?, clienteId?, numero?, texto, oportunidadeId?, enviadoPor? }
// Pelo menos um entre conversaId / clienteId / numero.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { chamarEvolution, configuracaoAusente, json, erro, preflight } from '../_compartilhado/evolution.ts'
import { exigirGestao } from '../_compartilhado/acesso.ts'
import { paraE164 } from '../_compartilhado/telefone.ts'

const INSTANCIA = Deno.env.get('EVOLUTION_INSTANCIA') ?? 'waterfall'

function motivo(corpo: any): string {
  if (corpo == null) return ''
  if (typeof corpo === 'string') return corpo
  const texto = corpo.message ?? corpo.error
  return typeof texto === 'string' ? texto : JSON.stringify(corpo)
}

Deno.serve(async (req) => {
  const opcoes = preflight(req)
  if (opcoes) return opcoes

  const faltando = configuracaoAusente()
  if (faltando) return erro(faltando, 500)

  const recusa = await exigirGestao(req)
  if (recusa) return recusa

  let corpo: any
  try {
    corpo = await req.json()
  } catch {
    return erro('corpo inválido')
  }

  const texto = String(corpo?.texto ?? '').trim()
  if (!texto) return erro('texto vazio')

  // Usa o token do usuário que chamou: assim o RLS continua valendo na leitura,
  // e não é a service_role decidindo o que ele pode ver.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
  )

  // 1. Descobrir para qual número vai.
  let numero = corpo?.numero ? paraE164(corpo.numero) : ''
  let conversaId: string | null = corpo?.conversaId ?? null

  if (conversaId) {
    const { data } = await supabase
      .from('conversas').select('id, numero').eq('id', conversaId).maybeSingle()
    if (!data) return erro('conversa não encontrada', 404)
    numero = data.numero
  } else if (!numero && corpo?.clienteId) {
    const { data } = await supabase
      .from('clientes').select('telefone').eq('id', corpo.clienteId).maybeSingle()
    numero = paraE164(data?.telefone)
  }

  if (!numero) return erro('número não encontrado ou inválido')

  // 2. Garantir a conversa ANTES de enviar. Se a mensagem sair e a gravação
  // falhar, o cliente recebe algo que não está no seu histórico — o pior dos
  // dois mundos. Criando antes, o registro sempre existe.
  if (!conversaId) {
    const { data: existente } = await supabase
      .from('conversas').select('id').eq('numero', numero).maybeSingle()

    if (existente) {
      conversaId = existente.id
    } else {
      const { data: criada, error: falha } = await supabase
        .from('conversas')
        .insert({ numero, cliente_id: corpo?.clienteId ?? null, instancia: INSTANCIA })
        .select('id').single()
      if (falha) return erro(`não foi possível abrir a conversa: ${falha.message}`, 500)
      conversaId = criada.id
    }
  }

  // 3. Enviar. `POST /send/text` com { number, text } — a instância vem do
  // token, não do caminho (ver _compartilhado/evolution.ts).
  const resposta = await chamarEvolution('/send/text', {
    metodo: 'POST',
    corpo: { number: numero, text: texto },
  })

  // O id que a Evolution devolve é o mesmo que voltará pelo webhook. Gravá-lo
  // aqui é o que evita a mensagem aparecer duas vezes: quando o evento chegar,
  // o unique do wa_message_id reconhece que ela já existe.
  const waId =
    resposta.corpo?.data?.Info?.ID ??
    resposta.corpo?.data?.id ??
    resposta.corpo?.id ??
    null

  const registro = {
    conversa_id: conversaId,
    wa_message_id: waId,
    direcao: 'saida',
    tipo: 'texto',
    texto,
    status: resposta.ok ? 'enviada' : 'falhou',
    // Guarda o motivo real da falha, e não um "erro ao enviar" genérico: sem
    // isso, descobrir que o número não existe no WhatsApp vira adivinhação.
    // A Evolution às vezes responde { error: '...' } sem `message` — String() de
    // um objeto gravava "[object Object]" e escondia justamente o motivo.
    erro: resposta.ok ? null : motivo(resposta.corpo).slice(0, 500),
    oportunidade_id: corpo?.oportunidadeId ?? null,
    enviado_por: corpo?.enviadoPor ?? null,
    ocorrido_em: new Date().toISOString(),
  }

  let { data: mensagem, error: falhaGravacao } = await supabase
    .from('mensagens').insert(registro).select('id').single()

  // O eco chegou primeiro. A Evolution dispara o evento SendMessage assim que a
  // mensagem sai — às vezes antes de esta função receber a resposta — e o
  // webhook grava a linha sem saber quem enviou nem de qual negociação. Aqui
  // ela é completada, em vez de o envio aparecer como "não gravado".
  if (falhaGravacao?.code === '23505' && waId) {
    const completada = await supabase
      .from('mensagens')
      .update({ enviado_por: registro.enviado_por, oportunidade_id: registro.oportunidade_id })
      .eq('wa_message_id', waId)
      .select('id').single()
    mensagem = completada.data
    falhaGravacao = completada.error
  }

  if (resposta.ok) {
    await supabase.from('conversas').update({
      ultima_em: registro.ocorrido_em,
      ultima_previa: texto.slice(0, 120),
    }).eq('id', conversaId)
  }

  if (!resposta.ok) {
    return json({
      erro: 'a Evolution recusou o envio',
      detalhe: registro.erro,
      conversaId,
      mensagemId: mensagem?.id ?? null,
    }, 502)
  }

  if (falhaGravacao) {
    // Saiu no WhatsApp mas não entrou no banco: é melhor dizer isso na cara do
    // que fingir sucesso e deixar um buraco silencioso no histórico.
    return json({
      aviso: 'mensagem enviada, mas não foi possível gravá-la no histórico',
      detalhe: falhaGravacao.message,
      conversaId,
    }, 207)
  }

  return json({ ok: true, conversaId, mensagemId: mensagem.id, waMessageId: waId })
})
