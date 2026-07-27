-- ============================================================================
-- Waterfall — Migração 003: data de conclusão do agendamento
-- ============================================================================
-- Rode este arquivo INTEIRO no SQL Editor do Supabase, depois do 002.
-- É idempotente e não apaga nada.
--
-- Por que isso é necessário: o ciclo de troca de refil precisa saber QUANDO o
-- serviço foi de fato realizado, não quando ele estava marcado. Se a troca era
-- para 01/06 e só aconteceu em 15/06, a próxima é 6 meses a partir de 15/06 —
-- porque a vida do filtro começa a contar quando ele é instalado.
-- ============================================================================

alter table public.agendamentos
  add column if not exists concluido_em date;

-- Preenche o histórico: para os que já estão concluídos, o melhor palpite
-- disponível é a data em que estavam marcados.
update public.agendamentos
   set concluido_em = data
 where status = 'concluido'
   and concluido_em is null
   and data is not null;

notify pgrst, 'reload schema';
