-- ============================================================================
-- Waterfall — Migração 022: intervalo de troca de refil combinado na venda
-- ============================================================================
-- Rode este arquivo INTEIRO no SQL Editor do Supabase, depois da 021.
-- É idempotente (pode rodar de novo) e NÃO APAGA NADA.
--
-- O refil tem um intervalo padrão (produtos.intervalo_troca_meses). Na venda dá
-- para combinar outro com o cliente — o refil diz 6 meses, mas para aquela
-- casa ficou 9 — e o combinado VALE MAIS que o padrão.
--
-- O valor viaja pela cadeia inteira, para o ciclo não voltar ao padrão depois
-- da primeira troca:
--   vendas        → o que foi combinado;
--   agendamentos  → a instalação/troca gerada leva o combinado, e concluí-la
--                   agenda a próxima troca com ele;
--   equipamentos  → a ficha do cliente calcula a "próxima troca" com ele.
--
-- Vazio (null) em qualquer um dos três = usa o padrão do refil.
-- ============================================================================

alter table public.vendas
  add column if not exists intervalo_troca_meses integer check (intervalo_troca_meses > 0);

alter table public.agendamentos
  add column if not exists intervalo_troca_meses integer check (intervalo_troca_meses > 0);

alter table public.equipamentos
  add column if not exists intervalo_troca_meses integer check (intervalo_troca_meses > 0);

comment on column public.vendas.intervalo_troca_meses is
  'Meses entre trocas de refil combinados nesta venda. Vale mais que o intervalo do refil.';
comment on column public.agendamentos.intervalo_troca_meses is
  'Intervalo combinado herdado da venda; ao concluir, a próxima troca é agendada com ele.';
comment on column public.equipamentos.intervalo_troca_meses is
  'Intervalo combinado para este equipamento. Vazio = padrão do refil.';

notify pgrst, 'reload schema';
