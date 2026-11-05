// Cria o login de quem vai usar o sistema e troca a senha dele.
//
// Precisa ser uma Edge Function porque as duas coisas exigem a chave de
// administrador do Supabase (service_role), e essa chave não pode ir para o
// navegador — mesmo raciocínio da Evolution em wa-enviar. Quem chama é a tela
// de Equipe (src/pages/Equipe.jsx).
//
// `verify_jwt` garante que quem chamou está logado; `exigirGestao` garante que
// é da gestão. Sem a segunda, qualquer distribuidor criaria um acesso de gestão
// para si mesmo e veria a base inteira.
//
// Corpo:
//   { acao: 'criar', usuario, senha, nome?, papel: 'gestao'|'distribuidor'|'', unidadeId? }
//   { acao: 'senha', userId, senha }

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { json, erro, preflight } from '../_compartilhado/evolution.ts'
import { exigirGestao } from '../_compartilhado/acesso.ts'

// O mesmo domínio interno de src/lib/auth.js: quem entra digita "joao", e o
// Supabase Auth, que só conhece e-mail, recebe "joao@waterfall.app".
const DOMINIO = '@waterfall.app'
const LOGIN_VALIDO = /^[a-z0-9._-]+$/
const SENHA_MINIMA = 6

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)

// Gestão fica sempre na Waterfall; distribuidor, numa unidade de distribuidor;
// sem papel, em lugar nenhum. É a mesma regra da tela — repetida aqui porque o
// navegador não é quem decide.
async function unidadeDoPapel(papel: string, unidadeId: string | null): Promise<string | null | Error> {
  if (papel === 'gestao') {
    const { data } = await admin.from('unidades').select('id').eq('tipo', 'casa').maybeSingle()
    return data?.id ?? new Error('a unidade da Waterfall não existe — rode a migração 030')
  }
  if (papel === 'distribuidor') {
    if (!unidadeId) return new Error('escolha a unidade do distribuidor')
    const { data } = await admin.from('unidades').select('id, tipo').eq('id', unidadeId).maybeSingle()
    if (data?.tipo !== 'distribuidor') return new Error('unidade de distribuidor inválida')
    return data.id
  }
  return null
}

async function criar(corpo: any): Promise<Response> {
  const usuario = String(corpo?.usuario ?? '').trim().toLowerCase()
  const senha = String(corpo?.senha ?? '')
  const nome = String(corpo?.nome ?? '').trim() || usuario
  const papel = ['gestao', 'distribuidor'].includes(corpo?.papel) ? corpo.papel : ''

  if (!LOGIN_VALIDO.test(usuario)) return erro('usuário inválido: use letras sem acento, números, ponto, hífen ou sublinhado')
  if (senha.length < SENHA_MINIMA) return erro(`a senha precisa de pelo menos ${SENHA_MINIMA} caracteres`)

  const unidade = await unidadeDoPapel(papel, corpo?.unidadeId ?? null)
  if (unidade instanceof Error) return erro(unidade.message)

  const { data: criado, error: falha } = await admin.auth.admin.createUser({
    email: usuario + DOMINIO,
    password: senha,
    // Não há caixa de entrada nenhuma em @waterfall.app: sem confirmar aqui, o
    // login ficaria esperando um e-mail que nunca chega.
    email_confirm: true,
    user_metadata: { nome },
  })
  if (falha || !criado?.user) {
    const jaExiste = /already|registered|exists/i.test(falha?.message ?? '')
    return erro(jaExiste ? `o usuário "${usuario}" já existe` : `não foi possível criar: ${falha?.message}`)
  }

  // O trigger da migração 030 já criou o perfil, sem papel. Aqui ele ganha o
  // papel e a unidade escolhidos.
  const { error: falhaPerfil } = await admin
    .from('perfis')
    .update({ nome, usuario, papel: papel || null, unidade_id: unidade })
    .eq('user_id', criado.user.id)

  if (falhaPerfil) {
    // Login sem perfil configurado é pior do que login nenhum: a pessoa entra e
    // não vê nada, sem saber por quê. Desfaz e devolve o motivo.
    await admin.auth.admin.deleteUser(criado.user.id)
    return erro(`não foi possível configurar o acesso: ${falhaPerfil.message}`, 500)
  }

  return json({ ok: true, userId: criado.user.id })
}

async function trocarSenha(corpo: any): Promise<Response> {
  const userId = String(corpo?.userId ?? '')
  const senha = String(corpo?.senha ?? '')
  if (!userId) return erro('qual usuário?')
  if (senha.length < SENHA_MINIMA) return erro(`a senha precisa de pelo menos ${SENHA_MINIMA} caracteres`)

  const { error: falha } = await admin.auth.admin.updateUserById(userId, { password: senha })
  if (falha) return erro(`não foi possível trocar a senha: ${falha.message}`)
  return json({ ok: true })
}

Deno.serve(async (req) => {
  const opcoes = preflight(req)
  if (opcoes) return opcoes

  const recusa = await exigirGestao(req, 'só a gestão cria e altera acessos')
  if (recusa) return recusa

  let corpo: any
  try {
    corpo = await req.json()
  } catch {
    return erro('corpo inválido')
  }

  if (corpo?.acao === 'criar') return criar(corpo)
  if (corpo?.acao === 'senha') return trocarSenha(corpo)
  return erro('ação desconhecida')
})
