import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react'
import { inputCls } from './ui.jsx'
import { IconSearch, IconX } from './icons.jsx'
import { indexarBusca, prepararBusca, filtrarPorBusca } from '../lib/texto.js'
import { telefonesDoCliente } from '../lib/telefone.js'
import { clienteInativo } from '../data/repository.js'

// Busca tolerante a acento e caixa ("João" casa com "joao"). A implementação
// mora em lib/texto.js, compartilhada com todas as listas do sistema — cópias
// da mesma regra é como elas passam a discordar entre si.

// Quantas opções a lista desenha de uma vez.
const LIMITE = 50

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

  // O texto de busca de cada cliente, montado quando a lista muda — não a
  // cada tecla. Cada palavra pode estar no nome, no cônjuge ou na cidade
  // ("maria silva" acha "Maria da Silva"); o telefone vale digitado com ou
  // sem máscara: quem monta a venda às vezes só tem o número que ligou.
  const indices = useMemo(() => {
    const mapa = new Map()
    for (const c of clientes) {
      mapa.set(c.id, indexarBusca({
        principal: c.nome,
        outros: [c.conjugeNome, c.cidade, c.bairro],
        numeros: [...telefonesDoCliente(c).map((t) => t.numero), c.conjugeTelefone, c.cpfCnpj],
      }))
    }
    return mapa
  }, [clientes])

  // Com o cliente já escolhido, o texto do campo é o nome DELE: filtrar por
  // isso mostraria só ele. Abrir a lista ali é para trocar — mostra todos.
  const termo = selecionado && query === selecionado.nome ? '' : query
  const termoAdiado = useDeferredValue(termo)
  const consulta = useMemo(() => prepararBusca(termoAdiado), [termoAdiado])

  // Inativo continua achável — às vezes ele volta, e a venda nova é dele —
  // mas vai para o fim da lista, com selo: quem procura "Maria" quer a Maria
  // que é cliente hoje, não a homônima que se mudou há dois anos.
  const todas = useMemo(() => {
    const ordenados = [...clientes].sort((a, b) =>
      Number(clienteInativo(a)) - Number(clienteInativo(b)) ||
      String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'))
    const achados = filtrarPorBusca(ordenados, consulta, (c) => indices.get(c.id), { porRelevancia: true })
    // A relevância reordenou; o inativo volta para o fim mesmo assim.
    return [...achados.filter((c) => !clienteInativo(c)), ...achados.filter(clienteInativo)]
  }, [clientes, indices, consulta])

  // Desenhar 2.600 botões ao focar o campo era o que travava o formulário.
  // A lista mostra os primeiros; o resto aparece digitando.
  const opcoes = todas.length > LIMITE ? todas.slice(0, LIMITE) : todas
  const destaqueValido = Math.min(destaque, Math.max(0, opcoes.length - 1))

  // A opção destacada pelas setas tem que estar à vista: antes ela descia
  // para fora da caixa e o Enter escolhia alguém que você não estava vendo.
  const listaRef = useRef(null)
  useEffect(() => {
    if (!aberto) return
    listaRef.current?.querySelector(`[data-indice="${destaqueValido}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [aberto, destaqueValido])

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
      setDestaque(Math.min(destaqueValido + 1, opcoes.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setDestaque(Math.max(destaqueValido - 1, 0))
    } else if (e.key === 'Enter') {
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

  return (
    <div
      ref={wrapRef}
      className="relative"
      // Sair do campo pelo teclado (Tab) também fecha: antes a lista ficava
      // aberta por cima do campo seguinte.
      onBlur={(e) => { if (!wrapRef.current?.contains(e.relatedTarget)) setAberto(false) }}
    >
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
          aria-activedescendant={aberto && opcoes[destaqueValido] ? `${listaId}-${opcoes[destaqueValido].id}` : undefined}
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
        <ul ref={listaRef} id={listaId} role="listbox" className="absolute z-10 mt-1 w-full max-h-64 overflow-y-auto rounded-2xl superficie-flutuante divide-y divide-slate-200">
          {opcoes.length === 0 ? (
            <li className="px-3 py-2.5 text-sm text-slate-400">
              {termoAdiado.trim() ? `Nenhum cliente encontrado para “${termoAdiado.trim()}”.` : 'Nenhum cliente cadastrado.'}
            </li>
          ) : (
            opcoes.map((c, i) => (
              <li key={c.id} role="none">
                <button
                  id={`${listaId}-${c.id}`}
                  data-indice={i}
                  tabIndex={-1}
                  // O foco fica no campo: no Safari o botão não recebe foco ao ser
                  // clicado, e a lista fecharia antes do clique chegar.
                  onMouseDown={(e) => e.preventDefault()}
                  role="option"
                  aria-selected={c.id === value}
                  type="button"
                  onMouseEnter={() => setDestaque(i)}
                  onClick={() => selecionar(c)}
                  className={`w-full min-h-11 text-left px-3 py-2 text-sm cursor-pointer ${
                    i === destaqueValido ? 'bg-blue-50 text-blue-600' : 'text-slate-700 hover-superficie'
                  } ${c.id === value ? 'font-semibold' : ''}`}
                >
                  {c.nome}
                  {telefonesDoCliente(c)[0] && <span className="text-xs text-slate-400 ml-2">{telefonesDoCliente(c)[0].numero}</span>}
                  {/* A cidade separa os homônimos: duas "Maria Silva" é comum. */}
                  {c.cidade && <span className="text-xs text-slate-400 ml-2">· {c.cidade}</span>}
                  {clienteInativo(c) && <span className="text-xs text-slate-400 ml-2">· inativo</span>}
                </button>
              </li>
            ))
          )}
          {todas.length > opcoes.length && (
            <li role="none" className="px-3 py-2 text-xs text-slate-400">
              Mostrando {opcoes.length} de {todas.length.toLocaleString('pt-BR')}. Continue digitando para achar os outros.
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
