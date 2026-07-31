-- ============================================================================
-- Waterfall — Migração 005: Agenda e Diário de Trabalho
-- ============================================================================
-- Rode este arquivo INTEIRO no SQL Editor do Supabase, depois do 004.
-- É idempotente (pode rodar de novo) e NÃO APAGA NADA.
--
-- O que ela traz:
--   1. `atividades` — o registro do seu dia: ligações, WhatsApps, tarefas,
--      anotações. É o diário de trabalho e a lista de próximos passos.
--   2. `hora` em `agendamentos` — para a agenda do dia sair em ordem.
--   3. `origem_atividade_id` em agendamentos e vendas — a CORRENTE, que responde
--      "de onde veio isso?".
--   4. Colunas reservadas para a futura sincronia com o Google Calendar.
--
-- POR QUE UMA TABELA NOVA E NÃO REAPROVEITAR `agendamentos`:
-- um agendamento aqui é um serviço em campo — ele gera Ordem de Serviço, entra
-- no caixa (`lancamentos`), cria o equipamento do cliente ao ser concluído e
-- dispara o ciclo de troca de refil. Se uma ligação de 40 segundos virasse um
-- agendamento, ela sujaria o financeiro, o indicador "Visitas no mês" e a
-- numeração das OS. Uma atividade é leve de propósito: não move dinheiro e não
-- gera documento. As duas aparecem juntas no calendário — a separação é só por
-- baixo do capô.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. ATIVIDADES — o diário de trabalho
-- ---------------------------------------------------------------------------
-- Uma atividade é UM contato ou UMA tarefa, num dia.
--   status='pendente'  -> é uma tarefa, ainda por fazer
--   status='concluida' -> virou histórico; `descricao` conta o que aconteceu
--
-- Tarefa e registro são a MESMA coisa em momentos diferentes. Manter duas
-- tabelas ("a fazer" e "o que fiz") criaria duas listas que sempre desandam.
--
-- Convenção de nulos: a camada de dados converte string vazia em NULL
-- (ver paraColuna em src/data/repository.js). Por isso nada aqui é NOT NULL
-- além de id/criado_em, e os CHECK toleram NULL — igual às tabelas existentes.

create table if not exists public.atividades (
  id            uuid primary key default gen_random_uuid(),

  data          date,                 -- o dia a que ela pertence
  hora          time,                 -- NULL = "sem horário", vai para o fim do dia
  duracao_min   integer,              -- opcional; usado na sincronia com o Google

  tipo          text default 'ligacao'
                check (tipo in ('ligacao', 'whatsapp', 'email', 'visita', 'reuniao', 'tarefa', 'nota')),
  titulo        text,
  descricao     text,                 -- o que foi dito / o que precisa ser feito

  status        text default 'pendente'
                check (status in ('pendente', 'concluida', 'cancelada')),

  -- Como terminou. É `retornar` que dispara o follow-up obrigatório na
  -- camada de dados: concluir com esse resultado exige marcar a data da volta.
  resultado     text
                check (resultado in ('sucesso', 'retornar', 'sem_resposta', 'recusado')),
  concluida_em  date,                 -- quando foi de fato feita (pode diferir de `data`)

  -- `set null` e não `cascade`, igual às demais tabelas: excluir um cliente não
  -- pode apagar o registro do trabalho que você fez. A atividade continua no
  -- histórico, apenas sem dono — como já acontece com agendamentos e vendas.
  cliente_id    uuid references public.clientes(id) on delete set null,
  responsavel   text,                 -- quem tem que fazer
  criado_por    text,

  -- A CORRENTE: de onde este registro nasceu.
  origem_atividade_id uuid references public.atividades(id) on delete set null,
  agendamento_id      uuid references public.agendamentos(id) on delete set null,
  venda_id            uuid references public.vendas(id) on delete set null,

  -- Reservado para o Google Calendar. Criadas agora, vazias: acrescentar coluna
  -- depois é barato, mas reconciliar eventos já criados sem elas não é.
  google_event_id text,
  sincronizado_em timestamptz,

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- `data` é o eixo do calendário; o índice parcial de pendentes serve à consulta
-- mais frequente do sistema ("o que está em aberto?"), que ignora a data.
create index if not exists atividades_data_idx      on public.atividades (data);
create index if not exists atividades_cliente_idx   on public.atividades (cliente_id);
create index if not exists atividades_origem_idx    on public.atividades (origem_atividade_id);
create index if not exists atividades_pendentes_idx on public.atividades (data) where status = 'pendente';

-- `atualizado_em` automático: é o carimbo que a sincronia com o Google vai usar
-- para decidir quem tem a versão mais nova de um evento.
create or replace function public.tocar_atualizado_em()
returns trigger language plpgsql as $$
begin
  new.atualizado_em = now();
  return new;
end $$;

drop trigger if exists atividades_atualizado_em on public.atividades;
create trigger atividades_atualizado_em
  before update on public.atividades
  for each row execute function public.tocar_atualizado_em();

-- ---------------------------------------------------------------------------
-- 2. AGENDAMENTOS — horário e origem
-- ---------------------------------------------------------------------------
-- Sem `hora` não dá para ordenar as visitas de um dia, que é exatamente o que
-- um roteiro de campo precisa. NULL continua significando "dia todo", então
-- nada do que já existe muda de comportamento.

alter table public.agendamentos
  add column if not exists hora time;

alter table public.agendamentos
  add column if not exists origem_atividade_id uuid references public.atividades(id) on delete set null;

alter table public.agendamentos
  add column if not exists google_event_id text;

-- Uma venda também pode ter nascido de uma ligação.
alter table public.vendas
  add column if not exists origem_atividade_id uuid references public.atividades(id) on delete set null;

create index if not exists agendamentos_origem_idx on public.agendamentos (origem_atividade_id);
create index if not exists vendas_origem_idx       on public.vendas (origem_atividade_id);

-- ---------------------------------------------------------------------------
-- 3. RLS — mesma política das demais tabelas: quem está logado usa tudo
-- ---------------------------------------------------------------------------

alter table public.atividades enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'atividades'
                   and policyname = 'acesso_autenticado')
  then
    create policy acesso_autenticado on public.atividades
      for all to authenticated using (true) with check (true);
  end if;
end $$;

commit;

-- ---------------------------------------------------------------------------
-- 4. Recarrega o cache de schema da API
-- ---------------------------------------------------------------------------
-- Sem isto o PostgREST continua respondendo "Could not find the table
-- public.atividades in the schema cache" mesmo com a tabela já criada.
-- Fica FORA da transação porque o NOTIFY só dispara no commit.

notify pgrst, 'reload schema';

-- ============================================================================
-- Conferência rápida (rode depois, separado):
--
--   select count(*) from public.atividades;
--   select column_name from information_schema.columns
--    where table_name = 'agendamentos' and column_name in ('hora','origem_atividade_id');
-- ============================================================================
