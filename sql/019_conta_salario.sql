-- ============================================================================
-- Waterfall — Migração 019: conta salário do funcionário
-- ============================================================================
-- Rode este arquivo INTEIRO no SQL Editor do Supabase, depois do 018.
-- É idempotente (pode rodar de novo) e não apaga nada.
--
-- O que ela resolve: hoje um pagamento a funcionário é só mais uma saída na
-- categoria "Salários e pró-labore", solta no caixa. Não dá para responder a
-- pergunta que interessa no fim do mês — "quanto ainda falta pagar pro Fulano,
-- descontando os vales que ele já pegou?".
--
-- O desenho é o mesmo do resto do sistema: NADA de tabela nova de saldo. O
-- saldo é CALCULADO a partir dos lançamentos que já existem (ver contaSalario
-- em src/data/financeiro.js). Guardar um saldo à parte criaria duas versões da
-- verdade que discordariam no primeiro estorno.
--
-- Duas coisas entram no caixa:
--   1. `funcionarios`            — quem é e quanto ganha por mês.
--   2. `lancamentos.funcionario_id` + `competencia` — de qual salário de qual
--      mês aquela saída sai.
--
-- A COMPETÊNCIA ('AAAA-MM') é separada do vencimento de propósito: um vale
-- pego em 28/09 e o salário pago em 05/10 pertencem à MESMA folha (setembro),
-- mas saem do caixa em meses diferentes. Sem esse campo o vale de fim de mês
-- cairia na folha errada.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. FUNCIONARIOS — quem está na folha
-- ---------------------------------------------------------------------------
-- Cadastro deliberadamente enxuto: é uma folha de pagamento de empresa pequena,
-- não um RH. O que não for usado para pagar alguém não entra aqui.
--
-- Mesma convenção de nulos das outras tabelas: a camada de dados converte
-- string vazia em NULL (paraColuna em src/data/repository.js), então nada além
-- de id/criado_em é NOT NULL.

create table if not exists public.funcionarios (
  id             uuid primary key default gen_random_uuid(),
  nome           text,
  cargo          text,
  telefone       text,

  -- O salário do mês. É a MÉTRICA da conta salário: tudo que for lançado como
  -- vale/salário para este funcionário é abatido daqui.
  salario        numeric(12,2) default 0,
  dia_pagamento  integer,               -- dia do mês em que costuma cair (1..31)
  admissao       date,

  -- Desligado não some: ele continua nos lançamentos e nos relatórios dos meses
  -- em que trabalhou. Só deixa de aparecer na folha do mês.
  ativo          boolean not null default true,

  observacoes    text,
  criado_por     text,
  criado_em      timestamptz not null default now()
);

create index if not exists funcionarios_ativo_idx on public.funcionarios (ativo);

-- ---------------------------------------------------------------------------
-- 2. LANCAMENTOS: de quem é essa conta e de qual folha ela sai
-- ---------------------------------------------------------------------------
-- `on delete set null`: apagar um funcionário NÃO apaga dinheiro que já saiu do
-- caixa — o lançamento continua lá, só perde o dono. Mesma regra do cliente.

alter table public.lancamentos
  add column if not exists funcionario_id uuid references public.funcionarios(id) on delete set null;

-- A folha à qual o lançamento pertence, 'AAAA-MM'. Vazia = usa o mês do
-- vencimento (ver competenciaDe), para todo lançamento antigo continuar
-- classificado sem migração de dados.
alter table public.lancamentos
  add column if not exists competencia text;

create index if not exists lancamentos_funcionario_idx on public.lancamentos (funcionario_id, competencia);

-- ---------------------------------------------------------------------------
-- 3. RLS — mesma política das demais tabelas: quem está logado usa tudo
-- ---------------------------------------------------------------------------

alter table public.funcionarios enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'funcionarios'
                   and policyname = 'acesso_autenticado')
  then
    create policy acesso_autenticado on public.funcionarios
      for all to authenticated using (true) with check (true);
  end if;
end $$;

commit;

notify pgrst, 'reload schema';

-- ============================================================================
-- Conferência rápida (rode depois, separado):
--
--   select nome, cargo, salario, ativo from public.funcionarios order by nome;
--
--   -- a folha de um mês, funcionário a funcionário:
--   select f.nome,
--          f.salario,
--          sum(l.valor) filter (where l.categoria = 'vale')    as vales,
--          sum(l.valor) filter (where l.categoria = 'salario') as salario_lancado
--     from public.funcionarios f
--     left join public.lancamentos l
--       on l.funcionario_id = f.id
--      and coalesce(l.competencia, to_char(l.vencimento, 'YYYY-MM')) = '2026-09'
--    group by f.id, f.nome, f.salario
--    order by f.nome;
-- ============================================================================
