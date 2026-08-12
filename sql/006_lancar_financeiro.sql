-- ============================================================================
-- Waterfall — Migração 006: escolher se o registro entra no financeiro
-- ============================================================================
-- Rode este arquivo INTEIRO no SQL Editor do Supabase, depois do 005.
-- É idempotente e não apaga nada.
--
-- Por que isso é necessário: até aqui, todo agendamento com valor e toda venda
-- confirmada viravam lançamento automaticamente, sem escolha. Nem todo serviço
-- cobrado deve entrar no caixa — cortesia, garantia, retrabalho, acerto por
-- fora, serviço que outra pessoa vai faturar.
--
-- A chave mora AQUI, na origem, e não no lançamento: a sincronia recalcula os
-- lançamentos a cada gravação do agendamento/venda, então apagar a linha lá no
-- Financeiro sem desligar a origem faria ela reaparecer na próxima edição.
--
-- Default true preserva o comportamento atual para tudo que já existe.
-- ============================================================================

alter table public.agendamentos
  add column if not exists lancar_financeiro boolean not null default true;

alter table public.vendas
  add column if not exists lancar_financeiro boolean not null default true;

notify pgrst, 'reload schema';
