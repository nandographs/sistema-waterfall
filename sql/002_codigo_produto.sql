-- ============================================================================
-- Waterfall — Migração 002: código do produto
-- ============================================================================
-- Rode este arquivo INTEIRO no SQL Editor do Supabase, depois do 001.
-- É idempotente (pode rodar de novo sem quebrar) e não apaga nada.
--
-- Adiciona um código próprio ao produto (SKU, referência do fabricante, o que
-- fizer sentido para você). Serve para achar o produto rápido na busca dos
-- agendamentos e das vendas, sem depender de lembrar o nome exato.
-- ============================================================================

alter table public.produtos
  add column if not exists codigo text;

-- Busca por código é sempre por igualdade ou prefixo; o índice deixa isso
-- instantâneo mesmo com o catálogo grande.
create index if not exists produtos_codigo_idx on public.produtos (codigo);

-- Sem NOT NULL nem UNIQUE de propósito:
--   * a camada de dados converte string vazia em NULL (ver paraColuna em
--     src/data/repository.js), então NOT NULL quebraria no primeiro salvamento;
--   * produtos antigos ficam sem código até você preencher, e vários NULL
--     conviveriam mal com UNIQUE.
-- Se um dia quiser garantir que não haja código repetido, este índice cobre
-- só os preenchidos:
--
--   create unique index produtos_codigo_unico_idx
--       on public.produtos (codigo) where codigo is not null;

-- Recarrega o cache de schema da API, senão o PostgREST continua sem enxergar
-- a coluna nova e responde erro ao salvar produtos.
notify pgrst, 'reload schema';
