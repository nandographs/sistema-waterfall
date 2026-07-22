// Gera versões web dos wallpapers do dashboard a partir dos originais BG1..BG5.jpg
// (que são fotos em altíssima resolução, pesadas demais para o navegador).
// Uso: npm run wallpapers

import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const destino = resolve(raiz, 'src/assets/wallpapers')

await mkdir(destino, { recursive: true })

for (let i = 1; i <= 5; i++) {
  const origem = resolve(raiz, `BG${i}.jpg`)

  // Imagem do hero: larga o suficiente para telas grandes/retina
  await sharp(origem)
    .resize({ width: 2000, withoutEnlargement: true })
    .jpeg({ quality: 78, mozjpeg: true })
    .toFile(resolve(destino, `bg${i}.jpg`))

  // Miniatura usada no seletor de wallpaper
  await sharp(origem)
    .resize({ width: 480, height: 270, fit: 'cover' })
    .jpeg({ quality: 70, mozjpeg: true })
    .toFile(resolve(destino, `bg${i}-thumb.jpg`))

  console.log(`bg${i}: ok`)
}
