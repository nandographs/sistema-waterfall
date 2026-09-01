// Wallpapers do hero do dashboard.
// Os arquivos em src/assets/wallpapers são versões otimizadas dos originais
// BG1..BG5.jpg da raiz do projeto — gerados por `npm run wallpapers`.

import bg1 from '../assets/wallpapers/bg1.jpg'
import bg2 from '../assets/wallpapers/bg2.jpg'
import bg3 from '../assets/wallpapers/bg3.jpg'
import bg4 from '../assets/wallpapers/bg4.jpg'
import bg5 from '../assets/wallpapers/bg5.jpg'
import thumb1 from '../assets/wallpapers/bg1-thumb.jpg'
import thumb2 from '../assets/wallpapers/bg2-thumb.jpg'
import thumb3 from '../assets/wallpapers/bg3-thumb.jpg'
import thumb4 from '../assets/wallpapers/bg4-thumb.jpg'
import thumb5 from '../assets/wallpapers/bg5-thumb.jpg'

export const WALLPAPERS = [
  { id: 'bg1', nome: 'Cachoeira', src: bg1, thumb: thumb1 },
  { id: 'bg2', nome: 'Montanhas', src: bg2, thumb: thumb2 },
  { id: 'bg3', nome: 'Deserto', src: bg3, thumb: thumb3 },
  { id: 'bg4', nome: 'Serra nevada', src: bg4, thumb: thumb4 },
  { id: 'bg5', nome: 'Pico', src: bg5, thumb: thumb5 },
]

const CHAVE_SESSAO = 'waterfall:wallpaper'
const CHAVE_ULTIMO = 'waterfall:wallpaper-ultimo'

// O wallpaper do painel não é escolhido: ele avança um a cada novo acesso
// (login / abrir o sistema de novo) e fica fixo durante a sessão.
export function wallpaperDaSessao() {
  try {
    const jaEscolhido = sessionStorage.getItem(CHAVE_SESSAO)
    const atual = WALLPAPERS.find((w) => w.id === jaEscolhido)
    if (atual) return atual
  } catch {
    /* storage bloqueado: cai no sorteio abaixo */
  }

  let anterior = null
  try {
    anterior = localStorage.getItem(CHAVE_ULTIMO)
  } catch {
    /* ignore */
  }
  const idx = WALLPAPERS.findIndex((w) => w.id === anterior)
  const proximo = WALLPAPERS[(idx + 1) % WALLPAPERS.length]

  try {
    sessionStorage.setItem(CHAVE_SESSAO, proximo.id)
    localStorage.setItem(CHAVE_ULTIMO, proximo.id)
  } catch {
    /* ignore */
  }
  return proximo
}
