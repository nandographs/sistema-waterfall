-- ============================================================================
-- Waterfall — Migração 023: quem criou o agendamento
-- ============================================================================
-- Rode este arquivo INTEIRO no SQL Editor do Supabase, depois da 022.
-- É idempotente (pode rodar de novo) e NÃO APAGA NADA.
--
-- Um agendamento nasce de dois jeitos: alguém marca à mão, ou o sistema marca
-- sozinho (a instalação gerada pela venda, a próxima troca de refil agendada ao
-- concluir a anterior). Na agenda os dois pareciam iguais.
--
--   criado_por  → nome de quem estava logado. No automático, é quem fez a ação
--                 que disparou o agendamento (a venda, a conclusão).
--   automatico  → true quando foi o sistema que marcou.
--
-- Os agendamentos anteriores a esta migração ficam com os dois vazios; a tela
-- reconhece os automáticos antigos pelas marcas que eles já deixavam.
-- ============================================================================

alter table public.agendamentos
  add column if not exists criado_por text;

alter table public.agendamentos
  add column if not exists automatico boolean not null default false;

comment on column public.agendamentos.criado_por is
  'Usuário logado quando o agendamento foi criado (no automático, quem disparou a ação).';
comment on column public.agendamentos.automatico is
  'true quando o agendamento foi criado pelo sistema (venda, troca de refil programada).';

notify pgrst, 'reload schema';
