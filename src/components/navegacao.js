import {
  IconDashboard, IconUsers, IconDroplet, IconCalendar,
  IconFileText, IconWallet, IconCheckSquare, IconFunil, IconMessage,
} from './icons.jsx'

// "Agenda" é o seu dia (contatos, tarefas, o calendário); "Serviços" são as
// ordens de serviço em campo — o que antes se chamava "Agendamentos". Os dois
// nomes juntos no menu confundiriam, e "Serviços" descreve melhor o que a
// tela sempre foi. Rota e tabela seguem com o nome antigo.
export const LINKS = [
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
  // PRÉVIA: a tela existe com dados fictícios enquanto a Evolution Go não está
  // no ar (ver CRM_WHATSAPP.md). Tirar esta linha esconde a tela do menu sem
  // quebrar nada — a rota continua acessível por endereço.
  { to: '/whatsapp', label: 'WhatsApp', Icon: IconMessage },
  { to: '/vendas', label: 'Vendas', Icon: IconFileText },
  { to: '/financeiro', label: 'Financeiro', Icon: IconWallet },
]

// No celular só cabem 5 destinos com rótulo legível; os outros dois vão para o
// "Mais". A escolha dos 5 segue a frequência de uso em campo, não a ordem do
// menu de desktop — Produtos e Vendas são tarefas de escritório.
const ROTAS_BARRA = ['/', '/agenda', '/clientes', '/agendamentos', '/financeiro']

export const NA_BARRA = LINKS.filter((l) => ROTAS_BARRA.includes(l.to))
export const NO_MAIS = LINKS.filter((l) => !ROTAS_BARRA.includes(l.to))

// Título da tela atual, para a topbar.
export function tituloDaRota(pathname) {
  if (pathname.startsWith('/clientes/')) return 'Cliente'
  return LINKS.find((l) => l.to === pathname)?.label ?? 'Waterfall'
}
