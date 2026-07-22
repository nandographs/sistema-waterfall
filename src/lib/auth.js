// Login por nome de usuário sobre o Supabase Auth (que é baseado em e-mail).
// O nome de usuário é convertido para um e-mail interno "usuario@waterfall.app"
// — invisível para quem usa. Também mantém, em memória, qual usuário está
// logado, para gravar a autoria (quem cadastrou) nos registros.

const DOMINIO = '@waterfall.app'

// "fernando" -> "fernando@waterfall.app". Se já vier um e-mail (contém @),
// usa como está — assim contas antigas com e-mail real continuam funcionando.
export function usuarioParaEmail(usuario) {
  const u = String(usuario || '').trim().toLowerCase()
  if (!u) return ''
  return u.includes('@') ? u : u + DOMINIO
}

// "fernando@waterfall.app" -> "fernando". Um e-mail de outro domínio volta inteiro.
export function emailParaUsuario(email) {
  const e = String(email || '').trim().toLowerCase()
  return e.endsWith(DOMINIO) ? e.slice(0, -DOMINIO.length) : e
}

let usuarioAtualCache = ''

// Chamado pelo App a cada mudança de sessão (login/logout). Recebe o objeto
// user do Supabase. Prefere o nome de exibição salvo no perfil (user_metadata),
// caindo para o nome de usuário derivado do e-mail.
export function definirUsuarioAtual(user) {
  if (!user) {
    usuarioAtualCache = ''
    return
  }
  const meta = user.user_metadata || {}
  usuarioAtualCache = meta.nome || meta.display_name || emailParaUsuario(user.email)
}

// Nome de quem está logado agora (ex.: 'Nando'); '' se ninguém.
export function usuarioAtual() {
  return usuarioAtualCache
}
