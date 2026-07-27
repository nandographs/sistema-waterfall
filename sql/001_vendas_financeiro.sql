-- ============================================================================
-- Waterfall — Migração 001: módulo de Vendas e Financeiro
-- ============================================================================
-- Rode este arquivo INTEIRO de uma vez no SQL Editor do Supabase.
-- Ele é idempotente (pode rodar de novo sem quebrar) e NÃO APAGA NADA:
-- a tabela `vendas` atual é renomeada para `vendas_legado`, preservando os
-- dados, e uma nova `vendas` (a venda comercial) é criada no lugar.
--
-- O que esta migração faz, em ordem:
--   1. Cria `lancamentos`  — o caixa único (entradas e saídas).
--   2. Copia as linhas da `vendas` atual para `lancamentos`.
--   3. Renomeia `vendas` -> `vendas_legado` (backup intocado).
--   4. Cria a nova `vendas` (cabeçalho do pedido) e `venda_itens` (as linhas).
--   5. Liga `agendamentos` ao caixa novo (coluna `lancamento_id`).
--
-- Por que um caixa único: você decidiu que a cobrança pode nascer de uma Venda
-- OU de um agendamento avulso. As duas origens gravam em `lancamentos`, então
-- o dinheiro é somado num lugar só e nunca conta em dobro.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. LANÇAMENTOS — o caixa único
-- ---------------------------------------------------------------------------
-- Um lançamento é UMA movimentação de dinheiro prevista ou realizada.
--   tipo='entrada'  -> conta a receber  (venda, serviço)
--   tipo='saida'    -> conta a pagar    (despesa, fornecedor, estoque)
--   status='previsto'  -> ainda não caiu; `vencimento` diz quando deve cair
--   status='realizado' -> caiu; `data_pagamento` diz quando caiu
-- Venda parcelada gera VÁRIOS lançamentos (um por parcela), cada um com seu
-- vencimento — é isso que permite projetar o fluxo de caixa mês a mês.

-- Convenção de nulos: a camada de dados do app converte string vazia em NULL
-- (ver paraColuna em src/data/repository.js). Por isso NENHUMA coluna aqui é
-- NOT NULL além de id/criado_em — os CHECK toleram NULL, e os defaults cobrem
-- os campos omitidos. É a mesma convenção das tabelas que já existem.

create table if not exists public.lancamentos (
  id              uuid primary key default gen_random_uuid(),
  tipo            text        default 'entrada'
                              check (tipo in ('entrada', 'saida')),
  status          text        default 'previsto'
                              check (status in ('previsto', 'realizado')),
  descricao       text,
  categoria       text,
  valor           numeric(12,2) default 0,

  vencimento      date,                 -- quando deve entrar/sair
  data_pagamento  date,                 -- quando de fato entrou/saiu
  forma_pagamento text,

  -- Parcelamento: parcela 2 de 3 -> parcela=2, parcelas=3. À vista -> 1 de 1.
  parcela         integer     default 1,
  parcelas        integer     default 1,

  -- De onde este dinheiro veio. Só um dos vínculos costuma estar preenchido.
  origem          text        default 'manual'
                              check (origem in ('venda', 'agendamento', 'manual')),
  cliente_id      uuid references public.clientes(id) on delete set null,
  venda_id        uuid,                 -- FK adicionada no passo 4
  agendamento_id  uuid references public.agendamentos(id) on delete set null,

  observacoes     text,
  criado_por      text,
  criado_em       timestamptz not null default now()
);

create index if not exists lancamentos_vencimento_idx     on public.lancamentos (vencimento);
create index if not exists lancamentos_status_tipo_idx    on public.lancamentos (status, tipo);
create index if not exists lancamentos_cliente_idx        on public.lancamentos (cliente_id);
create index if not exists lancamentos_venda_idx          on public.lancamentos (venda_id);
create index if not exists lancamentos_agendamento_idx    on public.lancamentos (agendamento_id);

-- ---------------------------------------------------------------------------
-- 2. Copia o financeiro atual (tabela `vendas` de hoje) para o caixa novo
-- ---------------------------------------------------------------------------
-- Hoje cada linha de `vendas` é, na prática, um registro financeiro criado
-- automaticamente por um agendamento com valor. Cada uma vira UM lançamento de
-- entrada. Parceladas viram uma linha só (parcela 1 de N) porque o sistema
-- antigo não guardava os vencimentos individuais — o histórico fica honesto e,
-- daqui pra frente, toda venda nova já nasce parcela a parcela.
--
-- O `where not exists` torna o passo repetível: rodar de novo não duplica.

do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'vendas')
     and exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'vendas'
                   and column_name = 'agendamento_id')
  then
    insert into public.lancamentos (
      id, tipo, status, descricao, categoria, valor,
      vencimento, data_pagamento, forma_pagamento,
      parcela, parcelas, origem, cliente_id, agendamento_id, criado_em
    )
    select
      v.id,
      'entrada',
      case when v.status = 'pago' then 'realizado' else 'previsto' end,
      coalesce(p.nome, 'Serviço'),
      'venda',
      coalesce(v.valor, 0),
      v.data,
      case when v.status = 'pago' then v.data end,
      v.forma_pagamento,
      1,
      greatest(coalesce(v.parcelas, 1), 1),
      case when v.agendamento_id is not null then 'agendamento' else 'venda' end,
      v.cliente_id,
      v.agendamento_id,
      coalesce(v.criado_em, now())
    from public.vendas v
    left join public.produtos p on p.id = v.produto_id
    where not exists (select 1 from public.lancamentos l where l.id = v.id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Aposenta a `vendas` antiga (renomeia; nada é apagado)
-- ---------------------------------------------------------------------------
-- Depois de conferir que o sistema novo está redondo, você pode apagar a
-- `vendas_legado` à mão. Até lá ela fica aí como rede de segurança.

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'vendas'
               and column_name = 'agendamento_id')
  then
    alter table public.vendas rename to vendas_legado;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. VENDAS (cabeçalho do pedido) e VENDA_ITENS (as linhas)
-- ---------------------------------------------------------------------------
-- Uma venda é o documento comercial: para quem, quando, o que, por quanto e
-- como paga. Os campos espelham o modelo do Pedido em DOCX/PDF, para o
-- documento sair preenchido sem digitação extra.

create table if not exists public.vendas (
  id                    uuid primary key default gen_random_uuid(),
  numero                text,                               -- "PEDIDO Nº" do documento
  cliente_id            uuid        references public.clientes(id) on delete set null,
  data                  date,
  validade_dias         integer,                            -- validade da proposta

  tipo                  text        default 'venda'
                                    check (tipo in ('venda', 'orcamento')),
  canal                 text        check (canal in ('loja', 'whatsapp', 'telefone', 'externo')),
  status                text        default 'proposta'
                                    check (status in ('proposta', 'confirmada', 'cancelada')),

  -- Totais (calculados na tela, gravados aqui para o documento e os relatórios)
  subtotal              numeric(12,2) default 0,
  desconto              numeric(12,2) default 0,
  frete                 numeric(12,2) default 0,
  total                 numeric(12,2) default 0,

  -- Condição de pagamento — vira os lançamentos a receber
  forma_pagamento       text        default 'pix',
  condicao              text        default 'a_vista'
                                    check (condicao in ('a_vista', 'parcelado')),
  entrada               numeric(12,2) default 0,
  parcelas              integer     default 1,
  primeiro_vencimento   date,

  -- Atendimento e entrega
  consultor             text,
  consultor_telefone    text,
  distribuidor          text,
  distribuidor_telefone text,
  entrega_tipo          text        check (entrega_tipo in ('retirada', 'endereco_cliente', 'outro')),
  entrega_endereco      text,
  entrega_previsao      date,

  observacoes           text,

  -- Rastreabilidade do documento emitido (espelha os_numero/os_emitida_em)
  pedido_numero         text,
  pedido_emitido_em     timestamptz,

  criado_por            text,
  criado_em             timestamptz not null default now()
);

create index if not exists vendas_cliente_idx on public.vendas (cliente_id);
create index if not exists vendas_data_idx    on public.vendas (data);
create index if not exists vendas_status_idx  on public.vendas (status);

-- Uma linha por produto/serviço da venda. `on delete cascade`: apagar a venda
-- leva os itens junto. A descrição é congelada no item para o pedido antigo não
-- mudar de texto se o produto for renomeado depois.
create table if not exists public.venda_itens (
  id             uuid primary key default gen_random_uuid(),
  venda_id       uuid        not null references public.vendas(id) on delete cascade,
  produto_id     uuid        references public.produtos(id) on delete set null,
  descricao      text,
  quantidade     numeric(12,3) default 1,
  valor_unitario numeric(12,2) default 0,
  desconto       numeric(12,2) default 0,
  valor_total    numeric(12,2) default 0,
  ordem          integer     default 0,
  criado_em      timestamptz not null default now()
);

create index if not exists venda_itens_venda_idx on public.venda_itens (venda_id);

-- Agora que a nova `vendas` existe, liga o caixa a ela.
do $$
begin
  if not exists (select 1 from information_schema.table_constraints
                 where constraint_schema = 'public'
                   and constraint_name = 'lancamentos_venda_id_fkey')
  then
    alter table public.lancamentos
      add constraint lancamentos_venda_id_fkey
      foreign key (venda_id) references public.vendas(id) on delete cascade;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Agendamentos: aponta para o caixa novo
-- ---------------------------------------------------------------------------
-- A coluna antiga `venda_id` continua existindo (apontando para vendas_legado)
-- e deixa de ser usada. Quando você apagar a vendas_legado, apague-a também.

alter table public.agendamentos
  add column if not exists lancamento_id uuid references public.lancamentos(id) on delete set null;

-- Reaproveita o vínculo antigo: como cada lançamento migrado herdou o id da
-- venda antiga, o venda_id do agendamento já aponta para o lançamento certo.
update public.agendamentos a
   set lancamento_id = a.venda_id
 where a.lancamento_id is null
   and a.venda_id is not null
   and exists (select 1 from public.lancamentos l where l.id = a.venda_id);

-- Uma venda pode ter gerado o agendamento (instalação / troca de refil).
alter table public.agendamentos
  add column if not exists venda_origem_id uuid references public.vendas(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 6. RLS — mesma política das tabelas existentes: quem está logado usa tudo
-- ---------------------------------------------------------------------------
-- ATENÇÃO: confira se bate com a política das suas tabelas atuais (clientes,
-- produtos...). Se as suas forem mais restritas, ajuste estas do mesmo jeito.

alter table public.lancamentos  enable row level security;
alter table public.vendas       enable row level security;
alter table public.venda_itens  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['lancamentos', 'vendas', 'venda_itens'] loop
    if not exists (select 1 from pg_policies
                   where schemaname = 'public' and tablename = t
                     and policyname = 'acesso_autenticado')
    then
      execute format(
        'create policy acesso_autenticado on public.%I
           for all to authenticated using (true) with check (true)', t);
    end if;
  end loop;
end $$;

commit;

-- ---------------------------------------------------------------------------
-- 7. Recarrega o cache de schema da API
-- ---------------------------------------------------------------------------
-- O PostgREST (a API REST do Supabase) guarda em cache a lista de tabelas. Sem
-- este aviso ele continua respondendo "Could not find the table ... in the
-- schema cache" mesmo com as tabelas já criadas. Fica FORA da transação porque
-- o NOTIFY só dispara no commit.

notify pgrst, 'reload schema';

-- ============================================================================
-- Conferência rápida (rode depois, separado, para ver se deu certo):
--
--   select count(*) as lancamentos from public.lancamentos;
--   select count(*) as legado      from public.vendas_legado;
--   -- os dois números acima devem bater
--
--   select tipo, status, count(*), sum(valor)
--     from public.lancamentos group by 1, 2;
-- ============================================================================
