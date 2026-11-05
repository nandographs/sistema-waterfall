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
