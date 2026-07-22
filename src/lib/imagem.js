// Utilidades de imagem compartilhadas: compressão e URLs assinadas do bucket
// privado. Usado tanto pela galeria de fotos (fotos.js) quanto pelas fotos
// únicas de perfil do cliente e do produto (repository.js).

import imageCompression from 'browser-image-compression'
import { supabase } from './supabaseClient.js'

export const BUCKET = 'fotos-clientes'
export const VALIDADE_URL = 28800 // 8h — cobre uma jornada de trabalho sem expirar

// Fotos de celular chegam com 5–12 MB; comprimimos no próprio aparelho antes
// de subir. A biblioteca também corrige a orientação (foto em pé não sai deitada).
const PADRAO = { maxSizeMB: 0.5, maxWidthOrHeight: 1600, useWebWorker: true, fileType: 'image/jpeg' }

export function comprimir(arquivo, opcoes = {}) {
  return imageCompression(arquivo, { ...PADRAO, ...opcoes })
}

// URL temporária para exibir uma imagem do bucket privado.
export async function assinarUrl(caminho) {
  if (!caminho) return ''
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(caminho, VALIDADE_URL)
  if (error) throw error
  return data.signedUrl
}

// Assina vários caminhos numa única requisição; devolve um mapa caminho -> url.
export async function assinarVarias(caminhos) {
  const limpos = [...new Set(caminhos.filter(Boolean))]
  if (limpos.length === 0) return {}
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(limpos, VALIDADE_URL)
  if (error) throw error
  const mapa = {}
  for (const item of data) if (item.signedUrl) mapa[item.path] = item.signedUrl
  return mapa
}
