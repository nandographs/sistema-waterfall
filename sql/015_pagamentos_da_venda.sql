-- ============================================================================
-- Waterfall — Migração 015: várias formas de pagamento na mesma venda
-- ============================================================================
-- Rode este arquivo INTEIRO no SQL Editor do Supabase, depois da 014.
-- É idempotente (pode rodar de novo) e NÃO APAGA NADA.
--
-- O QUE MUDA
--
-- Uma coluna em `vendas`. Só isso.
--
-- O PROBLEMA
--
-- No balcão o cliente paga R$ 500 de entrada em dinheiro e os R$ 2.500
-- restantes em 3x no cartão. Até aqui a venda tinha UMA `forma_pagamento`, e
-- registrar isso obrigava a escolher uma das duas e mentir na outra — o que
-- fazia o relatório de "quanto entrou em cada forma" nascer errado.
--
-- POR QUE JSONB E NÃO UMA TABELA `venda_pagamentos`
--
-- Porque um pagamento não tem vida própria. Ele nunca é consultado sozinho,
-- nunca é editado sozinho e é sempre regravado junto com a venda — exatamente
-- como os itens já são hoje (ver salvarVenda). Uma tabela filha cobraria FK,
-- cascata, índice e um store novo para guardar uma lista de duas linhas que só
-- existe dentro do formulário da venda.
--
-- E, principalmente: o dinheiro DE VERDADE quebrado por forma já mora em
-- `lancamentos.forma_pagamento`, que é de onde o Financeiro soma. Cada forma
-- desta lista gera as suas parcelas lá, cada uma com a forma dela. A lista aqui
-- é o PLANO; o caixa continua sendo a fonte única do que entrou.
--
-- O FORMATO
--
--   [
--     { "forma": "dinheiro", "valor": 500,  "parcelas": 1, "primeiroVencimento": "", "entrada": true },
--     { "forma": "cartao",   "valor": 2500, "parcelas": 3, "primeiroVencimento": "2026-08-25" }
--   ]
--
-- As chaves são camelCase de propósito: a conversão snake_case ↔ camelCase do
-- repositório só toca nas colunas de primeiro nível, nunca dentro do JSON. Ou
-- seja, o que está aqui dentro é lido pelo app exatamente como foi gravado.
--
-- `entrada: true` não é um tipo diferente de pagamento — é o dinheiro da hora:
-- vence na data da venda e não se parcela.
--
-- AS COLUNAS ANTIGAS CONTINUAM
--
-- `forma_pagamento`, `condicao`, `entrada` e `parcelas` ficam onde estão, agora
-- preenchidas como RESUMO derivado da lista (ver resumoDosPagamentos). É o que
-- mantém funcionando, sem tocar em nada, o campo "Forma:" do Pedido em DOCX/PDF,
-- o agendamento gerado pela venda e todas as telas escritas antes desta lista.
-- Elas deixam de ser digitadas à parte, e por isso não têm como discordar dela.
--
-- Venda gravada antes desta migração fica com `[]` e continua sendo lida pela
-- condição antiga — nenhum registro precisa ser convertido.
-- ============================================================================

begin;

alter table public.vendas
  add column if not exists pagamentos jsonb default '[]'::jsonb;

-- Sem NOT NULL: a convenção do repositório é converter string vazia em NULL
-- (ver paraColuna), e uma coluna NOT NULL transformaria um campo esquecido num
-- erro de gravação. O app trata NULL como lista vazia.

comment on column public.vendas.pagamentos is
  'Formas de pagamento da venda: [{forma, valor, parcelas, primeiroVencimento, entrada}]. '
  'Cada uma gera as suas parcelas em lancamentos, com a forma dela. '
  'Lista vazia = usar a condição antiga (forma_pagamento/condicao/entrada/parcelas).';

commit;

-- Se a API do PostgREST ainda não enxergar a coluna nova, rode:
--   notify pgrst, 'reload schema';
