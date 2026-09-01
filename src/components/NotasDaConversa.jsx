import { useState } from 'react'
import { notasDaConversa, anotarNaConversa, apagarNota, formatData } from '../data/repository.js'
import { formatHora } from '../lib/datas.js'
import { notificar } from './ui.jsx'
import { IconMais, IconTrash } from './icons.jsx'

// Recado para o próximo atendente.
//
// O QUE ISTO NÃO É: mensagem. Nada daqui vai para o WhatsApp de ninguém. É
// anotação interna — "cliente pediu para ligar depois das 18h", "já reclamou do
// prazo, tratar com cuidado". Por isso o visual é deliberadamente diferente dos
// balões: âmbar, fora do fluxo da conversa, com o nome de quem escreveu. Se
// parecesse mensagem, alguém um dia mandaria a anotação para o cliente.
//
// ONDE ELAS VIVEM: são `atividades` com `tipo = 'nota'` (migração 014), as
// mesmas que aparecem na ficha do cliente e no cartão do CRM. Uma linha só,
// lida de três lugares — não há cópia para sair de sincronia.
//
// FICA FECHADO POR PADRÃO quando não há nada anotado: o assunto da tela é a
// conversa. Quando HÁ recado, abre sozinho — um aviso que ninguém vê não é
// aviso.
export default function NotasDaConversa({ conversa, aoMudar }) {
  const notas = notasDaConversa(conversa?.id)
  const [aberto, setAberto] = useState(notas.length > 0)
  const [texto, setTexto] = useState('')
  const [salvando, setSalvando] = useState(false)

  // Conversa que ainda não existe no banco não tem onde pendurar a nota.
  if (!conversa?.id) return null

  async function anotar(e) {
    e.preventDefault()
    const limpo = texto.trim()
    if (!limpo) return
    setSalvando(true)
    try {
      await anotarNaConversa(conversa, limpo)
      setTexto('')
      aoMudar?.()
    } catch (falha) {
      notificar(falha?.message || String(falha), 'erro')
    } finally {
      setSalvando(false)
    }
  }

  async function remover(nota) {
    if (!confirm('Apagar esta anotação?')) return
    try {
      await apagarNota(nota.id)
      aoMudar?.()
    } catch (falha) {
      notificar(falha?.message || String(falha), 'erro')
    }
  }

  return (
    <div className="shrink-0 border-b border-slate-200">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex w-full items-center gap-2 px-3 sm:px-4 py-2 text-left cursor-pointer hover:bg-slate-50"
      >
        <span className="text-[11px] font-bold uppercase tracking-wide text-amber-700">
          Anotações internas
        </span>
        {notas.length > 0 && (
          <span className="inline-flex min-w-[1.15rem] h-[1.15rem] items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-bold text-amber-950 tnum">
            {notas.length}
          </span>
        )}
        <span className="ml-auto text-[11px] font-semibold text-slate-500">
          {aberto ? 'ocultar' : (notas.length ? 'ver' : 'anotar')}
        </span>
      </button>

      {aberto && (
        <div className="px-3 sm:px-4 pb-3 space-y-2">
          {/* O aviso de que isto não sai daqui. Custa uma linha e evita o erro
              caro: alguém escrever "cliente é chato" achando que é bloco de
              notas e descobrir que virou mensagem. */}
          <p className="text-[11px] text-slate-500">
            Só a equipe vê. Nada daqui é enviado ao cliente.
          </p>

          {notas.map((nota) => (
            <div
              key={nota.id}
              className="group flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm text-amber-950 whitespace-pre-wrap break-words">{nota.descricao}</p>
                <p className="mt-0.5 text-[10px] font-semibold text-amber-800">
                  {nota.criadoPor || 'alguém'}
                  {nota.criadoEm ? ` · ${formatData(String(nota.criadoEm).slice(0, 10))} ${formatHora(String(nota.criadoEm).slice(11, 16))}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => remover(nota)}
                aria-label="Apagar anotação"
                className="shrink-0 rounded-md p-1 text-amber-700 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-amber-100 cursor-pointer"
              >
                <IconTrash size={13} />
              </button>
            </div>
          ))}

          <form onSubmit={anotar} className="flex items-center gap-2">
            <input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Deixar um recado para quem atender depois…"
              className="min-w-0 flex-1 rounded-lg border border-amber-200 bg-white px-2.5 py-1.5 text-sm placeholder:text-slate-400"
            />
            <button
              type="submit"
              disabled={salvando || !texto.trim()}
              aria-label="Salvar anotação"
              className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-amber-400 text-amber-950 disabled:opacity-40 cursor-pointer"
            >
              <IconMais size={16} />
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
