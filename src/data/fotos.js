// Galeria de fotos do cliente.
// As imagens ficam no Supabase Storage (bucket privado 'fotos-clientes');
// a tabela 'fotos' guarda só o caminho do arquivo + metadados. Como o bucket
// é privado, cada exibição usa uma URL assinada temporária (expira em 1h).

import { supabase } from '../lib/supabaseClient.js'
import { BUCKET, comprimir, assinarUrl } from '../lib/imagem.js'

function paraApp(linha) {
  return {
    id: linha.id,
    clienteId: linha.cliente_id,
    agendamentoId: linha.agendamento_id ?? '',
    caminho: linha.caminho,
    legenda: linha.legenda ?? '',
    criadoEm: linha.criado_em,
  }
}

// Lista as fotos de um cliente (mais recentes primeiro), já com a URL de exibição.
export async function listarFotos(clienteId) {
  const { data, error } = await supabase
    .from('fotos')
    .select('*')
    .eq('cliente_id', clienteId)
    .order('criado_em', { ascending: false })
  if (error) throw error
  return Promise.all(
    data.map(async (linha) => ({ ...paraApp(linha), url: await assinarUrl(linha.caminho) })),
  )
}

// Comprime, sobe ao Storage e grava a linha no banco. Retorna a foto já pronta
// para exibir (com URL assinada).
export async function adicionarFoto(clienteId, arquivo, { legenda = '', agendamentoId = '' } = {}) {
  const comprimida = await comprimir(arquivo)
  const nome = `${crypto.randomUUID()}.jpg`
  const caminho = `${clienteId}/${nome}`

  const { error: erroUpload } = await supabase.storage
    .from(BUCKET)
    .upload(caminho, comprimida, { contentType: 'image/jpeg' })
  if (erroUpload) throw erroUpload

  const { data, error } = await supabase
    .from('fotos')
    .insert({
      cliente_id: clienteId,
      agendamento_id: agendamentoId || null,
      caminho,
      legenda: legenda || null,
    })
    .select()
    .single()
  if (error) {
    // Se a linha falhar, remove o arquivo órfão do Storage.
    await supabase.storage.from(BUCKET).remove([caminho])
    throw error
  }

  return { ...paraApp(data), url: await assinarUrl(caminho) }
}

export async function atualizarLegenda(id, legenda) {
  const { error } = await supabase.from('fotos').update({ legenda: legenda || null }).eq('id', id)
  if (error) throw error
}

// Remove do banco e do Storage (o arquivo não pode ficar órfão).
export async function removerFoto(foto) {
  const { error } = await supabase.from('fotos').delete().eq('id', foto.id)
  if (error) throw error
  await supabase.storage.from(BUCKET).remove([foto.caminho])
}
