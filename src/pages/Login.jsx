import { useState } from 'react'
import { inputCls } from '../components/ui.jsx'
import { IconEye, IconEyeOff } from '../components/icons.jsx'
import loginBg from '../assets/login-bg.jpg'
import logo from '../assets/logo.svg'
import { supabase } from '../lib/supabaseClient.js'
import { usuarioParaEmail } from '../lib/auth.js'

// Login por nome de usuário sobre o Supabase Auth. O usuário digitado é
// convertido para o e-mail interno (ver lib/auth.js). Ao ter sucesso, o
// listener em App.jsx (onAuthStateChange) percebe a sessão e libera a
// navegação sozinho.
export default function Login() {
  const [usuario, setUsuario] = useState('')
  const [senha, setSenha] = useState('')
  const [mostrarSenha, setMostrarSenha] = useState(false)
  const [erro, setErro] = useState('')
  const [entrando, setEntrando] = useState(false)

  async function entrar(e) {
    e.preventDefault()
    setErro('')
    setEntrando(true)
    const { error } = await supabase.auth.signInWithPassword({
      email: usuarioParaEmail(usuario),
      password: senha,
    })
    setEntrando(false)
    if (error) setErro('Usuário ou senha inválidos.')
  }

  return (
    <div className="login-shell min-h-screen flex bg-[var(--surface-base)] text-slate-900">
      {/* Coluna do formulário */}
      <div className="w-full lg:w-[460px] shrink-0 flex flex-col justify-center px-6 sm:px-14 py-12 bg-[var(--surface-nav)] border-r border-slate-200">
        <div className="mb-10">
          <img src={logo} alt="Waterfall" className="h-10 w-auto logo-mark" />
        </div>

        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Entrar</h1>
        <p className="text-sm text-slate-500 mt-2">Acesse sua conta para continuar.</p>

        <form onSubmit={entrar} className="mt-8 space-y-5">
          <div>
            <label htmlFor="login-usuario" className="block text-[13px] font-medium text-slate-700 mb-1.5">Usuário</label>
            <input
              id="login-usuario"
              className={inputCls}
              placeholder="seu.usuario"
              value={usuario}
              onChange={(e) => { setUsuario(e.target.value); setErro('') }}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="login-senha" className="block text-[13px] font-medium text-slate-700">Senha</label>
            </div>
            <div className="relative">
              <input
                id="login-senha"
                className={inputCls + ' pr-10'}
                type={mostrarSenha ? 'text' : 'password'}
                placeholder="••••••••••••"
                value={senha}
                onChange={(e) => { setSenha(e.target.value); setErro('') }}
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setMostrarSenha((v) => !v)}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex h-11 w-11 items-center justify-center text-slate-400 hover:text-slate-700 cursor-pointer"
                aria-label={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}
              >
                {mostrarSenha ? <IconEyeOff size={18} /> : <IconEye size={18} />}
              </button>
            </div>
          </div>

          {erro && (
            <p role="alert" aria-live="polite" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{erro}</p>
          )}

          <button
            type="submit"
            disabled={entrando}
            className="w-full min-h-11 rounded-xl bg-blue-500 text-[var(--btn-primary-fg)] font-bold py-2.5 hover:bg-blue-600 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {entrando ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        <p className="text-xs text-slate-400 mt-10 leading-relaxed">
          Ao entrar, você concorda com nossos Termos de Uso e Política de Privacidade.
        </p>
      </div>

      {/* Coluna da imagem */}
      <div className="hidden lg:block flex-1 relative overflow-hidden">
        <img src={loginBg} alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-[#08070d]/45" />
        <div className="absolute inset-x-10 bottom-10 rounded-2xl border border-white/15 bg-black/45 px-6 py-5 backdrop-blur-sm">
          <p className="text-sm font-semibold text-white">Toda a operação, no mesmo fluxo.</p>
          <p className="mt-1 text-sm text-white/70">Do primeiro contato à próxima troca de refil.</p>
        </div>
      </div>
    </div>
  )
}
