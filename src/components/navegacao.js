import {
  IconDashboard, IconUsers, IconDroplet, IconCalendar,
  IconFileText, IconWallet, IconCheckSquare, IconFunil, IconMessage, IconUsersRound,
} from './icons.jsx'
import { ehGestao } from '../lib/auth.js'

// "Agenda" é o seu dia (contatos, tarefas, o calendário); "Serviços" são as
// ordens de serviço em campo — o que antes se chamava "Agendamentos". Os dois
// nomes juntos no menu confundiriam, e "Serviços" descreve melhor o que a
// tela sempre foi. Rota e tabela seguem com o nome antigo.
//
// `soGestao` some do menu de quem não é da gestão, e a rota passa a redirecionar
// (ver rotaPermitida). É ajuste de interface: o que protege os dados é o RLS
// da migração 031 — mesmo forçando o endereço, o distribuidor só veria vazio.
const TODOS_OS_LINKS = [
  { to: '/', label: 'Dashboard', Icon: IconDashboard },
  { to: '/agenda', label: 'Agenda', Icon: IconCalendar },
  { to: '/clientes', label: 'Clientes', Icon: IconUsers },
  { to: '/produtos', label: 'Produtos', Icon: IconDroplet },
  { to: '/agendamentos', label: 'Serviços', Icon: IconCheckSquare },
  // "CRM" antes de "Vendas" porque é essa a ordem do trabalho: a negociação vem
  // primeiro, o pedido é o desfecho dela. No código e nos comentários a tela
  // continua sendo o "funil" (Funil.jsx, resumoDoFunil, ETAPAS_FUNIL) — mesma
  // separação de "Serviços", cujo arquivo e tabela seguem como agendamentos.
  { to: '/crm', label: 'CRM', Icon: IconFunil },
  // O WhatsApp é o número da Waterfall: só a gestão atende por ele.
  { to: '/whatsapp', label: 'WhatsApp', Icon: IconMessage, soGestao: true },
  { to: '/vendas', label: 'Vendas', Icon: IconFileText },
  { to: '/financeiro', label: 'Financeiro', Icon: IconWallet, soGestao: true },
  { to: '/equipe', label: 'Equipe', Icon: IconUsersRound, soGestao: true },
]

// Funções, e não constantes: o papel só é conhecido depois do login, e este
// módulo é carregado antes dele.
export const linksDoMenu = () => TODOS_OS_LINKS.filter((l) => !l.soGestao || ehGestao())

export const rotaPermitida = (pathname) =>
  ehGestao() || !TODOS_OS_LINKS.some((l) => l.soGestao && pathname.startsWith(l.to))

// No celular só cabem 5 destinos com rótulo legível; os outros vão para o
// "Mais". A escolha dos 5 segue a frequência de uso em campo, não a ordem do
// menu de desktop — Produtos e Vendas são tarefas de escritório. Quem não vê o
// Financeiro ganha o CRM no lugar dele.
const ROTAS_BARRA_GESTAO = ['/', '/agenda', '/clientes', '/agendamentos', '/financeiro']
const ROTAS_BARRA_OUTROS = ['/', '/agenda', '/clientes', '/agendamentos', '/crm']
const rotasDaBarra = () => (ehGestao() ? ROTAS_BARRA_GESTAO : ROTAS_BARRA_OUTROS)

export const naBarra = () => linksDoMenu().filter((l) => rotasDaBarra().includes(l.to))
export const noMais = () => linksDoMenu().filter((l) => !rotasDaBarra().includes(l.to))

// Título da tela atual, para a topbar.
export function tituloDaRota(pathname) {
  if (pathname.startsWith('/clientes/')) return 'Cliente'
  return TODOS_OS_LINKS.find((l) => l.to === pathname)?.label ?? 'Waterfall'
}
