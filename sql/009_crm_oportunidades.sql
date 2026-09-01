-- ============================================================================
-- Waterfall — Migração 009: CRM (funil de oportunidades)
-- ============================================================================
-- Rode este arquivo INTEIRO no SQL Editor do Supabase, depois da 008.
-- É idempotente (pode rodar de novo) e NÃO APAGA NADA.
--
-- O que ela traz:
--   1. `oportunidades` — a negociação em andamento, que é o cartão do Kanban.
--   2. `oportunidade_id` em `vendas` e `atividades` — a corrente nos dois sentidos.
--
-- POR QUE UMA TABELA NOVA E NÃO UMA COLUNA `etapa` EM `clientes`:
-- uma etapa no cadastro descreve o cliente HOJE e apaga o passado. O cliente
-- que comprou o purificador em março e volta em outubro atrás de um segundo
-- aparelho teria que sair de "ganho" e voltar para "contato" — e a primeira
-- negociação desapareceria. Uma oportunidade tem começo e fim: o cliente
-- acumula várias ao longo dos anos e o quadro mostra só as abertas.
--
-- Ela também fecha um buraco que existe hoje na rastreabilidade. A corrente ia
-- de `atividade` direto para `venda`, sem nada para o período em que o negócio
-- já existe mas ainda não tem pedido montado. É esse período que o funil
-- enxerga.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. OPORTUNIDADES — a negociação
-- ---------------------------------------------------------------------------
-- Convenção de nulos: a camada de dados converte string vazia em NULL (ver
-- paraColuna em src/data/repository.js). Por isso nada aqui é NOT NULL além de
-- id/criado_em, e os CHECK toleram NULL — igual às tabelas existentes.

create table if not exists public.oportunidades (
  id             uuid primary key default gen_random_uuid(),

  -- `set null` e não `cascade`, como nas demais tabelas: excluir um cliente não
  -- pode apagar o histórico do trabalho que você teve com ele.
  cliente_id     uuid references public.clientes(id) on delete set null,
  titulo         text,                    -- "Purificador para a cozinha"

  etapa          text default 'novo'
                 check (etapa in ('novo', 'contato', 'proposta', 'negociacao', 'ganho', 'perdido')),

  valor_estimado numeric(12,2) default 0, -- somado por coluna = o valor do funil
  produto_id     uuid references public.produtos(id) on delete set null,
  canal          text check (canal in ('indicacao', 'whatsapp', 'instagram', 'loja', 'telefone', 'site', 'outro')),
  responsavel    text,
  data_prevista  date,                    -- previsão de fechamento
  observacoes    text,

  -- Posição do cartão dentro da coluna. Numérico com folga (1000, 2000, 3000…)
  -- de propósito: mover um cartão calcula a média entre os dois vizinhos e
  -- grava UMA linha, em vez de renumerar a coluna inteira a cada arrasto.
  ordem          numeric(20,10) default 1000,

  -- Fechamento. `motivo_perda` é texto livre por escolha: a chave vem do
  -- dicionário MOTIVOS_PERDA do repositório, e o detalhe vai em `observacoes`.
  -- Sem CHECK aqui para que acrescentar um motivo novo não exija migração.
  motivo_perda   text,
  fechada_em     date,
  venda_id       uuid references public.vendas(id) on delete set null,

  -- A CORRENTE: de qual ligação/WhatsApp esta negociação nasceu.
  origem_atividade_id uuid references public.atividades(id) on delete set null,

  criado_por     text,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

-- (etapa, ordem) é exatamente como o quadro lê: uma coluna por vez, já ordenada.
create index if not exists oportunidades_etapa_idx   on public.oportunidades (etapa, ordem);
create index if not exists oportunidades_cliente_idx on public.oportunidades (cliente_id);
create index if not exists oportunidades_origem_idx  on public.oportunidades (origem_atividade_id);
-- Índice parcial das abertas: é a consulta que a tela faz o tempo todo, e as
-- fechadas só crescem.
create index if not exists oportunidades_abertas_idx on public.oportunidades (data_prevista)
  where etapa not in ('ganho', 'perdido');

-- `atualizado_em` automático, reaproveitando a função criada na migração 005.
drop trigger if exists oportunidades_atualizado_em on public.oportunidades;
create trigger oportunidades_atualizado_em
  before update on public.oportunidades
  for each row execute function public.tocar_atualizado_em();

-- ---------------------------------------------------------------------------
-- 2. A corrente no sentido inverso
-- ---------------------------------------------------------------------------
-- A oportunidade aponta para a venda que a fechou (`venda_id`); a venda aponta
-- de volta para a negociação que a originou. Guardar os dois lados é o que
-- permite responder tanto "no que deu esta negociação?" quanto "de onde veio
-- esta venda?" sem varrer tabela.
--
-- Em `atividades`, o vínculo serve ao próximo passo: a ligação marcada a partir
-- de um cartão do funil continua sabendo a qual negociação pertence.

alter table public.vendas
  add column if not exists oportunidade_id uuid references public.oportunidades(id) on delete set null;

alter table public.atividades
  add column if not exists oportunidade_id uuid references public.oportunidades(id) on delete set null;

create index if not exists vendas_oportunidade_idx     on public.vendas (oportunidade_id);
create index if not exists atividades_oportunidade_idx on public.atividades (oportunidade_id);

-- ---------------------------------------------------------------------------
-- 3. RLS — mesma política das demais tabelas: quem está logado usa tudo
-- ---------------------------------------------------------------------------
-- O `alter default privileges` da migração 007 já tira o papel `anon` das
-- tabelas criadas daqui em diante, mas isso sozinho não basta: sem RLS ligado
-- e sem política, a tabela nasce inacessível para o app e — pior — dependente
-- de um único mecanismo. As duas travas, como na 007.

alter table public.oportunidades enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'oportunidades'
                   and policyname = 'acesso_autenticado')
  then
    create policy acesso_autenticado on public.oportunidades
      for all to authenticated using (true) with check (true);
  end if;
end $$;

commit;

-- ---------------------------------------------------------------------------
-- 4. Recarrega o cache de schema da API
-- ---------------------------------------------------------------------------
-- Sem isto o PostgREST continua respondendo "Could not find the table" mesmo
-- com a tabela já criada. Fica FORA da transação porque o NOTIFY só dispara no
-- commit.

notify pgrst, 'reload schema';

-- ============================================================================
-- CONFERÊNCIA — rode depois, separado:
--
--   select c.relname, c.relrowsecurity as rls_ligado,
--          (select count(*) from pg_policies p
--            where p.schemaname = 'public' and p.tablename = c.relname) as politicas
--     from pg_class c
--     join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relname = 'oportunidades';
--   -- esperado: true / 1
--
--   select etapa, count(*), sum(valor_estimado) from public.oportunidades group by 1;
-- ============================================================================
