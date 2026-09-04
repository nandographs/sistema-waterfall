import { useRef, useState } from 'react'
import { Field, inputCls } from './ui.jsx'
import { mascararCpfCnpj, mascararTelefone, mascararCep } from '../lib/mascaras.js'
import { buscarCep } from '../lib/cep.js'
import { telefonesDoCliente } from '../lib/telefone.js'

// Campos de cadastro de cliente, compartilhados entre a tela de Clientes
// (novo cliente) e a ficha do cliente (editar dados). Inclui CPF/CNPJ e o
// endereço detalhado — usados para pré-preencher a Ordem de Serviço.
//
// onEnderecoEncontrado(dados): chamado com { endereco, bairro, cidade, uf }
// quando o CEP é encontrado, para o formulário pai aplicar tudo de uma vez
// (chamar `set` várias vezes em sequência perderia as mudanças anteriores,
// pois cada chamada parte do mesmo `form` da render atual).

// Sugestões de rótulo — `datalist`, e não `select`: os rótulos que aparecem na
// vida real não cabem numa lista fechada ("portaria", "vizinha", "filho"), e um
// vocabulário fixo que não cobre o seu caso vira campo preenchido errado.
const ROTULOS_SUGERIDOS = ['WhatsApp', 'Celular', 'Casa', 'Trabalho', 'Recado', 'Cônjuge']

export default function ClienteFormFields({ form, set, onEnderecoEncontrado }) {
  // Aplica a máscara antes de repassar ao handler original de `set`
  const comMascara = (campo, mascara) => (e) => set(campo)({ target: { value: mascara(e.target.value) } })

  const numeroRef = useRef(null)
  const ultimoCepBuscado = useRef('')
  const [buscandoCep, setBuscandoCep] = useState(false)
  const [erroCep, setErroCep] = useState('')

  // A lista que o formulário edita. Derivada aqui, e não exigida do pai, para
  // as telas que usam este componente não precisarem saber se aquele cadastro é
  // anterior à migração 016: cliente antigo entra como uma linha única com o
  // telefone que ele já tinha, e cliente novo entra com uma linha vazia.
  const jaCadastrados = telefonesDoCliente(form)
  const telefones = form.telefones?.length
    ? form.telefones
    : (jaCadastrados.length ? jaCadastrados : [{ numero: '', rotulo: '' }])

  const trocarTelefones = (lista) => set('telefones')({ target: { value: lista } })

  const alterarTelefone = (indice, campo, valor) =>
    trocarTelefones(telefones.map((t, i) => (i === indice ? { ...t, [campo]: valor } : t)))

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

      {/* Telefones — quantos forem. O cliente tem o celular dele, o fixo de
          casa e o da esposa; com um campo só, os outros iam parar nas
          observações, onde ninguém consegue buscar. */}
      <div>
        <span className="block text-[13px] font-semibold text-slate-700 mb-1.5">Telefones</span>
        <div className="space-y-2">
          {telefones.map((telefone, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                className={inputCls}
                inputMode="tel"
                placeholder="(00) 00000-0000"
                value={telefone.numero}
                onChange={(e) => alterarTelefone(i, 'numero', mascararTelefone(e.target.value))}
              />
              <div className="w-32 sm:w-40 shrink-0">
                <input
                  className={inputCls}
                  list="rotulos-telefone"
                  placeholder={i === 0 ? 'Principal' : 'Rótulo'}
                  value={telefone.rotulo}
                  onChange={(e) => alterarTelefone(i, 'rotulo', e.target.value)}
                />
              </div>
              {/* Some quando só resta uma linha: um cliente sem nenhuma linha
                  de telefone não teria onde digitar o número de volta. */}
              {telefones.length > 1 && (
                <button
                  type="button"
                  onClick={() => trocarTelefones(telefones.filter((_, idx) => idx !== i))}
                  className="text-red-500 hover:text-red-700 text-lg leading-none cursor-pointer px-1 shrink-0"
                  title="Remover este telefone"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
        <datalist id="rotulos-telefone">
          {ROTULOS_SUGERIDOS.map((r) => <option key={r} value={r} />)}
        </datalist>
        <button
          type="button"
          onClick={() => trocarTelefones([...telefones, { numero: '', rotulo: '' }])}
          className="mt-2 text-sm font-semibold text-blue-700 hover:underline cursor-pointer"
        >
          + Adicionar telefone
        </button>
        <p className="mt-1.5 text-xs text-slate-400">
          O primeiro é o principal — é ele que o WhatsApp e os documentos usam.
        </p>
      </div>

      <Field label="E-mail">
        <input className={inputCls} type="email" value={form.email} onChange={set('email')} />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="CPF / CNPJ">
          <input
            className={inputCls}
            inputMode="numeric"
            placeholder="000.000.000-00"
            value={form.cpfCnpj}
            onChange={comMascara('cpfCnpj', mascararCpfCnpj)}
          />
        </Field>
        {/* O Pedido de Venda tem esse campo desde sempre; sem ele no cadastro,
            era redigitado a cada emissão. */}
        <Field label="Data de nascimento">
          <input
            className={inputCls}
            type="date"
            value={form.nascimento || ''}
            onChange={set('nascimento')}
          />
        </Field>
      </div>

      {/* Cônjuge — informação do CLIENTE, e não do documento: é por ela que se
          acha a ficha quando quem atende é a esposa e quem procura só lembra do
          nome dela. A busca de clientes olha estes campos. */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-4">
        <p className="text-[13px] font-semibold text-slate-700">
          Cônjuge <span className="font-normal text-slate-400">— opcional</span>
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Nome do cônjuge">
            <input className={inputCls} value={form.conjugeNome || ''} onChange={set('conjugeNome')} />
          </Field>
          <Field label="Telefone do cônjuge">
            <input
              className={inputCls}
              inputMode="tel"
              placeholder="(00) 00000-0000"
              value={form.conjugeTelefone || ''}
              onChange={comMascara('conjugeTelefone', mascararTelefone)}
            />
          </Field>
          <Field label="CPF do cônjuge">
            <input
              className={inputCls}
              inputMode="numeric"
              placeholder="000.000.000-00"
              value={form.conjugeCpf || ''}
              onChange={comMascara('conjugeCpf', mascararCpfCnpj)}
            />
          </Field>
          <Field label="Data de nascimento">
            <input
              className={inputCls}
              type="date"
              value={form.conjugeNascimento || ''}
              onChange={set('conjugeNascimento')}
            />
          </Field>
        </div>
      </div>

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
