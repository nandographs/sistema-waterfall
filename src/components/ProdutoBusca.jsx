import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { inputCls } from './ui.jsx'
import { IconSearch, IconX } from './icons.jsx'
import { formatBRL, unidadeDo, TIPOS_PRODUTO } from '../data/repository.js'
import { indexarBusca, prepararBusca, pontuarBusca, semAcento } from '../lib/texto.js'

const normalizar = semAcento
const SEM_OCULTOS = []

// Quantas opções a lista desenha de uma vez.
const LIMITE = 50

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
  ocultarIds = SEM_OCULTOS,
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
  const campoRef = useRef(null)
  const listaId = useId()

  // Mesmo motivo do ClienteBusca: o `required` é cobrado no campo de texto
  // visível, porque um input invisível barra o envio do formulário sem ter onde
  // mostrar o aviso — e o botão Salvar parece estar quebrado.
  const [aviso, setAviso] = useState('')
  useEffect(() => {
    const campo = campoRef.current
    if (!campo) return
    campo.setCustomValidity(required && !value ? 'Escolha um produto da lista.' : '')
    if (value) setAviso('')
  }, [required, value])

  // Mantém o texto do campo em sincronia com o produto selecionado (ex.: ao
  // editar uma venda já salva). No modo de adição não há seleção fixa.
  //
  // Menos quando a seleção sumiu porque a pessoa começou a DIGITAR: zerar ali
  // apagava a primeira letra da busca nova.
  const digitandoRef = useRef(false)
  useEffect(() => {
    if (limparAoSelecionar) return
    if (!selecionado && digitandoRef.current) return
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

  // Com o produto já escolhido, o texto do campo é o nome DELE: filtrar por
  // isso mostraria só ele. Abrir a lista ali é para trocar — mostra todos.
  const termo = selecionado && query === selecionado.nome ? '' : query
  const q = normalizar(termo)
  const todas = useMemo(() => {
    const disponiveis = produtos
      .filter((p) => !ocultarIds.includes(p.id))
      .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'))
    const consulta = prepararBusca(termo)
    if (consulta.vazia) return disponiveis

    // Cada palavra pode estar no nome, no código, na cor ou no tipo, em
    // qualquer ordem. A cor entra porque, com o mesmo item em várias cores, é
    // ela que distingue um do outro ("torneira branca").
    //
    // Prioridade: código exato > código começa com > relevância pelo nome.
    const notas = []
    for (const p of disponiveis) {
      const nota = pontuarBusca(consulta, indexarBusca({
        principal: p.nome,
        outros: [p.codigo, p.cor, TIPOS_PRODUTO[p.tipo]],
        numeros: [p.codigo],
      }))
      if (nota < 0) continue
      const codigo = normalizar(p.codigo)
      const peso = codigo && codigo === q ? -2 : codigo && codigo.startsWith(q) ? -1 : nota
      notas.push([peso, p])
    }
    return notas.sort((a, b) => a[0] - b[0]).map(([, p]) => p)
  }, [produtos, termo, q, ocultarIds])

  const opcoes = todas.length > LIMITE ? todas.slice(0, LIMITE) : todas
  const destaqueValido = Math.min(destaque, Math.max(0, opcoes.length - 1))

  // A opção destacada pelas setas tem que estar à vista.
  const listaRef = useRef(null)
  useEffect(() => {
    if (!aberto) return
    listaRef.current?.querySelector(`[data-indice="${destaqueValido}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [aberto, destaqueValido])

  function selecionar(p) {
    digitandoRef.current = false
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
    digitandoRef.current = false
    onChange('')
    setQuery('')
    setAberto(true)
  }

  function aoDigitar(e) {
    setQuery(e.target.value)
    setAberto(true)
    setDestaque(0)
    digitandoRef.current = true
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
      setDestaque(Math.min(destaqueValido + 1, opcoes.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setDestaque(Math.max(destaqueValido - 1, 0))
    } else if (e.key === 'Enter') {
      // Impede que o Enter envie o formulário quando a intenção era escolher.
      if (aberto && opcoes[destaqueValido]) {
        e.preventDefault()
        selecionar(opcoes[destaqueValido])
      }
    } else if (e.key === 'Escape') {
      // Dentro de um modal, o Esc fecha a lista — não o formulário inteiro.
      if (aberto) e.stopPropagation()
      setAberto(false)
    } else if (e.key === 'Tab') {
      setAberto(false)
    }
  }

  const mostrarLimpar = !!value && !limparAoSelecionar

  return (
    <div
      ref={wrapRef}
      className="relative"
      // Sair do campo pelo teclado (Tab) também fecha a lista.
      onBlur={(e) => { if (!wrapRef.current?.contains(e.relatedTarget)) setAberto(false) }}
    >
      <div className="relative">
        <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          ref={campoRef}
          className={`${inputCls} pl-9 ${mostrarLimpar ? 'pr-9' : ''}`}
          type="text"
          value={query}
          onChange={aoDigitar}
          onFocus={() => setAberto(true)}
          onKeyDown={aoTeclar}
          onInvalid={(e) => { e.preventDefault(); setAviso(e.target.validationMessage) }}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={aberto}
          aria-controls={listaId}
          aria-required={required || undefined}
          aria-activedescendant={aberto && opcoes[destaqueValido] ? `${listaId}-${opcoes[destaqueValido].id}` : undefined}
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
      </div>

      {aberto && (
        <ul ref={listaRef} id={listaId} role="listbox" className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto rounded-2xl superficie-flutuante divide-y divide-slate-200">
          {opcoes.length === 0 ? (
            <li className="px-3 py-2.5 text-sm text-slate-400">
              {termo.trim() ? `Nenhum produto encontrado para “${termo.trim()}”.` : 'Nenhum produto disponível.'}
            </li>
          ) : (
            opcoes.map((p, i) => (
              <li key={p.id} role="none">
                <button
                  id={`${listaId}-${p.id}`}
                  data-indice={i}
                  tabIndex={-1}
                  // O foco fica no campo: no Safari o botão não recebe foco ao
                  // ser clicado, e a lista fecharia antes do clique chegar.
                  onMouseDown={(e) => e.preventDefault()}
                  role="option"
                  aria-selected={p.id === value}
                  type="button"
                  onMouseEnter={() => setDestaque(i)}
                  onClick={() => selecionar(p)}
                  className={`w-full min-h-11 text-left px-3 py-2 text-sm cursor-pointer flex items-center gap-2 ${
                    i === destaqueValido ? 'bg-blue-50 text-blue-600' : 'text-slate-700 hover-superficie'
                  } ${p.id === value ? 'font-semibold' : ''}`}
                >
                  {p.codigo && (
                    <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500 tnum">
                      {p.codigo}
                    </span>
                  )}
                  <span className="flex-1 truncate">
                    {p.nome}
                    {p.cor && <span className="text-slate-400"> — {p.cor}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-slate-400 tnum">
                    {formatBRL(p.valor)}
                    {p.unidade && p.unidade !== 'un' && `/${unidadeDo(p).sigla}`}
                  </span>
                </button>
              </li>
            ))
          )}
          {todas.length > opcoes.length && (
            <li role="none" className="px-3 py-2 text-xs text-slate-400">
              Mostrando {opcoes.length} de {todas.length}. Continue digitando para achar os outros.
            </li>
          )}
        </ul>
      )}

      {/* Depois da lista no JSX de propósito: a lista é absoluta e se posiciona
          logo abaixo do campo — um parágrafo antes dela a empurraria para baixo. */}
      {aviso && <p role="alert" className="mt-1.5 text-xs text-red-600">{aviso}</p>}
    </div>
  )
}
