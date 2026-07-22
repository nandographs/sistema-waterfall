// Geração da Ordem de Serviço no navegador: copia o modelo oficial
// (reference.docx), preenche o word/document.xml e baixa o arquivo com o
// nome no padrão da skill: "ordem <cliente> <DD-MM-AAAA>.docx".

import JSZip from 'jszip'
import { fillDocumentXml, nomeArquivo } from './fill.js'
import templateUrl from './reference.docx?url'

export async function gerarOrdemServico(data) {
  const resposta = await fetch(templateUrl)
  if (!resposta.ok) throw new Error('não foi possível carregar o modelo da ordem de serviço')
  const zip = await JSZip.loadAsync(await resposta.arrayBuffer())

  const documentXml = await zip.file('word/document.xml').async('string')
  zip.file('word/document.xml', fillDocumentXml(documentXml, data))

  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })

  const nome = nomeArquivo(data)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = nome
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
  return nome
}

// Exposto no modo dev para permitir testes automatizados no navegador
if (import.meta.env.DEV) {
  window.__gerarOS = gerarOrdemServico
}
