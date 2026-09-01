import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { contatoDaOportunidade, converterLeadEmCliente } from '../data/repository.js'
import { mascararTelefone } from '../lib/mascaras.js'
import { Modal, Button, Field, inputCls, notificar } from './ui.jsx'

// Promove um lead a cliente.
//
// É um passo manual de propósito: receber mensagem de alguém não faz dessa
// pessoa um cliente, e `clientes` alimenta venda, financeiro, agenda e os
// documentos oficiais. Quem decide que alguém entrou para o cadastro é você.
//
// O formulário é curto porque o resto da ficha pode ser preenchido depois — o
// que não pode é o cadastro nascer com nome errado.
export default function ConverterLeadModal({ oportunidade, onFechar, onConvertido }) {
  const contato = contatoDaOportunidade(oportunidade)
  const [nome, setNome] = useState(contato.nome === 'Contato sem nome' ? '' : contato.nome)
  const [telefone, setTelefone] = useState(contato.telefone || '')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const navigate = useNavigate()

  async function converter(e, abrirFicha) {
    e.preventDefault()
    setErro('')
    setSalvando(true)
    try {
      const cliente = await converterLeadEmCliente(oportunidade.id, { nome: nome.trim(), telefone })
      notificar(`${cliente.nome} agora é cliente. A conversa foi para a ficha dele.`)
      onConvertido?.()
      onFechar()
      if (abrirFicha) navigate(`/clientes/${cliente.id}`)
    } catch (falha) {
      setErro(falha?.message || String(falha))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal open title="Transformar lead em cliente" onClose={onFechar}>
      <form onSubmit={(e) => converter(e, false)} className="space-y-4">
        <p className="text-sm text-slate-600">
          O cadastro nasce agora. A conversa de WhatsApp e esta negociação passam a
          apontar para ele.
        </p>

        <Field label="Nome">
          <input
            className={inputCls}
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Como ele aparece no WhatsApp, ou o nome completo"
            required
            autoFocus
          />
        </Field>

        <Field label="Telefone">
          <input
            className={inputCls}
            value={telefone}
            onChange={(e) => setTelefone(mascararTelefone(e.target.value))}
          />
        </Field>

        {oportunidade.observacoes && (
          <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            {oportunidade.observacoes}
          </p>
        )}

        {erro && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">{erro}</p>
        )}

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onFechar}>Cancelar</Button>
          <Button type="button" variant="secondary" onClick={(e) => converter(e, true)} disabled={salvando || !nome.trim()}>
            Criar e abrir a ficha
          </Button>
          <Button type="submit" disabled={salvando || !nome.trim()}>
            {salvando ? 'Criando…' : 'Criar cliente'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
