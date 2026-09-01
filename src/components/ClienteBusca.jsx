import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { inputCls } from './ui.jsx'
import { IconSearch, IconX } from './icons.jsx'

// Remove acentos e caixa para busca tolerante ("João" casa com "joao").
const normalizar = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()

// Campo de seleção de cliente com busca dinâmica: em vez de rolar um <select>
// gigante, o usuário digita o nome e vê as opções que começam com o texto ou
// cujo sobrenome contém ele. `value` é o id do cliente; `onChange` recebe o id.
export default function ClienteBusca({ clientes, value, onChange, required, placeholder = 'Digite o nome do cliente…' }) {
  const selecionado = useMemo(() => clientes.find((c) => c.id === value) || null, [clientes, value])
  const [query, setQuery] = useState('')
  const [aberto, setAberto] = useState(false)
  const [destaque, setDestaque] = useState(0)
  const wrapRef = useRef(null)
  const listaId = useId()

  // Mantém o texto do campo em sincronia com o cliente selecionado (ex.: ao editar).
  useEffect(() => {
    setQuery(selecionado ? selecionado.nome : '')
  }, [selecionado])

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
    if (!q) return clientes
    const casam = clientes.filter((c) => {
      const nome = normalizar(c.nome)
      return nome.includes(q) || nome.split(/\s+/).some((p) => p.startsWith(q))
    })
    // Quem começa com o texto vem primeiro.
    return casam.sort((a, b) => {
      const na = normalizar(a.nome).startsWith(q) ? 0 : 1
      const nb = normalizar(b.nome).startsWith(q) ? 0 : 1
      return na - nb || a.nome.localeCompare(b.nome)
    })
  }, [clientes, q])

  function selecionar(c) {
    onChange(c.id)
    setQuery(c.nome)
    setAberto(false)
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
    if (value) onChange('') // digitou de novo → desfaz a seleção anterior
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
      if (aberto && opcoes[destaque]) {
        e.preventDefault()
        selecionar(opcoes[destaque])
      }
    } else if (e.key === 'Escape') {
      setAberto(false)
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          className={`${inputCls} pl-9 ${value ? 'pr-9' : ''}`}
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
        {value && (
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
        <ul id={listaId} role="listbox" className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto rounded-xl border border-slate-300 bg-slate-100 shadow-xl shadow-black/30 divide-y divide-slate-200">
          {opcoes.length === 0 ? (
            <li className="px-3 py-2.5 text-sm text-slate-400">Nenhum cliente encontrado.</li>
          ) : (
            opcoes.map((c, i) => (
              <li key={c.id} role="none">
                <button
                  id={`${listaId}-${c.id}`}
                  role="option"
                  aria-selected={c.id === value}
                  type="button"
                  onMouseEnter={() => setDestaque(i)}
                  onClick={() => selecionar(c)}
                  className={`w-full min-h-11 text-left px-3 py-2 text-sm cursor-pointer ${
                    i === destaque ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'
                  } ${c.id === value ? 'font-semibold' : ''}`}
                >
                  {c.nome}
                  {c.telefone && <span className="text-xs text-slate-400 ml-2">{c.telefone}</span>}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
