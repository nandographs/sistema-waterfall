-- ============================================================================
-- Waterfall — Migração 014: anotações dentro da conversa
-- ============================================================================
-- Rode este arquivo INTEIRO no SQL Editor do Supabase, depois da 013.
-- É idempotente (pode rodar de novo) e NÃO APAGA NADA.
--
-- O QUE MUDA
--
-- Duas colunas em `atividades`. Só isso — e a escolha de NÃO criar tabela nova
-- é a decisão que este arquivo registra.
--
-- POR QUE NÃO UMA TABELA `notas`
--
-- Porque a anotação já existe no sistema: `atividades` tem `tipo = 'nota'`
-- desde a migração 005, ela já nasce concluída (ver TIPOS_SEM_PENDENCIA) e já
-- aparece na linha do tempo do cliente. Uma tabela `notas` seria um segundo
-- lugar para a mesma coisa — e o dia em que alguém perguntasse "onde estão as
-- anotações deste cliente?" teria duas respostas, o que é o mesmo que nenhuma.
--
-- O que faltava não era a nota. Era ela saber de qual CONVERSA e de qual
-- NEGOCIAÇÃO estava falando. É o que entra aqui.
--
-- O EFEITO PRÁTICO: a nota escrita no atendimento pelo WhatsApp é o MESMO
-- registro que aparece no cartão do CRM e na ficha do cliente. Não há cópia,
-- não há sincronização para dar errado — é uma linha só, vista de três lugares.
-- É isso que faz outro atendente ler o aviso onde quer que ele abra a pessoa.
-- ============================================================================

begin;

alter table public.atividades
  -- De qual conversa a nota nasceu. `set null` e não `cascade`, como em todo o
  -- resto do sistema: apagar a conversa não pode apagar o que alguém anotou
  -- sobre o atendimento. A nota perde o fio, não a existência.
  add column if not exists conversa_id uuid references public.conversas(id) on delete set null,

  -- A qual negociação ela pertence. É o que faz a nota aparecer no cartão do
  -- funil — inclusive nos LEADS, que não têm `cliente_id` e por isso não
  -- apareceriam por nenhum outro caminho.
  add column if not exists oportunidade_id uuid references public.oportunidades(id) on delete set null;

-- As duas consultas que a tela faz: "as notas desta conversa" e "as notas deste
-- cartão". Ambas são por igualdade e ordenadas por data — índice simples resolve.
create index if not exists atividades_conversa_idx     on public.atividades (conversa_id);
create index if not exists atividades_oportunidade_idx on public.atividades (oportunidade_id);

commit;

notify pgrst, 'reload schema';

-- ============================================================================
-- CONFERÊNCIA — rode depois, separado:
--
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'atividades'
--      and column_name in ('conversa_id', 'oportunidade_id');
--   -- esperado: as duas
-- ============================================================================
