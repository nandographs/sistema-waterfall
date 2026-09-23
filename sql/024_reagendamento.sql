-- ============================================================================
-- Waterfall — Migração 024: reagendar um serviço
-- ============================================================================
-- Rode este arquivo INTEIRO no SQL Editor do Supabase, depois da 023.
-- É idempotente (pode rodar de novo) e NÃO APAGA NADA.
--
-- Até aqui, mudar a data de um serviço o MOVIA: o dia original simplesmente
-- deixava de existir. Quem olhasse a semana passada não via nada — e a pergunta
-- que sempre aparece ("esse cliente já desmarcou quantas vezes?") não tinha
-- onde ser respondida.
--
-- Reagendar passa a ser outra coisa: o dia original fica no lugar, encerrado
-- como `reagendado`, e nasce um serviço novo no dia combinado. Os dois ficam
-- ligados pelos campos abaixo, então a agenda conta a história inteira.
--
--   reagendado_para_id   → no registro ANTIGO: para onde ele foi
--   reagendado_de_id     → no registro NOVO: de onde ele veio
--   motivo_reagendamento → no registro ANTIGO: por que mudou (opcional)
--
-- POR QUE UM STATUS NOVO E NÃO 'cancelado':
-- cancelado é um serviço que não vai acontecer. Reagendado é um serviço que vai
-- acontecer, só que noutro dia. Somar os dois faria a tela de cancelados mentir
-- sobre a taxa de desistência, que é justamente o número que essas duas
-- situações existem para separar.
-- ============================================================================

alter table public.agendamentos
  add column if not exists reagendado_para_id uuid references public.agendamentos(id) on delete set null;

alter table public.agendamentos
  add column if not exists reagendado_de_id uuid references public.agendamentos(id) on delete set null;

alter table public.agendamentos
  add column if not exists motivo_reagendamento text;

create index if not exists agendamentos_reagendado_de_idx
  on public.agendamentos (reagendado_de_id);

-- ---------------------------------------------------------------------------
-- O status 'reagendado' precisa caber no CHECK que já existe na coluna.
-- ---------------------------------------------------------------------------
-- A restrição foi criada à mão quando a tabela nasceu, então o nome dela varia
-- de instalação para instalação: procuramos pela DEFINIÇÃO. O `\mstatus\M` é
-- fronteira de palavra — ele casa com a restrição de `status` e ignora a de
-- `status_pagamento`, que tem que continuar como está.

do $$
declare
  restricao record;
begin
  for restricao in
    select conname
      from pg_constraint
     where conrelid = 'public.agendamentos'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ~ '\mstatus\M'
  loop
    execute format('alter table public.agendamentos drop constraint %I', restricao.conname);
  end loop;

  alter table public.agendamentos
    add constraint agendamentos_status_check
    check (status is null or status in ('agendado', 'concluido', 'cancelado', 'reagendado'));
end $$;

comment on column public.agendamentos.reagendado_para_id is
  'No registro antigo: o serviço novo que nasceu do reagendamento.';
comment on column public.agendamentos.reagendado_de_id is
  'No registro novo: o serviço original, que ficou no dia em que estava marcado.';
comment on column public.agendamentos.motivo_reagendamento is
  'Por que o serviço saiu do dia original (opcional).';

notify pgrst, 'reload schema';

-- ============================================================================
-- Conferência rápida (rode depois, separado):
--
--   select column_name from information_schema.columns
--    where table_name = 'agendamentos'
--      and column_name in ('reagendado_para_id','reagendado_de_id','motivo_reagendamento');
--
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.agendamentos'::regclass and contype = 'c';
-- ============================================================================
