-- ============================================================================
-- Waterfall — Migração 027: as etapas do CRM passam a ser oito
-- ============================================================================
-- Rode este arquivo INTEIRO no SQL Editor do Supabase, depois da 026.
-- É idempotente (pode rodar de novo) e NÃO APAGA NADA.
--
-- O funil passa a ser:
--
--   contato       → Em contato
--   agendado      → Agendado
--   sem_resposta  → Sem resposta
--   adiado        → Adiado
--   proposta      → Em proposta
--   negociacao    → Em negociação
--   ganho         → Venda fechada
--   perdido       → Venda perdida
--
-- As chaves que já existiam ficam as mesmas (só o nome na tela mudou), então
-- nenhum cartão sai do lugar — exceto `novo`, que deixa de existir: quem
-- estava lá vai para o fim da coluna "Em contato", na ordem em que estava.
--
-- ORDEM DE PUBLICAÇÃO: publique a função `wa-webhook` ANTES de rodar este
-- arquivo. A versão nova já abre lead em `contato`, que a regra antiga aceita;
-- a antiga ainda grava `novo`, que a regra nova recusaria.
-- ============================================================================

-- A regra antiga nasceu sem nome explícito na 009; procura pelo que ela checa
-- em vez de confiar no nome gerado pelo Postgres.
do $$
declare
  regra text;
begin
  for regra in
    select conname
      from pg_constraint
     where conrelid = 'public.oportunidades'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%etapa%'
  loop
    execute format('alter table public.oportunidades drop constraint %I', regra);
  end loop;
end $$;

-- `novo` → fim de `contato`, preservando a ordem relativa entre eles.
update public.oportunidades o
   set etapa = 'contato',
       ordem = coalesce((select max(c.ordem) from public.oportunidades c where c.etapa = 'contato'), 0)
               + n.posicao * 1000
  from (
    select id, row_number() over (order by ordem, criado_em) as posicao
      from public.oportunidades
     where etapa = 'novo'
  ) n
 where o.id = n.id;

alter table public.oportunidades
  alter column etapa set default 'contato';

alter table public.oportunidades
  add constraint oportunidades_etapa_check
  check (etapa in ('contato', 'agendado', 'sem_resposta', 'adiado',
                   'proposta', 'negociacao', 'ganho', 'perdido'));

notify pgrst, 'reload schema';

-- Conferência:
--   select etapa, count(*) from public.oportunidades group by 1 order by 1;
