// Alternância de tema. O redesign nasceu escuro (o "cockpit"); o modo claro é
// opt-in e a escolha fica salva por navegador. O <html data-theme> é o que a
// folha de estilo lê — ver a seção "Temas" em src/index.css.

const CHAVE = 'waterfall:tema'

// 'escuro' | 'claro'. Sem escolha salva, o padrão é escuro.
export function lerTema() {
  try {
    const salvo = localStorage.getItem(CHAVE)
    return salvo === 'claro' || salvo === 'escuro' ? salvo : 'escuro'
  } catch {
    return 'escuro'
  }
}

export function aplicarTema(tema) {
  document.documentElement.dataset.theme = tema === 'claro' ? 'light' : 'dark'
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', tema === 'claro' ? '#ffffff' : '#08070d')
}

export function salvarTema(tema) {
  try {
    localStorage.setItem(CHAVE, tema)
  } catch {
    /* modo privado / storage bloqueado: aplica só nesta sessão */
  }
  aplicarTema(tema)
}
