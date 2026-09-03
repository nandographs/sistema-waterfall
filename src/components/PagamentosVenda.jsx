// O bloco de pagamento da venda — uma ou várias formas na mesma venda.
//
// Existe porque no balcão o cliente paga R$ 500 de entrada em dinheiro e os
// R$ 2.500 restantes em 3x no cartão. Com uma forma só era preciso escolher uma
// das duas e mentir na outra, e o relatório de "quanto entrou em cada forma"
// nascia errado.
//
// A ORDEM DA TELA é a ordem da conversa no balcão: primeiro se pergunta se teve
// entrada, depois como paga o resto, depois se ainda falta alguma forma.
//
// A REGRA QUE FAZ ISTO NÃO ATRAPALHAR quem só usa uma forma: valor em branco
// vale "o restante" (ver resolverPagamentos). Uma forma só, campo vazio, e a
// venda inteira vai nela — exatamente como era antes desta lista existir.
//
// Usado pela tela de Vendas e pelo "Registrar venda" da ficha do cliente. É um
// componente só justamente para as duas não divergirem com o tempo.

import {
  FORMAS_PAGAMENTO, formatBRL,
  normalizarPagamentos, pagamentosDaCondicao, resolverPagamentos, diferencaDosPagamentos,
} from '../data/repository.js'
import { Field, inputCls, Button } from './ui.jsx'
import { IconPlus, IconCheck, IconAlert } from './icons.jsx'

const FORMA_PADRAO = 'pix'

export const PAGAMENTO_VAZIO = {
  forma: FORMA_PADRAO, valor: '', parcelas: 1, primeiroVencimento: '', entrada: false,
}

// A lista que o formulário edita, a partir do que a venda já tem.
//
// Venda com formas gravadas devolve as dela. Venda de antes da migração 015 tem
// a condição antiga convertida, para o formulário abrir preenchido em vez de
// vazio. Venda nova começa com uma forma só, em branco — que vale o total.
export function pagamentosIniciais(venda, total) {
  const gravados = normalizarPagamentos(venda?.pagamentos)
  if (gravados.length) return gravados

  const daCondicao = pagamentosDaCondicao({
    total,
    formaPagamento: venda?.formaPagamento,
    condicao: venda?.condicao,
    entrada: venda?.entrada,
    parcelas: venda?.parcelas,
    primeiroVencimento: venda?.primeiroVencimento,
  })
  return daCondicao.length
    ? daCondicao
    : [{ ...PAGAMENTO_VAZIO, forma: venda?.formaPagamento || FORMA_PADRAO }]
}

export default function PagamentosVenda({ pagamentos, onChange, total }) {
  // O que será de fato gravado — com o campo em branco já resolvido. É sobre
  // ISSO que a conferência da soma fala, senão ela acusaria falta num plano que
  // na verdade fecha.
  const resolvidos = resolverPagamentos(pagamentos, total)
  const diferencaCent = diferencaDosPagamentos(total, resolvidos)
  const distribuido = normalizarPagamentos(resolvidos).reduce((soma, p) => soma + p.valor, 0)

  const indiceEntrada = pagamentos.findIndex((p) => p.entrada)
  const entrada = indiceEntrada >= 0 ? pagamentos[indiceEntrada] : null
  const formas = pagamentos.filter((p) => !p.entrada)

  const alterar = (indice, campos) =>
    onChange(pagamentos.map((p, i) => (i === indice ? { ...p, ...campos } : p)))

  // A entrada entra na frente da lista: é a primeira coisa que acontece na
  // venda, e a ordem da lista é a ordem em que os lançamentos são criados.
  function alternarEntrada(marcada) {
    if (marcada) {
      onChange([{ ...PAGAMENTO_VAZIO, forma: 'dinheiro', entrada: true }, ...pagamentos])
    } else {
      onChange(pagamentos.filter((p) => !p.entrada))
    }
  }

  function adicionarForma() {
    onChange([...pagamentos, { ...PAGAMENTO_VAZIO, valor: '' }])
  }

  function removerForma(indice) {
    // Nunca deixa a venda sem nenhuma forma de pagamento: some a última e o
    // formulário não teria mais onde dizer como o cliente pagou.
    const restante = pagamentos.filter((_, i) => i !== indice)
    onChange(restante.some((p) => !p.entrada) ? restante : [...restante, { ...PAGAMENTO_VAZIO }])
  }

  // Joga o que falta na última forma — o atalho para "o resto vai no cartão".
  function usarORestante() {
    const ultima = pagamentos.length - 1 - [...pagamentos].reverse().findIndex((p) => !p.entrada)
    const atual = Number(resolvidos[ultima]?.valor || 0)
    alterar(ultima, { valor: Math.max(0, atual + diferencaCent / 100) })
  }

  return (
    <div className="space-y-3">
      {/* 1. Entrada — opcional, e a primeira pergunta do balcão. */}
      <label className="flex items-start gap-2.5 cursor-pointer rounded-lg bg-slate-50 border border-slate-200 p-3">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600 cursor-pointer"
          checked={!!entrada}
          onChange={(e) => alternarEntrada(e.target.checked)}
        />
        <span>
          <span className="block text-[13px] font-medium text-slate-700">Houve entrada</span>
          <span className="block text-xs text-slate-400 mt-0.5">
            O que o cliente pagou na hora. Vence na data da venda e não parcela.
          </span>
        </span>
      </label>

      {entrada && (
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-white p-3">
          <Field label="Forma da entrada">
            <select
              className={inputCls}
              value={entrada.forma}
              onChange={(e) => alterar(indiceEntrada, { forma: e.target.value })}
            >
              {Object.entries(FORMAS_PAGAMENTO).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
            </select>
          </Field>
          <Field label="Valor da entrada (R$)">
            <input
              className={inputCls} type="number" min="0" step="0.01"
              value={entrada.valor}
              onChange={(e) => alterar(indiceEntrada, { valor: e.target.value })}
            />
          </Field>
        </div>
      )}

      {/* 2. As formas do restante, quantas forem. */}
      <div className="space-y-2">
        <p className="text-[13px] font-semibold text-slate-700">
          {entrada ? 'Restante' : 'Forma de pagamento'}
        </p>
        {pagamentos.map((pg, indice) => {
          if (pg.entrada) return null
          const ordem = formas.indexOf(pg)
          return (
            <div key={indice} className="grid grid-cols-2 sm:grid-cols-12 gap-2 items-end rounded-lg border border-slate-200 bg-white p-3">
              <div className="sm:col-span-4">
                <Field label={ordem === 0 ? 'Forma' : ''}>
                  <select
                    className={inputCls}
                    value={pg.forma}
                    onChange={(e) => alterar(indice, { forma: e.target.value })}
                  >
                    {Object.entries(FORMAS_PAGAMENTO).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
                  </select>
                </Field>
              </div>
              <div className="sm:col-span-3">
                <Field label={ordem === 0 ? 'Valor (R$)' : ''}>
                  <input
                    className={inputCls} type="number" min="0" step="0.01"
                    // Em branco vale o restante — o placeholder mostra quanto é,
                    // para ninguém precisar adivinhar o que vai ser gravado.
                    placeholder={formatBRL(resolvidos[indice]?.valor || 0)}
                    value={pg.valor}
                    onChange={(e) => alterar(indice, { valor: e.target.value })}
                  />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label={ordem === 0 ? 'Parcelas' : ''}>
                  <input
                    className={inputCls} type="number" min="1" step="1"
                    value={pg.parcelas}
                    onChange={(e) => alterar(indice, { parcelas: e.target.value })}
                  />
                </Field>
              </div>
              <div className="sm:col-span-3 flex items-end gap-1">
                <div className="flex-1">
                  <Field label={ordem === 0 ? '1º vencimento' : ''}>
                    <input
                      className={inputCls} type="date"
                      value={pg.primeiroVencimento}
                      onChange={(e) => alterar(indice, { primeiroVencimento: e.target.value })}
                    />
                  </Field>
                </div>
                {formas.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removerForma(indice)}
                    className="text-red-500 hover:text-red-700 text-lg leading-none cursor-pointer px-1 pb-2"
                    title="Remover esta forma"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
          )
        })}
        <Button type="button" variant="ghost" onClick={adicionarForma}>
          <IconPlus size={14} /> Adicionar forma de pagamento
        </Button>
      </div>

      {/* 3. A conferência. Uma venda cujo pagamento não fecha gera conta a
          receber errada — então a diferença fica à vista, e não escondida numa
          mensagem de erro só na hora de salvar. */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
        <div className="flex justify-between text-slate-500">
          <span>Total da venda</span>
          <span className="tnum">{formatBRL(total)}</span>
        </div>
        <div className="flex justify-between text-slate-500 mt-1">
          <span>Distribuído</span>
          <span className="tnum">{formatBRL(distribuido)}</span>
        </div>
        <div className="mt-2 pt-2 border-t border-slate-200">
          {diferencaCent === 0 ? (
            <p className="flex items-center gap-1.5 text-[13px] font-semibold text-emerald-700">
              <IconCheck size={15} /> As formas de pagamento fecham com o total.
            </p>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-[13px] font-semibold text-amber-700">
                <IconAlert size={15} />
                {diferencaCent > 0
                  ? `Falta distribuir ${formatBRL(diferencaCent / 100)}.`
                  : `Passou ${formatBRL(-diferencaCent / 100)} do total.`}
              </p>
              <Button type="button" variant="secondary" onClick={usarORestante}>
                {diferencaCent > 0 ? 'Jogar na última forma' : 'Ajustar a última forma'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
