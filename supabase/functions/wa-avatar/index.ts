// Busca as fotos de perfil do WhatsApp das conversas.
//
// Quem chama é a tela do WhatsApp, ao abrir. Exige login (verify_jwt), porque
// quem pergunta "qual é a foto deste número?" está usando a instância — e a
// instância é o WhatsApp da empresa.
//
// POR QUE ESTA FUNÇÃO EXISTE, se o webhook já busca a foto do número novo:
// pelas conversas que JÁ existiam quando esta funcionalidade entrou (nenhuma
// delas passou pelo webhook novo) e pelas que envelheceram — a pessoa trocou de
// foto e a nossa cópia ficou velha. Ver VALIDADE_DIAS em _compartilhado/avatar.ts.
//
// O LIMITE POR CHAMADA é o ponto de projeto aqui. A Evolution fala com um único
// aparelho pareado; a sincronização é em fila, uma conversa por vez. Sem teto, a
// primeira abertura de uma caixa de entrada com 400 conversas seguraria a função
// até estourar o tempo. Com teto, a tela pede de novo na próxima abertura e a
// fila anda sozinha ao longo dos dias.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { configuracaoAusente, json, erro, preflight } from '../_compartilhado/evolution.ts'
import { sincronizarVarios, VALIDADE_DIAS } from '../_compartilhado/avatar.ts'

const TETO = 40

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async (req) => {
  const opcoes = preflight(req)
  if (opcoes) return opcoes

  const faltando = configuracaoAusente()
  if (faltando) return erro(faltando, 500)

  let corpo: any = {}
  try {
    corpo = await req.json()
  } catch { /* chamada sem corpo: usa os padrões */ }

  const forcar = corpo?.forcar === true
  const limite = Math.min(Number(corpo?.limite) || TETO, TETO)

  let consulta = supabase
    .from('conversas')
    .select('id, numero, avatar_id, avatar_path')
    .not('numero', 'is', null)

  if (Array.isArray(corpo?.conversaIds) && corpo.conversaIds.length) {
    // Pedido específico: "confere a foto desta conversa aqui" — é o que a tela
    // usa no botão de atualizar dentro de uma conversa aberta.
    consulta = consulta.in('id', corpo.conversaIds.slice(0, TETO))
  } else {
    // Varredura padrão: as mais recentes primeiro, porque são as que alguém
    // está de fato olhando.
    const vencidoEm = new Date(Date.now() - VALIDADE_DIAS * 86400_000).toISOString()
    consulta = consulta
      // Dois `or` viram um E entre os grupos, que é exatamente o que queremos:
      // (não marcado como sem foto) E (nunca conferido OU conferido faz tempo).
      // O `is.null` do primeiro grupo cobre linhas antigas, de antes da coluna
      // existir.
      .or('avatar_ausente.is.null,avatar_ausente.eq.false')
      .or(`avatar_em.is.null,avatar_em.lt.${vencidoEm}`)
      .order('ultima_em', { ascending: false, nullsFirst: false })
      .limit(limite)
  }

  const { data, error } = await consulta
  if (error) return erro(`não foi possível ler as conversas: ${error.message}`, 500)
  if (!data?.length) return json({ conferidas: 0, atualizadas: 0 })

  const resultado = await sincronizarVarios(data, { forcar })
  return json(resultado)
})
