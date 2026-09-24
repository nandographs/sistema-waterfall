-- ============================================================================
-- Waterfall — Migração 025: compatibilidade de mão dupla e quantidade no serviço
-- ============================================================================
-- Rode este arquivo INTEIRO no SQL Editor do Supabase, depois da 024.
-- É idempotente (pode rodar de novo) e NÃO APAGA NADA.
--
-- Duas mudanças:
--
-- 1. COMPATIBILIDADE N:N ENTRE PRODUTOS
--    Até aqui o vínculo era um só e morava no refil (aparelho_compativel_id):
--    um refil servia UM aparelho, e um aparelho tinha UM refil. O catálogo real
--    não é assim — a mesma vela serve três purificadores, e um purificador
--    aceita dois refis diferentes.
--
--    Agora cada produto guarda a LISTA de produtos compatíveis com ele, e a
--    lista é simétrica: se A tem B, B tem A. Quem grava (salvarProduto, no
--    app) mantém os dois lados em dia.
--
--    A coluna antiga continua na tabela, intocada: é a fonte do backfill
--    abaixo e a rede de segurança de quem abrir o sistema antes desta migração.
--
-- 2. QUANTIDADE POR PRODUTO NO SERVIÇO
--    O agendamento já listava vários produtos (produto_ids), mas um de cada.
--    Trocar quatro refis na mesma visita virava quatro linhas iguais — ou, pior,
--    uma linha só, e a Ordem de Serviço saía cobrando um refil.
--    produto_quantidades guarda { "<id do produto>": <quantidade> }.
-- ============================================================================

alter table public.produtos
  add column if not exists compativeis_ids uuid[] default '{}'::uuid[];

update public.produtos set compativeis_ids = '{}'::uuid[] where compativeis_ids is null;

comment on column public.produtos.compativeis_ids is
  'Produtos compatíveis com este (refis de um aparelho, aparelhos de um refil). Simétrica: se A tem B, B tem A.';

-- Backfill do vínculo antigo, nos dois sentidos e sem duplicar. Roda de novo
-- sem efeito: o array_append só entra quando o id ainda não está na lista.
update public.produtos r
   set compativeis_ids = array_append(coalesce(r.compativeis_ids, '{}'::uuid[]), r.aparelho_compativel_id)
 where r.aparelho_compativel_id is not null
   and not (coalesce(r.compativeis_ids, '{}'::uuid[]) @> array[r.aparelho_compativel_id]);

update public.produtos a
   set compativeis_ids = array_append(coalesce(a.compativeis_ids, '{}'::uuid[]), r.id)
  from public.produtos r
 where r.aparelho_compativel_id = a.id
   and not (coalesce(a.compativeis_ids, '{}'::uuid[]) @> array[r.id]);

-- ----------------------------------------------------------------------------

alter table public.agendamentos
  add column if not exists produto_quantidades jsonb default '{}'::jsonb;

update public.agendamentos set produto_quantidades = '{}'::jsonb where produto_quantidades is null;

comment on column public.agendamentos.produto_quantidades is
  'Quantidade de cada produto do serviço: { "<produto_id>": <quantidade> }. Ausente = 1.';

-- Recarrega o cache de schema da API, senão o PostgREST continua sem enxergar
-- as colunas novas e responde erro ao salvar.
notify pgrst, 'reload schema';
