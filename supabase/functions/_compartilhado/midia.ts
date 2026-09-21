// Foto, áudio, vídeo e documento que chegam (ou saem) pelo WhatsApp.
//
// A MÍDIA NÃO VEM NO WEBHOOK. O evento traz só a "receita" dela — onde está no
// servidor do WhatsApp e a chave para decifrar (`mediaKey`, `directPath`). Quem
// sabe transformar isso no arquivo é a Evolution, pela rota
//   POST /message/downloadmedia   com  { message: <o objeto Message do evento> }
// conferida no Swagger da instância. Não existe opção de mandar a mídia pronta
// dentro do webhook (os ajustes avançados da instância não têm isso).
//
// POR QUE GUARDAR E NÃO LINKAR: o arquivo no servidor do WhatsApp é cifrado e
// some depois de um tempo. Baixamos uma vez e guardamos no bucket privado
// `whatsapp-midia`, no mesmo esquema das fotos de perfil: o banco guarda o
// caminho, e a tela pede uma URL assinada na hora de exibir.
//
// A resposta da rota é lida com tolerância — ela pode vir como o arquivo cru ou
// como JSON com o conteúdo em base64, conforme a versão. O `content-type` decide.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { chamarEvolutionBinario } from './evolution.ts'

const BUCKET = 'whatsapp-midia'

// Teto por arquivo. Foto e áudio ficam na casa das centenas de KB; o que passa
// disso é vídeo. A função de borda tem memória limitada e o arquivo inteiro fica
// nela durante o upload — um vídeo de 60 MB derrubaria a execução no meio, e a
// mensagem ficaria sem mídia de qualquer jeito. Melhor recusar com clareza.
const TETO_BYTES = 16 * 1024 * 1024

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// Onde mora a "receita" de cada tipo dentro do objeto Message.
const CHAVES_DE_MIDIA = [
  'imageMessage', 'audioMessage', 'videoMessage', 'documentMessage', 'stickerMessage',
  'documentWithCaptionMessage',
]

function subMensagem(mensagem: any): any {
  for (const chave of CHAVES_DE_MIDIA) {
    const sub = mensagem?.[chave]
    if (!sub) continue
    // Documento com legenda vem embrulhado um nível a mais.
    if (chave === 'documentWithCaptionMessage') return sub?.message?.documentMessage ?? null
    return sub
  }
  return null
}

export function temMidia(mensagem: any): boolean {
  return !!subMensagem(mensagem)
}

const EXTENSOES: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/amr': 'amr',
  'video/mp4': 'mp4', 'video/3gpp': '3gp',
  'application/pdf': 'pdf',
}

function extensao(mimetype: string, nomeArquivo = ''): string {
  const doNome = /\.([a-z0-9]{1,5})$/i.exec(nomeArquivo)?.[1]
  if (doNome) return doNome.toLowerCase()
  // "audio/ogg; codecs=opus" -> "audio/ogg"
  const base = mimetype.split(';')[0].trim().toLowerCase()
  return EXTENSOES[base] ?? (base.split('/')[1] || 'bin')
}

// Procura o base64 nos lugares em que as versões da Evolution já o puseram.
function lerBase64(corpo: any): { base64: string; mimetype: string } | null {
  const fontes = [corpo?.data, corpo, corpo?.data?.data, corpo?.result]
  for (const fonte of fontes) {
    if (!fonte) continue
    if (typeof fonte === 'string' && fonte.length > 100) return { base64: fonte, mimetype: '' }
    const b64 = fonte.base64 ?? fonte.Base64 ?? fonte.file ?? fonte.data ?? fonte.media
    if (typeof b64 === 'string' && b64.length > 100) {
      return { base64: b64, mimetype: String(fonte.mimetype ?? fonte.mimeType ?? fonte.Mimetype ?? '') }
    }
  }
  return null
}

function base64ParaBytes(texto: string): Uint8Array {
  // Tira um eventual prefixo "data:image/jpeg;base64,".
  const limpo = texto.includes(',') && texto.startsWith('data:') ? texto.split(',')[1] : texto
  const binario = atob(limpo)
  const bytes = new Uint8Array(binario.length)
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i)
  return bytes
}

// Baixa a mídia de UMA mensagem e amarra o arquivo a ela.
//
// Roda FORA do caminho da resposta do webhook (ver `waitUntil` lá): a mensagem
// já está gravada e aparece na tela com o marcador de "carregando mídia"; quando
// o arquivo chega, o UPDATE em `mensagens` dispara o Realtime e a tela troca o
// marcador pela foto ou pelo player. Nunca lança — mídia que falhou é mídia
// que falta, e a conversa continua.
export async function guardarMidiaDaMensagem(
  { mensagemId, conversaId, waId, mensagemBruta }:
  { mensagemId: string; conversaId: string; waId: string; mensagemBruta: any },
): Promise<{ ok: boolean; motivo: string }> {
  try {
    const sub = subMensagem(mensagemBruta)
    if (!sub) return { ok: false, motivo: 'mensagem sem mídia' }

    const tamanhoDeclarado = Number(sub.fileLength ?? sub.FileLength ?? 0)
    if (tamanhoDeclarado > TETO_BYTES) {
      await marcarFalha(mensagemId, `arquivo grande demais (${Math.round(tamanhoDeclarado / 1048576)} MB)`)
      return { ok: false, motivo: 'grande demais' }
    }

    const resposta = await chamarEvolutionBinario('/message/downloadmedia', { message: mensagemBruta })
    if (!resposta.ok || !resposta.bytes) {
      await marcarFalha(mensagemId, `não foi possível baixar (${resposta.status})`)
      return { ok: false, motivo: `evolution ${resposta.status}` }
    }

    let bytes: Uint8Array
    let mimetype = String(sub.mimetype ?? sub.Mimetype ?? '')

    if (resposta.tipo.includes('application/json')) {
      const corpo = JSON.parse(new TextDecoder().decode(resposta.bytes))
      const achado = lerBase64(corpo)
      if (!achado) {
        await marcarFalha(mensagemId, 'resposta da Evolution sem o arquivo')
        return { ok: false, motivo: 'json sem base64' }
      }
      bytes = base64ParaBytes(achado.base64)
      mimetype = achado.mimetype || mimetype
    } else {
      bytes = new Uint8Array(resposta.bytes)
      mimetype = mimetype || resposta.tipo
    }

    if (!bytes.byteLength) {
      await marcarFalha(mensagemId, 'arquivo vazio')
      return { ok: false, motivo: 'vazio' }
    }

    const nomeOriginal = String(sub.fileName ?? sub.FileName ?? '')
    const caminho = `mensagens/${conversaId}/${waId || mensagemId}.${extensao(mimetype, nomeOriginal)}`

    const { error: erroUpload } = await supabase.storage.from(BUCKET).upload(caminho, bytes, {
      // O content-type certo é o que faz o navegador tocar o áudio em vez de
      // oferecer para baixar — "audio/ogg; codecs=opus" é o da nota de voz.
      contentType: mimetype || 'application/octet-stream',
      upsert: true,
    })
    if (erroUpload) {
      await marcarFalha(mensagemId, `storage: ${erroUpload.message}`)
      return { ok: false, motivo: erroUpload.message }
    }

    await supabase.from('mensagens').update({
      midia_path: caminho,
      midia_nome: nomeOriginal || null,
    }).eq('id', mensagemId)

    return { ok: true, motivo: 'guardada' }
  } catch (falha) {
    await marcarFalha(mensagemId, (falha as Error)?.message ?? 'falha desconhecida').catch(() => {})
    return { ok: false, motivo: (falha as Error)?.message ?? 'falha' }
  }
}

// A mensagem continua sendo entrada/saída normal — `status` fala da ENTREGA e
// não pode virar "falhou" por causa da mídia. O motivo vai em `erro`, que a tela
// mostra no lugar do arquivo. Sem isto, o marcador "carregando mídia" ficaria
// girando para sempre numa mensagem cujo arquivo nunca vai chegar.
async function marcarFalha(mensagemId: string, motivo: string) {
  await supabase.from('mensagens').update({ erro: `mídia: ${motivo}` }).eq('id', mensagemId)
}
