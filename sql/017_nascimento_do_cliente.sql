-- ============================================================================
-- Waterfall — Migração 017: data de nascimento do cliente
-- ============================================================================
-- Rode este arquivo INTEIRO no SQL Editor do Supabase, depois da 016.
-- É idempotente (pode rodar de novo) e NÃO APAGA NADA.
--
-- O QUE MUDA
--
-- Uma coluna em `clientes`.
--
-- POR QUÊ
--
-- O modelo do Pedido de Venda tem um campo "Data de nascimento" desde sempre,
-- mas o cadastro não guardava nenhuma — então ele saía em branco ou era
-- redigitado a cada emissão. O cônjuge ganhou a data na migração 016; deixar o
-- titular sem ela era a assimetria que sobrou.
--
-- O nome é `nascimento` (e não `data_nascimento`) por simetria com
-- `conjuge_nascimento`, que já existe.
-- ============================================================================

begin;

alter table public.clientes
  add column if not exists nascimento date;

comment on column public.clientes.nascimento is
  'Data de nascimento do titular. Preenche o campo correspondente do Pedido de Venda.';

commit;

-- Se a API do PostgREST ainda não enxergar a coluna nova, rode:
--   notify pgrst, 'reload schema';
