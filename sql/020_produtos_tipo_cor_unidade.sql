-- ============================================================================
-- Waterfall — Migração 020: tipos novos, cor e unidade de venda do produto
-- ============================================================================
-- Rode este arquivo INTEIRO no SQL Editor do Supabase. É idempotente (pode
-- rodar de novo sem quebrar) e não apaga nada do que já está cadastrado.
--
-- Três mudanças no catálogo:
--   1. o produto deixa de ser só "aparelho ou refil": passa a aceitar também
--      "acessorio" e "outro" (serviço, taxa, o que não é equipamento);
--   2. ganha uma cor opcional — só faz sentido em parte do catálogo, então
--      fica em branco no resto;
--   3. ganha a unidade de venda: mangueira sai por metro, e a quantidade da
--      venda passa a aceitar fração (2,5 m) quando a unidade não é "un".
-- ============================================================================

alter table public.produtos
  add column if not exists cor text;

-- 'un' como padrão para todo o catálogo antigo continuar se comportando como
-- hoje (peça inteira). A coluna aceita NULL: paraColuna() converte string vazia
-- em NULL, e o app lê ausência como 'un'.
alter table public.produtos
  add column if not exists unidade text default 'un';

update public.produtos set unidade = 'un' where unidade is null;

-- O tipo provavelmente nasceu com um CHECK que só permite aparelho/refil (é o
-- que a tabela tinha quando o sistema só vendia equipamento). Localizamos a
-- constraint pelo que ela restringe, seja qual for o nome, e a substituímos.
do $$
declare
  nome_constraint text;
begin
  for nome_constraint in
    select con.conname
      from pg_constraint con
      join pg_class cls on cls.oid = con.conrelid
      join pg_namespace ns on ns.oid = cls.relnamespace
     where ns.nspname = 'public'
       and cls.relname = 'produtos'
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%tipo%'
  loop
    execute format('alter table public.produtos drop constraint %I', nome_constraint);
  end loop;
end $$;

alter table public.produtos
  add constraint produtos_tipo_check
  check (tipo in ('aparelho', 'refil', 'acessorio', 'outro'));

-- Recarrega o cache de schema da API, senão o PostgREST continua sem enxergar
-- as colunas novas e responde erro ao salvar produtos.
notify pgrst, 'reload schema';

-- ============================================================================
-- A unidade também é congelada no item da venda, como já acontece com a
-- descrição: mudar depois a unidade do produto não pode reescrever o que já
-- foi vendido (nem o PDF que o cliente recebeu).
-- ============================================================================

alter table public.venda_itens
  add column if not exists unidade text default 'un';

update public.venda_itens set unidade = 'un' where unidade is null;

notify pgrst, 'reload schema';
