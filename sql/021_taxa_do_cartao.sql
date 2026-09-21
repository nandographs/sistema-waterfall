-- ============================================================================
-- Waterfall — Migração 021: taxa do cartão no agendamento
-- ============================================================================
-- Rode este arquivo INTEIRO no SQL Editor do Supabase, depois da 020.
-- É idempotente (pode rodar de novo) e NÃO APAGA NADA.
--
-- Pagamento no cartão tem taxa da maquininha. Cada parcela entra no financeiro
-- já LÍQUIDA (valor − taxa), que é o que a operadora de fato repassa — ver
-- planoDePagamentos.
--
-- Na VENDA a taxa mora dentro de `vendas.pagamentos` (o JSON da migração 015,
-- chave "taxa" em cada forma), então lá não há coluna nova. O agendamento tem
-- uma forma só, e por isso ganha esta coluna.
-- ============================================================================

alter table public.agendamentos
  add column if not exists taxa_cartao numeric(5,2) default 0;

comment on column public.agendamentos.taxa_cartao is
  'Taxa do cartão em % (só quando forma_pagamento = cartao). As parcelas entram líquidas no financeiro.';

notify pgrst, 'reload schema';
