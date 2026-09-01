import { useState } from 'react'
import {
  clientes, produtos, salvarOportunidade, excluirOportunidade,
  ganharOportunidade, perderOportunidade,
  formatBRL,
  ETAPAS_FUNIL, ETAPAS_ABERTAS, CANAIS_OPORTUNIDADE, MOTIVOS_PERDA,
} from '../data/repository.js'
import { Modal, Button, Field, inputCls, notificar } from './ui.jsx'
import ClienteBusca from './ClienteBusca.jsx'
import ProdutoBusca from './ProdutoBusca.jsx'

const OPORTUNIDADE_VAZIA = {
  clienteId: '', titulo: '', etapa: 'novo', valorEstimado: '', produtoId: '',
  canal: '', dataPrevista: '', observacoes: '',
}

export function oportunidadeNova(extra = {}) {
  return { ...OPORTUNIDADE_VAZIA, ...extra }
}

// Cadastro e edição da negociação. O formulário é curto de propósito: o funil
// só serve se registrar um negócio custar menos que anotar num papel.
export default function OportunidadeModal({ oportunidade, onFechar, onSalvo }) {
  const [form, setForm] = useState(() => ({ ...OPORTUNIDADE_VAZIA, ...oportunidade }))
  const [salvando, setSalvando] = useState(false)
  const [confirmarExclusao, setConfirmarExclusao] = useState(false)
  const [erro, setErro] = useState('')

  const editando = !!form.id
  const set = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }))

  // Escolher o produto já sugere o valor: é o dado que o operador teria que
  // buscar no catálogo para digitar em seguida.
  function escolherProduto(produtoId) {
    const produto = produtoId ? produtos.get(produtoId) : null
    setForm((f) => ({
      ...f,
      produtoId,
      valorEstimado: f.valorEstimado || (produto?.valor ?? ''),
      titulo: f.titulo || produto?.nome || '',
    }))
  }

  async function salvar(e) {
    e.preventDefault()
    setErro('')
    setSalvando(true)
    try {
      await salvarOportunidade(form)
      notificar(editando ? 'Negociação atualizada.' : 'Negociação criada.')
      onSalvo?.()
      onFechar()
    } catch (ex) {
      setErro(ex?.message || String(ex))
    } finally {
      setSalvando(false)
    }
  }

  async function excluir() {
    setSalvando(true)
    try {
      await excluirOportunidade(form.id)
      notificar('Negociação excluída.')
      onSalvo?.()
      onFechar()
    } catch (ex) {
      setErro(ex?.message || String(ex))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal open title={editando ? 'Editar negociação' : 'Nova negociação'} onClose={onFechar}>
      <form onSubmit={salvar} className="space-y-4">
        {/* Lead: chegou pelo WhatsApp e ainda não tem cadastro. O campo de
            cliente some para não empurrar você a criar cadastro só para poder
            salvar — é o contrário do que a gente quer. */}
        {form.contatoTelefone && !form.clienteId ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3">
            <p className="text-sm font-semibold text-amber-900">
              {form.contatoNome || 'Contato sem nome'}
            </p>
            <p className="text-xs text-amber-800 mt-0.5">
              {form.contatoTelefone} · ainda sem cadastro. Use "Transformar em cliente" no
              cartão quando ele virar cliente de verdade.
            </p>
          </div>
        ) : (
          <Field label="Cliente">
            <ClienteBusca
              clientes={clientes.list()}
              value={form.clienteId}
              onChange={(id) => setForm((f) => ({ ...f, clienteId: id }))}
              required
            />
          </Field>
        )}

        <Field label="Produto de interesse">
          <ProdutoBusca
            produtos={produtos.list()}
            value={form.produtoId}
            onChange={escolherProduto}
          />
        </Field>

        <Field label="Título">
          <input
            className={inputCls}
            value={form.titulo}
            onChange={set('titulo')}
            placeholder="Ex.: Purificador para a cozinha"
            maxLength={120}
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Valor estimado (R$)">
            <input
              className={inputCls} type="number" min="0" step="0.01"
              value={form.valorEstimado}
              onChange={set('valorEstimado')}
            />
          </Field>
          <Field label="Previsão de fechamento">
            <input className={inputCls} type="date" value={form.dataPrevista} onChange={set('dataPrevista')} />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Origem do contato">
            <select className={inputCls} value={form.canal} onChange={set('canal')}>
              <option value="">Não informado</option>
              {Object.entries(CANAIS_OPORTUNIDADE).map(([valor, rotulo]) => (
                <option key={valor} value={valor}>{rotulo}</option>
              ))}
            </select>
          </Field>
          <Field label="Etapa">
            <select className={inputCls} value={form.etapa} onChange={set('etapa')}>
              {ETAPAS_ABERTAS.map((etapa) => (
                <option key={etapa} value={etapa}>{ETAPAS_FUNIL[etapa]}</option>
              ))}
              {/* Ganho e perdido não entram aqui: fechar exige o motivo (ou a
                  decisão sobre a venda), e isso é o modal de fechamento. */}
            </select>
          </Field>
        </div>

        <Field label="Observações">
          <textarea
            className={inputCls}
            rows={3}
            value={form.observacoes}
            onChange={set('observacoes')}
            placeholder="O que o cliente pediu, o que ficou combinado…"
          />
        </Field>

        {erro && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">{erro}</p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          {editando ? (
            <Button type="button" variant="danger" onClick={() => setConfirmarExclusao(true)}>Excluir</Button>
          ) : <span />}
          <div className="flex gap-2 ml-auto">
            <Button type="button" variant="secondary" onClick={onFechar}>Cancelar</Button>
            <Button type="submit" disabled={salvando || (!form.clienteId && !form.contatoTelefone)}>
              {salvando ? 'Salvando…' : 'Salvar'}
            </Button>
          </div>
        </div>
      </form>

      {confirmarExclusao && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-800">
            Excluir apaga a negociação e o rastro dela. Se o negócio simplesmente não
            aconteceu, prefira marcar como perdido — aí o motivo fica registrado.
          </p>
          <div className="flex gap-2 mt-3">
            <Button variant="danger" onClick={excluir} disabled={salvando}>Excluir mesmo assim</Button>
            <Button variant="secondary" onClick={() => setConfirmarExclusao(false)}>Voltar</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

// Fechamento da negociação — ganho ou perdido. É um modal separado porque as
// duas pontas pedem coisas diferentes: ganhar pergunta se abre a venda, perder
// exige o motivo.
export function FecharOportunidadeModal({ oportunidade, etapa, onFechar, onSalvo }) {
  const ganhou = etapa === 'ganho'
  const [criarVenda, setCriarVenda] = useState(!!oportunidade.produtoId)
  const [motivo, setMotivo] = useState(oportunidade.motivoPerda || '')
  const [detalhe, setDetalhe] = useState(oportunidade.observacoes || '')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  const cliente = clientes.get(oportunidade.clienteId)

  async function confirmar(e) {
    e.preventDefault()
    setErro('')
    setSalvando(true)
    try {
      if (ganhou) {
        await ganharOportunidade(oportunidade.id, { criarVenda })
        notificar(
          criarVenda
            ? 'Negócio ganho. A proposta foi criada em Vendas — confirme lá para gerar o financeiro e a agenda.'
            : 'Negócio ganho.',
        )
      } else {
        await perderOportunidade(oportunidade.id, { motivo, observacoes: detalhe })
        notificar('Negociação marcada como perdida.')
      }
      onSalvo?.()
      onFechar()
    } catch (ex) {
      setErro(ex?.message || String(ex))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal open title={ganhou ? 'Fechar como ganho' : 'Marcar como perdido'} onClose={onFechar}>
      <form onSubmit={confirmar} className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
          <p className="text-sm font-semibold text-slate-900">{oportunidade.titulo}</p>
          <p className="text-xs text-slate-500 mt-0.5">
            {cliente?.nome ?? '(cliente removido)'}
            {Number(oportunidade.valorEstimado || 0) ? ` · ${formatBRL(oportunidade.valorEstimado)}` : ''}
          </p>
        </div>

        {ganhou ? (
          <>
            {oportunidade.vendaId ? (
              <p className="text-sm text-slate-600">
                Esta negociação já tem uma venda vinculada. Nenhuma nova proposta será criada.
              </p>
            ) : (
              <label className="flex items-start gap-2.5 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-blue-600 cursor-pointer"
                  checked={criarVenda}
                  onChange={(e) => setCriarVenda(e.target.checked)}
                />
                <span>
                  Criar a proposta de venda com estes dados.
                  <span className="block text-xs text-slate-500 mt-0.5">
                    Ela nasce como <strong>proposta</strong>: nada entra no caixa nem na agenda
                    até você confirmar a venda na tela de Vendas.
                  </span>
                </span>
              </label>
            )}
          </>
        ) : (
          <>
            <Field label="Motivo da perda">
              <select className={inputCls} value={motivo} onChange={(e) => setMotivo(e.target.value)} required>
                <option value="">Escolha…</option>
                {Object.entries(MOTIVOS_PERDA).map(([valor, rotulo]) => (
                  <option key={valor} value={valor}>{rotulo}</option>
                ))}
              </select>
            </Field>
            <Field label="Detalhe (opcional)">
              <textarea
                className={inputCls}
                rows={3}
                value={detalhe}
                onChange={(e) => setDetalhe(e.target.value)}
                placeholder="O que ele disse na hora de recusar."
              />
            </Field>
          </>
        )}

        {erro && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">{erro}</p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onFechar}>Cancelar</Button>
          <Button type="submit" disabled={salvando || (!ganhou && !motivo)}>
            {salvando ? 'Salvando…' : (ganhou ? 'Confirmar ganho' : 'Confirmar perda')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
