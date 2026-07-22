import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Clientes from './pages/Clientes.jsx'
import ClienteDetalhe from './pages/ClienteDetalhe.jsx'
import Produtos from './pages/Produtos.jsx'
import Agendamentos from './pages/Agendamentos.jsx'
import TopNav from './components/TopNav.jsx'
import WallpaperPicker from './components/WallpaperPicker.jsx'
import { lerWallpaper, salvarWallpaper, WALLPAPERS } from './data/wallpapers.js'
import { supabase } from './lib/supabaseClient.js'
import { carregarDados } from './data/repository.js'
import { definirUsuarioAtual } from './lib/auth.js'

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
  const location = useLocation()
  const naDashboard = location.pathname === '/'

  // O wallpaper é o fundo apenas do dashboard; o estado vive aqui para o
  // botão "Mudar wallpaper" do menu superior poder controlá-lo.
  const [wallpaperId, setWallpaperId] = useState(() => lerWallpaper().id)
  const [pickerAberto, setPickerAberto] = useState(false)
  const wallpaper = WALLPAPERS.find((w) => w.id === wallpaperId) ?? WALLPAPERS[0]

  function escolherWallpaper(id) {
    setWallpaperId(id)
    salvarWallpaper(id)
    setPickerAberto(false)
  }

  return (
    <div className="min-h-screen relative flex flex-col">
      {/* Fundo com wallpaper apenas no dashboard.
          absolute inset-0 no wrapper relative: cobre toda a altura e fica
          atrás do conteúdo (que sobe com z-10), sem depender de z negativo. */}
      {naDashboard && (
        <div className="absolute inset-0">
          <img src={wallpaper.src} alt="" aria-hidden="true" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-slate-900/70" />
        </div>
      )}

      <div className="relative z-10">
        <TopNav
          naDashboard={naDashboard}
          onMudarWallpaper={() => setPickerAberto(true)}
          onSair={onSair}
        />
      </div>

      <main className="flex-1 relative z-10">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/clientes" element={<Clientes />} />
          <Route path="/clientes/:id" element={<ClienteDetalhe />} />
          <Route path="/produtos" element={<Produtos />} />
          <Route path="/agendamentos" element={<Agendamentos />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <WallpaperPicker
        open={pickerAberto}
        onClose={() => setPickerAberto(false)}
        atual={wallpaperId}
        onSelecionar={escolherWallpaper}
      />
    </div>
  )
}

export default function App() {
  // sessao: undefined = ainda verificando; null = deslogado; objeto = logado
  const [sessao, setSessao] = useState(undefined)
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
    const { data: assinatura } = supabase.auth.onAuthStateChange((_evento, novaSessao) => {
      definirUsuarioAtual(novaSessao?.user)
      setSessao(novaSessao)
    })
    return () => assinatura.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!sessao) return
    setDadosProntos(false)
    setErroCarregamento('')
    carregarDados()
      .then(() => setDadosProntos(true))
      .catch((erro) => setErroCarregamento(erro.message || String(erro)))
  }, [sessao])

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
