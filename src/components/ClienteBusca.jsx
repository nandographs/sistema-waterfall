import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { inputCls } from './ui.jsx'
import { IconSearch, IconX } from './icons.jsx'
import { semAcento, casaPalavras } from '../lib/texto.js'
import { telefonesDoCliente } from '../lib/telefone.js'

// Busca tolerante a acento e caixa ("João" casa com "joao"). A implementação
// mora em lib/texto.js, compartilhada com as buscas de Clientes e de Vendas —
// três cópias da mesma regra é como elas passam a discordar entre si.
const normalizar = semAcento

// Campo de seleção de cliente com busca dinâmica: em vez de rolar um <select>
// gigante, o usuário digita o nome e vê as opções que começam com o texto ou
// cujo sobrenome contém ele. `value` é o id do cliente; `onChange` recebe o id.
export default function ClienteBusca({ clientes, value, onChange, required, placeholder = 'Digite o nome do cliente…' }) {
  const selecionado = useMemo(() => clientes.find((c) => c.id === value) || null, [clientes, value])
  const [query, setQuery] = useState('')
  const [aberto, setAberto] = useState(false)
  const [destaque, setDestaque] = useState(0)
  const wrapRef = useRef(null)
  const campoRef = useRef(null)
  const listaId = useId()

  // Mantém o texto do campo em sincronia com o cliente selecionado (ex.: ao
  // editar, ou quando o formulário é zerado por fora).
  //
  // Menos quando a seleção sumiu porque a pessoa começou a DIGITAR: aí o texto
  // é o que ela está escrevendo, e zerá-lo apagava a primeira letra da busca.
  const digitandoRef = useRef(false)
  useEffect(() => {
    if (!selecionado && digitandoRef.current) return
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

  // O `required` do formulário é cobrado NO PRÓPRIO campo de texto.
  //
  // Antes ele morava num input invisível colado embaixo: o navegador barrava o
  // envio, mas não tinha onde desenhar o aviso (campo de altura zero e
  // opacidade zero), então clicar em Salvar não fazia absolutamente nada — nem
  // salvava, nem dizia por quê. O caso comum é digitar o nome e não ESCOLHER
  // ninguém da lista: o texto está no campo, o id do cliente não.
  // A bolha nativa do navegador não serve aqui: ela aparece ao lado de um campo
  // que, ao receber o foco, abre a lista e a desmonta. Então o aviso é nosso,
  // impresso embaixo do campo — onInvalid ainda é o gancho certo, porque é o
  // navegador que decide quando o formulário foi barrado.
  const [aviso, setAviso] = useState('')
  useEffect(() => {
    const campo = campoRef.current
    if (!campo) return
    campo.setCustomValidity(required && !value ? 'Escolha um cliente da lista.' : '')
    if (value) setAviso('')
  }, [required, value])

  const q = normalizar(query)
  const digitos = /^[\d\s()+-]+$/.test(query) ? query.replace(/\D/g, '') : ''
  const opcoes = useMemo(() => {
    if (!q) return clientes
    // Cada palavra pode estar em qualquer lugar do nome ("maria silva" acha
    // "Maria da Silva"). Também pelo cônjuge e pelos telefones: quem monta a
    // venda às vezes só tem o número que ligou, ou o nome de quem atendeu.
    const casam = clientes.filter((c) =>
      casaPalavras(q, c.nome) ||
      casaPalavras(q, c.conjugeNome) ||
      telefonesDoCliente(c).some((t) =>
        casaPalavras(q, t.numero) ||
        // Telefone digitado sem máscara ("49999") acha o gravado com máscara.
        (digitos.length >= 3 && String(t.numero || '').replace(/\D/g, '').includes(digitos))),
    )
    // Quem começa com o texto vem primeiro.
    return casam.sort((a, b) => {
      const na = normalizar(a.nome).startsWith(q) ? 0 : 1
      const nb = normalizar(b.nome).startsWith(q) ? 0 : 1
      return na - nb || a.nome.localeCompare(b.nome)
    })
  }, [clientes, q, digitos])

  function selecionar(c) {
    digitandoRef.current = false
    onChange(c.id)
    setQuery(c.nome)
    setAberto(false)
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
          ref={campoRef}
          className={`${inputCls} pl-9 ${value ? 'pr-9' : ''}`}
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
      </div>

      {aberto && (
        <ul id={listaId} role="listbox" className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto rounded-2xl superficie-flutuante divide-y divide-slate-200">
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
                    i === destaque ? 'bg-blue-50 text-blue-600' : 'text-slate-700 hover-superficie'
                  } ${c.id === value ? 'font-semibold' : ''}`}
                >
                  {c.nome}
                  {telefonesDoCliente(c)[0] && <span className="text-xs text-slate-400 ml-2">{telefonesDoCliente(c)[0].numero}</span>}
                </button>
              </li>
            ))
          )}
        </ul>
      )}

      {/* Depois da lista no JSX de propósito: a lista é absoluta e se posiciona
          logo abaixo do campo — um parágrafo antes dela a empurraria para baixo. */}
      {aviso && <p role="alert" className="mt-1.5 text-xs text-red-600">{aviso}</p>}
    </div>
  )
}
