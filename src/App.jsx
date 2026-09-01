import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Clientes from './pages/Clientes.jsx'
import ClienteDetalhe from './pages/ClienteDetalhe.jsx'
import Produtos from './pages/Produtos.jsx'
import Agendamentos from './pages/Agendamentos.jsx'
import Agenda from './pages/Agenda.jsx'
import Funil from './pages/Funil.jsx'
import WhatsApp from './pages/WhatsApp.jsx'
import Vendas from './pages/Vendas.jsx'
import Financeiro from './pages/Financeiro.jsx'
import TopNav, { BottomNav } from './components/TopNav.jsx'
import Sidebar from './components/Sidebar.jsx'
import { wallpaperDaSessao } from './data/wallpapers.js'
import { supabase } from './lib/supabaseClient.js'
import { carregarDados } from './data/repository.js'
import { definirUsuarioAtual } from './lib/auth.js'
import { Toasts } from './components/ui.jsx'
import { lerTema, salvarTema } from './lib/tema.js'

function TelaCarregando() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <p className="text-sm text-slate-400">Carregando…</p>
    </div>
  )
}

function TelaErro({ mensagem, onSair }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="max-w-md text-center">
        <p className="text-sm font-medium text-red-600 mb-1">Não foi possível carregar os dados.</p>
        <p className="text-xs text-slate-500 mb-4">{mensagem}</p>
        <button
          onClick={onSair}
          className="text-xs font-medium text-blue-600 hover:underline cursor-pointer"
        >
          Sair e tentar novamente
        </button>
      </div>
    </div>
  )
}

function AppLayout({ onSair }) {
  // O wallpaper do hero do dashboard avança sozinho a cada acesso e fica fixo
  // pela sessão — ver wallpaperDaSessao().
  const [wallpaper] = useState(wallpaperDaSessao)

  // Estrutura do template: sidebar fixa à esquerda no desktop, conteúdo rolando
  // ao lado. O estado de colapso persiste — é preferência de quem usa, não do
  // sistema, e reabrir sempre expandida seria irritante.
  const [sidebarColapsada, setSidebarColapsada] = useState(
    () => localStorage.getItem('sidebarColapsada') === '1'
  )

  function alternarSidebar() {
    setSidebarColapsada((v) => {
      localStorage.setItem('sidebarColapsada', v ? '0' : '1')
      return !v
    })
  }

  const [tema, setTema] = useState(lerTema)
  function alternarTema() {
    setTema((atual) => {
      const proximo = atual === 'claro' ? 'escuro' : 'claro'
      salvarTema(proximo)
      return proximo
    })
  }

  return (
    <div className="app-shell min-h-svh flex bg-slate-50">
      <Sidebar
        colapsada={sidebarColapsada}
        onAlternar={alternarSidebar}
        onSair={onSair}
      />

      <div className="flex-1 min-w-0 flex flex-col bg-transparent">
        <TopNav tema={tema} onAlternarTema={alternarTema} />

        <main className="flex-1">
          <Routes>
            <Route path="/" element={<Dashboard wallpaper={wallpaper} />} />
            <Route path="/clientes" element={<Clientes />} />
            <Route path="/clientes/:id" element={<ClienteDetalhe />} />
            <Route path="/produtos" element={<Produtos />} />
            <Route path="/agenda" element={<Agenda />} />
            <Route path="/agendamentos" element={<Agendamentos />} />
            <Route path="/crm" element={<Funil />} />
            <Route path="/whatsapp" element={<WhatsApp />} />
            <Route path="/vendas" element={<Vendas />} />
            <Route path="/financeiro" element={<Financeiro />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>

      <BottomNav onSair={onSair} />
      <Toasts />
    </div>
  )
}

export default function App() {
  // sessao: undefined = ainda verificando; null = deslogado; objeto = logado
  const [sessao, setSessao] = useState(undefined)
  // Quem está logado, para o efeito de carga: '' = ninguém. Depender disso (e
  // não do objeto sessao) evita recarregar tudo quando o Supabase apenas renova
  // o token — o que ele faz sempre que a aba/app volta ao foco.
  const usuarioId = sessao === undefined ? undefined : (sessao?.user?.id ?? '')
  const [dadosProntos, setDadosProntos] = useState(false)
  const [erroCarregamento, setErroCarregamento] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      definirUsuarioAtual(data.session?.user)
      setSessao(data.session)
      // A sessão salva pode ter dados de perfil defasados (ex.: nome alterado
      // depois do login). Busca o usuário fresco do servidor e atualiza.
      if (data.session) {
        supabase.auth.getUser().then(({ data: atual }) => {
          if (atual?.user) {
            definirUsuarioAtual(atual.user)
            setSessao((s) => (s ? { ...s, user: atual.user } : s))
          }
        })
      }
    })
    const { data: assinatura } = supabase.auth.onAuthStateChange((evento, novaSessao) => {
      definirUsuarioAtual(novaSessao?.user)
      // TOKEN_REFRESHED e SIGNED_IN disparam sozinhos quando a aba volta ao
      // foco (ou o app volta do segundo plano no celular). Trocar o objeto da
      // sessão nesses casos remontava a tela inteira e recarregava o banco.
      // Só troca quando muda de fato quem está logado.
      setSessao((atual) => {
        if (evento === 'TOKEN_REFRESHED') return atual
        if (atual && novaSessao && atual.user?.id === novaSessao.user?.id) {
          return evento === 'USER_UPDATED' ? { ...atual, user: novaSessao.user } : atual
        }
        return novaSessao
      })
    })
    return () => assinatura.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!usuarioId) return
    setDadosProntos(false)
    setErroCarregamento('')
    carregarDados()
      .then(() => setDadosProntos(true))
      .catch((erro) => setErroCarregamento(erro.message || String(erro)))
  }, [usuarioId])

  function sair() {
    supabase.auth.signOut()
  }

  if (sessao === undefined) return <TelaCarregando />

  if (!sessao) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    )
  }

  if (erroCarregamento) return <TelaErro mensagem={erroCarregamento} onSair={sair} />

  if (!dadosProntos) return <TelaCarregando />

  return <AppLayout onSair={sair} />
}
