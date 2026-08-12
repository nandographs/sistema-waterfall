import { useRef, useState } from 'react'
import { Field, inputCls } from './ui.jsx'
import { mascararCpfCnpj, mascararTelefone, mascararCep } from '../lib/mascaras.js'
import { buscarCep } from '../lib/cep.js'

// Campos de cadastro de cliente, compartilhados entre a tela de Clientes
// (novo cliente) e a ficha do cliente (editar dados). Inclui CPF/CNPJ e o
// endereço detalhado — usados para pré-preencher a Ordem de Serviço.
//
// onEnderecoEncontrado(dados): chamado com { endereco, bairro, cidade, uf }
// quando o CEP é encontrado, para o formulário pai aplicar tudo de uma vez
// (chamar `set` várias vezes em sequência perderia as mudanças anteriores,
// pois cada chamada parte do mesmo `form` da render atual).
export default function ClienteFormFields({ form, set, onEnderecoEncontrado }) {
  // Aplica a máscara antes de repassar ao handler original de `set`
  const comMascara = (campo, mascara) => (e) => set(campo)({ target: { value: mascara(e.target.value) } })

  const numeroRef = useRef(null)
  const ultimoCepBuscado = useRef('')
  const [buscandoCep, setBuscandoCep] = useState(false)
  const [erroCep, setErroCep] = useState('')

  async function buscarEnderecoPorCep(digitos) {
    if (digitos.length !== 8 || digitos === ultimoCepBuscado.current) return
    ultimoCepBuscado.current = digitos
    setBuscandoCep(true)
    setErroCep('')
    const dados = await buscarCep(digitos)
    setBuscandoCep(false)
    if (!dados) {
      setErroCep('CEP não encontrado — preencha o endereço manualmente.')
      return
    }
    onEnderecoEncontrado?.(dados)
    numeroRef.current?.focus()
  }

  function onChangeCep(e) {
    const valor = mascararCep(e.target.value)
    set('cep')({ target: { value: valor } })
    setErroCep('')
    const digitos = valor.replace(/\D/g, '')
    if (digitos.length === 8) buscarEnderecoPorCep(digitos)
  }

  function onBlurCep() {
    const digitos = String(form.cep || '').replace(/\D/g, '')
    if (digitos.length === 8) buscarEnderecoPorCep(digitos)
  }

  return (
    <>
      <Field label="Nome">
        <input className={inputCls} required value={form.nome} onChange={set('nome')} />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Telefone">
          <input
            className={inputCls}
            inputMode="tel"
            placeholder="(00) 00000-0000"
            value={form.telefone}
            onChange={comMascara('telefone', mascararTelefone)}
          />
        </Field>
        <Field label="E-mail">
          <input className={inputCls} type="email" value={form.email} onChange={set('email')} />
        </Field>
      </div>
      <Field label="CPF / CNPJ">
        <input
          className={inputCls}
          inputMode="numeric"
          placeholder="000.000.000-00"
          value={form.cpfCnpj}
          onChange={comMascara('cpfCnpj', mascararCpfCnpj)}
        />
      </Field>

      <Field label="CEP">
        <div className="relative max-w-[200px]">
          <input
            className={inputCls}
            inputMode="numeric"
            placeholder="00000-000"
            value={form.cep}
            onChange={onChangeCep}
            onBlur={onBlurCep}
          />
          {buscandoCep && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">buscando…</span>
          )}
        </div>
        {erroCep && <p className="text-xs text-amber-600 mt-1">{erroCep}</p>}
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="col-span-2">
          <Field label="Endereço">
            <input className={inputCls} value={form.endereco} onChange={set('endereco')} />
          </Field>
        </div>
        <Field label="Nº / Complemento">
          <input ref={numeroRef} className={inputCls} value={form.numeroComplemento} onChange={set('numeroComplemento')} />
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="col-span-2">
          <Field label="Bairro">
            <input className={inputCls} value={form.bairro} onChange={set('bairro')} />
          </Field>
        </div>
        <Field label="UF">
          <input className={inputCls} maxLength={2} value={form.uf} onChange={set('uf')} />
        </Field>
      </div>
      <Field label="Cidade">
        <input className={inputCls} value={form.cidade} onChange={set('cidade')} />
      </Field>
      <Field label="Observações">
        <textarea className={inputCls} rows="3" value={form.observacoes} onChange={set('observacoes')} />
      </Field>
    </>
  )
}
