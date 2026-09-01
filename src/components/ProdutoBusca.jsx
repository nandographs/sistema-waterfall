import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { inputCls } from './ui.jsx'
import { IconSearch, IconX } from './icons.jsx'
import { formatBRL } from '../data/repository.js'

// Remove acentos e caixa para busca tolerante ("Purificador" casa com "purificador").
const normalizar = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()

// Campo de seleção de produto com busca dinâmica, no mesmo espírito do
// ClienteBusca: em vez de rolar uma lista gigante, digita-se parte do nome OU
// o código do produto.
//
// Dois modos de uso:
//   * seleção única  — passe `value` (id) e `onChange(id)`. Ex.: itens da venda.
//   * adição em lista — passe `limparAoSelecionar`, e o campo se esvazia depois
//     de cada escolha para continuar somando produtos. Ex.: agendamento.
//
// `ocultarIds` tira da lista o que já foi escolhido, para não repetir item.
export default function ProdutoBusca({
  produtos,
  value,
  onChange,
  required,
  ocultarIds = [],
  limparAoSelecionar = false,
  placeholder = 'Busque por nome ou código…',
}) {
  const selecionado = useMemo(
    () => (value ? produtos.find((p) => p.id === value) || null : null),
    [produtos, value],
  )
  const [query, setQuery] = useState('')
  const [aberto, setAberto] = useState(false)
  const [destaque, setDestaque] = useState(0)
  const wrapRef = useRef(null)
  const listaId = useId()

  // Mantém o texto do campo em sincronia com o produto selecionado (ex.: ao
  // editar uma venda já salva). No modo de adição não há seleção fixa.
  useEffect(() => {
    if (limparAoSelecionar) return
    setQuery(selecionado ? selecionado.nome : '')
  }, [selecionado, limparAoSelecionar])

  // Fecha o dropdown ao clicar fora.
  useEffect(() => {
    function aoClicarFora(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setAberto(false)
    }
    document.addEventListener('mousedown', aoClicarFora)
    return () => document.removeEventListener('mousedown', aoClicarFora)
  }, [])

  const q = normalizar(query)
  const opcoes = useMemo(() => {
    const disponiveis = produtos.filter((p) => !ocultarIds.includes(p.id))
    if (!q) return disponiveis

    const casam = disponiveis.filter((p) => {
      const nome = normalizar(p.nome)
      const codigo = normalizar(p.codigo)
      return (
        nome.includes(q) ||
        nome.split(/\s+/).some((parte) => parte.startsWith(q)) ||
        (codigo && codigo.includes(q))
      )
    })

    // Prioridade: código exato > código começa com > nome começa com > resto.
    const peso = (p) => {
      const nome = normalizar(p.nome)
      const codigo = normalizar(p.codigo)
      if (codigo && codigo === q) return 0
      if (codigo && codigo.startsWith(q)) return 1
      if (nome.startsWith(q)) return 2
      return 3
    }
    return casam.sort((a, b) => peso(a) - peso(b) || a.nome.localeCompare(b.nome))
  }, [produtos, q, ocultarIds])

  function selecionar(p) {
    onChange(p.id)
    if (limparAoSelecionar) {
      setQuery('')
      setDestaque(0)
    } else {
      setQuery(p.nome)
      setAberto(false)
    }
  }

  function limpar() {
    onChange('')
    setQuery('')
    setAberto(true)
  }

  function aoDigitar(e) {
    setQuery(e.target.value)
    setAberto(true)
    setDestaque(0)
    // Digitou de novo → desfaz a seleção anterior (só no modo de seleção única).
    if (value && !limparAoSelecionar) onChange('')
  }

  function aoTeclar(e) {
    if (!aberto && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setAberto(true)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setDestaque((i) => Math.min(i + 1, opcoes.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setDestaque((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      // Impede que o Enter envie o formulário quando a intenção era escolher.
      if (aberto && opcoes[destaque]) {
        e.preventDefault()
        selecionar(opcoes[destaque])
      }
    } else if (e.key === 'Escape') {
      setAberto(false)
    }
  }

  const mostrarLimpar = !!value && !limparAoSelecionar

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          className={`${inputCls} pl-9 ${mostrarLimpar ? 'pr-9' : ''}`}
          type="text"
          value={query}
          onChange={aoDigitar}
          onFocus={() => setAberto(true)}
          onKeyDown={aoTeclar}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={aberto}
          aria-controls={listaId}
          aria-activedescendant={aberto && opcoes[destaque] ? `${listaId}-${opcoes[destaque].id}` : undefined}
        />
        {mostrarLimpar && (
          <button
            type="button"
            onClick={limpar}
            className="absolute right-0.5 top-1/2 -translate-y-1/2 inline-flex h-11 w-11 items-center justify-center text-slate-400 hover:text-slate-700 cursor-pointer"
            aria-label="Limpar"
          >
            <IconX size={16} />
          </button>
        )}
        {/* Espelha o `required` do form sem atrapalhar a UX do campo de texto. */}
        {required && (
          <input
            tabIndex={-1}
            aria-hidden="true"
            required
            value={value || ''}
            onChange={() => {}}
            className="absolute inset-x-0 bottom-0 h-0 w-full opacity-0 pointer-events-none"
          />
        )}
      </div>

      {aberto && (
        <ul id={listaId} role="listbox" className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto rounded-xl border border-slate-300 bg-slate-100 shadow-xl shadow-black/30 divide-y divide-slate-200">
          {opcoes.length === 0 ? (
            <li className="px-3 py-2.5 text-sm text-slate-400">Nenhum produto encontrado.</li>
          ) : (
            opcoes.map((p, i) => (
              <li key={p.id} role="none">
                <button
                  id={`${listaId}-${p.id}`}
                  role="option"
                  aria-selected={p.id === value}
                  type="button"
                  onMouseEnter={() => setDestaque(i)}
                  onClick={() => selecionar(p)}
                  className={`w-full min-h-11 text-left px-3 py-2 text-sm cursor-pointer flex items-center gap-2 ${
                    i === destaque ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'
                  } ${p.id === value ? 'font-semibold' : ''}`}
                >
                  {p.codigo && (
                    <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500 tnum">
                      {p.codigo}
                    </span>
                  )}
                  <span className="flex-1 truncate">{p.nome}</span>
                  <span className="shrink-0 text-xs text-slate-400 tnum">{formatBRL(p.valor)}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
