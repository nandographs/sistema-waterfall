// Alternância de tema. O desenho é a galeria branca da Apple, então o CLARO é o
// padrão; o escuro é opt-in e a escolha fica salva por navegador. O
// <html data-theme> é o que a folha de estilo lê — ver a seção "Temas" em
// src/index.css.

const CHAVE = 'waterfall:tema'

// 'claro' | 'escuro'. Sem escolha salva, o padrão é claro.
export function lerTema() {
  try {
    const salvo = localStorage.getItem(CHAVE)
    return salvo === 'claro' || salvo === 'escuro' ? salvo : 'claro'
  } catch {
    return 'claro'
  }
}

export function aplicarTema(tema) {
  document.documentElement.dataset.theme = tema === 'escuro' ? 'dark' : 'light'
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', tema === 'escuro' ? '#000000' : '#ffffff')
}

export function salvarTema(tema) {
  try {
    localStorage.setItem(CHAVE, tema)
  } catch {
    /* modo privado / storage bloqueado: aplica só nesta sessão */
  }
  aplicarTema(tema)
}
