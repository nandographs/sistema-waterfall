-- ============================================================================
-- Waterfall — Migração 026: o serviço sabe em qual aparelho foi feito
-- ============================================================================
-- Rode este arquivo INTEIRO no SQL Editor do Supabase, depois da 025.
-- É idempotente (pode rodar de novo) e NÃO APAGA NADA.
--
-- Até aqui, uma troca de refil concluída marcava "o primeiro aparelho
-- compatível que estiver na ficha". Com um purificador só, dá certo. Com dois
-- iguais na mesma casa, a troca do segundo caía sempre no primeiro — e a
-- manutenção nem isso: ficava solta no histórico do cliente, sem dono.
--
--   equipamento_id → o aparelho da ficha em que o serviço foi feito
--
-- É o que permite a cada equipamento ter o PRÓPRIO histórico de trocas e
-- manutenções. Opcional: serviço antigo (ou de cliente sem nada na ficha) fica
-- sem, e o histórico o reconhece pelos produtos, como antes.
--
-- ON DELETE SET NULL: tirar o aparelho da ficha não apaga o que foi feito nele.
-- O serviço continua no histórico do cliente e no caixa.
-- ============================================================================

alter table public.agendamentos
  add column if not exists equipamento_id uuid references public.equipamentos(id) on delete set null;

create index if not exists agendamentos_equipamento_idx
  on public.agendamentos (equipamento_id);

comment on column public.agendamentos.equipamento_id is
  'O equipamento da ficha do cliente em que o serviço foi feito (opcional).';

notify pgrst, 'reload schema';
