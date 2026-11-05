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
    perfilAtualCache = null
    return
  }
  const meta = user.user_metadata || {}
  usuarioAtualCache = meta.nome || meta.display_name || emailParaUsuario(user.email)
}

// Nome de quem está logado agora (ex.: 'Nando'); '' se ninguém.
export function usuarioAtual() {
  return usuarioAtualCache
}

// ---- Papel e unidade (migração 030) ----
//
// O perfil diz o que a pessoa pode fazer (papel) e de quem são os dados que ela
// vê (unidade). Quem filtra de verdade é o RLS no banco — a chave do navegador
// é pública, então esconder algo só na tela não protege nada. Aqui o papel
// serve para a interface se ajustar: menu, rótulos, filtros.

export const PAPEIS = {
  gestao: 'Gestão',
  distribuidor: 'Distribuidor',
}

// { papel, unidadeId, unidadeNome, unidadeTipo } ou null. Fica null quando a
// migração 030 ainda não rodou ou a conta não tem perfil — e as perguntas
// abaixo respondem "não" nesses casos, nunca "sim" por falta de informação.
let perfilAtualCache = null

// Chamado pelo repositório ao carregar os dados do login.
export function definirPerfilAtual(perfil) {
  perfilAtualCache = perfil || null
}

export const papelAtual = () => perfilAtualCache?.papel || ''
export const ehGestao = () => papelAtual() === 'gestao'
export const unidadeAtual = () => perfilAtualCache
  ? { id: perfilAtualCache.unidadeId, nome: perfilAtualCache.unidadeNome, tipo: perfilAtualCache.unidadeTipo }
  : null
