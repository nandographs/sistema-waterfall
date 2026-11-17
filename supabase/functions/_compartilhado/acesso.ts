// Quem pode usar o WhatsApp da empresa.
//
// `verify_jwt` só garante que a chamada veio de alguém LOGADO. Desde a
// migração 031 isso não basta: um distribuidor também está logado, e o número
// conectado na Evolution é o da Waterfall. Sem esta conferência, ele mandaria
// mensagem em nome da Waterfall ou leria o QR e parearia o próprio celular no
// lugar do número da empresa.
//
// A pergunta vai ao banco com o token de quem chamou — é a mesma `eh_gestao()`
// que as políticas usam, então a função e o RLS nunca discordam.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { erro } from './evolution.ts'

export type Quem = { userId: string; nome: string; gestao: boolean; unidadeId: string | null }

// Quem está chamando — para o WhatsApp, que desde a migração 034 deixou de ser
// só da gestão: cada pessoa usa o próprio número, e a gestão usa qualquer um.
// Devolve a recusa pronta quando a pessoa não tem acesso liberado.
export async function quemChamou(req: Request): Promise<{ quem?: Quem; recusa?: Response }> {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
  )
  const { data: usuario } = await supabase.auth.getUser()
  if (!usuario?.user) return { recusa: erro('sessão expirada — entre de novo', 401) }

  const { data: perfil, error } = await supabase
    .from('perfis').select('nome, papel, unidade_id, ativo').eq('user_id', usuario.user.id).maybeSingle()
  if (error) return { recusa: erro(`não foi possível conferir o acesso: ${error.message}`, 500) }
  if (!perfil?.papel || !perfil.ativo) return { recusa: erro('seu acesso ainda não foi liberado pela gestão', 403) }

  return {
    quem: {
      userId: usuario.user.id,
      nome: perfil.nome ?? '',
      gestao: perfil.papel === 'gestao',
      unidadeId: perfil.unidade_id ?? null,
    },
  }
}

// A gestão usa qualquer número; os outros, só o próprio.
export const podeUsar = (quem: Quem, instancia: { dono_id: string | null }) =>
  quem.gestao || instancia.dono_id === quem.userId

// Devolve a resposta de recusa, ou null quando pode seguir. `recusa` é o motivo
// que a tela mostra — a mesma conferência serve à função de usuários.
export async function exigirGestao(
  req: Request,
  recusa = 'o WhatsApp da empresa é só da gestão',
): Promise<Response | null> {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
  )
  const { data, error } = await supabase.rpc('eh_gestao')
  if (error) return erro(`não foi possível conferir o acesso: ${error.message}`, 500)
  if (data !== true) return erro(recusa, 403)
  return null
}
