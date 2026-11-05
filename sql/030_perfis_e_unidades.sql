-- ============================================================================
-- Waterfall — Migração 030: quem é cada usuário (papel) e de quem são os dados
-- ============================================================================
-- Rode este arquivo INTEIRO no SQL Editor do Supabase, depois da 029.
-- É idempotente (pode rodar de novo) e NÃO APAGA NADA.
--
-- É a FUNDAÇÃO dos níveis de acesso, e de propósito não muda o que ninguém vê:
-- todas as tabelas continuam com a `acesso_autenticado` da 007 (logado usa
-- tudo). O que ela traz é o vocabulário que a próxima etapa vai usar para
-- filtrar — e cada usuário que já existe entra como gestão, então amanhã todo
-- mundo trabalha exatamente como hoje.
--
-- Dois eixos, e não um:
--
--   papel    → o que a pessoa pode FAZER   ('gestao' | 'distribuidor')
--   unidade  → de quem são os dados que ela vê (a Waterfall, ou um distribuidor)
--
-- Os registros vão pertencer à UNIDADE, não ao usuário. Se o distribuidor
-- contratar um vendedor, os dois enxergam a mesma carteira; e passar um cliente
-- de um distribuidor para outro é trocar um campo. Se o dono fosse o usuário,
-- as duas coisas exigiriam copiar dados.
--
-- Por que não aproveitar o `criado_por` que já existe: ele guarda o NOME de
-- exibição em texto ("Nando"). Serve para a tela mostrar quem fez, mas não para
-- segurança — muda quando o nome muda, e quem grava é o navegador.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. UNIDADES
-- ---------------------------------------------------------------------------
-- 'casa' é a própria Waterfall, e só existe uma. Os dados de hoje são todos
-- dela; cada distribuidor vira uma linha 'distribuidor'.

create table if not exists public.unidades (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null,
  tipo           text not null check (tipo in ('casa', 'distribuidor')),
  ativa          boolean not null default true,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

-- Uma casa só: duas fariam "os dados da Waterfall" significar duas coisas.
create unique index if not exists unidades_uma_casa
  on public.unidades ((true)) where tipo = 'casa';

drop trigger if exists unidades_atualizado_em on public.unidades;
create trigger unidades_atualizado_em
  before update on public.unidades
  for each row execute function public.tocar_atualizado_em();

insert into public.unidades (nome, tipo)
select 'Waterfall', 'casa'
 where not exists (select 1 from public.unidades where tipo = 'casa');

-- ---------------------------------------------------------------------------
-- 2. PERFIS — um por usuário do Supabase Auth
-- ---------------------------------------------------------------------------
-- `papel` vazio quer dizer "acesso ainda não liberado". É o estado de quem foi
-- criado e ninguém configurou: quando os dados passarem a ser filtrados, essa
-- pessoa não vê nada até a gestão dizer quem ela é. O contrário — nascer como
-- gestão — abriria a base inteira para qualquer conta criada por engano.

create table if not exists public.perfis (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  nome           text,
  papel          text check (papel in ('gestao', 'distribuidor')),
  -- `restrict`: apagar uma unidade com gente dentro deixaria essas pessoas
  -- sem dono de dados nenhum. Desative a unidade em vez de apagar.
  unidade_id     uuid references public.unidades(id) on delete restrict,
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  -- Quem tem papel tem unidade: é nela que caem os registros que a pessoa cria.
  constraint perfis_papel_com_unidade check (papel is null or unidade_id is not null)
);

create index if not exists perfis_unidade_idx on public.perfis (unidade_id);

drop trigger if exists perfis_atualizado_em on public.perfis;
create trigger perfis_atualizado_em
  before update on public.perfis
  for each row execute function public.tocar_atualizado_em();

-- Quem já usa o sistema vira gestão da Waterfall. O nome segue a mesma ordem
-- de preferência de lib/auth.js (nome do perfil, depois o usuário do e-mail).
insert into public.perfis (user_id, nome, papel, unidade_id)
select u.id,
       coalesce(nullif(u.raw_user_meta_data->>'nome', ''),
                nullif(u.raw_user_meta_data->>'display_name', ''),
                split_part(u.email, '@', 1)),
       'gestao',
       (select id from public.unidades where tipo = 'casa')
  from auth.users u
on conflict (user_id) do nothing;

-- Usuário criado daqui em diante ganha o perfil sozinho, SEM papel. Sem isto,
-- a conta nova não teria linha nenhuma e a tela de usuários (etapa seguinte)
-- nem saberia que ela existe.
create or replace function public.criar_perfil_do_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.perfis (user_id, nome)
  values (new.id,
          coalesce(nullif(new.raw_user_meta_data->>'nome', ''),
                   nullif(new.raw_user_meta_data->>'display_name', ''),
                   split_part(new.email, '@', 1)))
  on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists criar_perfil_do_usuario on auth.users;
create trigger criar_perfil_do_usuario
  after insert on auth.users
  for each row execute function public.criar_perfil_do_usuario();

-- Sempre sobra um gestor ativo. Sem esta trava, a gestão rebaixar a si mesma
-- (ou desativar o último colega) trancaria o sistema por dentro, e só o SQL
-- Editor destrancaria.
create or replace function public.manter_um_gestor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.perfis where papel = 'gestao' and ativo) then
    raise exception 'O sistema precisa de pelo menos um usuário da gestão ativo.';
  end if;
  return null;
end $$;

drop trigger if exists manter_um_gestor on public.perfis;
create trigger manter_um_gestor
  after update or delete on public.perfis
  for each statement execute function public.manter_um_gestor();

-- ---------------------------------------------------------------------------
-- 3. AS DUAS PERGUNTAS QUE AS POLÍTICAS VÃO FAZER
-- ---------------------------------------------------------------------------
-- `security definer` é o que permite usá-las dentro da política da própria
-- tabela `perfis` sem recursão: rodam como dono, que não passa pelo RLS.
-- `stable` deixa o Postgres avaliá-las uma vez por consulta, e não por linha.
-- Usuário inativo responde como se não tivesse perfil.

create or replace function public.eh_gestao()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.perfis
                  where user_id = auth.uid() and papel = 'gestao' and ativo)
$$;

create or replace function public.minha_unidade()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select unidade_id from public.perfis
   where user_id = auth.uid() and papel is not null and ativo
$$;

-- Função nova nasce executável por PUBLIC (o que inclui o `anon`); a 007 só
-- tira o `anon` das futuras, não o PUBLIC. Fecha as quatro na mão.
revoke execute on function public.eh_gestao()               from public;
revoke execute on function public.minha_unidade()           from public;
revoke execute on function public.criar_perfil_do_usuario() from public;
revoke execute on function public.manter_um_gestor()        from public;
grant  execute on function public.eh_gestao()     to authenticated;
grant  execute on function public.minha_unidade() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. RLS DAS DUAS TABELAS NOVAS
-- ---------------------------------------------------------------------------
-- Estas já nascem com a regra definitiva, porque aqui não há legado a manter:
-- cada um lê o próprio perfil e a própria unidade; a gestão lê e altera todos.
-- Ninguém além da gestão escreve — senão o distribuidor se promoveria.

alter table public.unidades enable row level security;
alter table public.perfis   enable row level security;

revoke all on public.unidades from anon;
revoke all on public.perfis   from anon;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = 'perfis' and policyname = 'perfis_ler') then
    create policy perfis_ler on public.perfis
      for select to authenticated
      using (user_id = auth.uid() or public.eh_gestao());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = 'perfis' and policyname = 'perfis_gestao') then
    create policy perfis_gestao on public.perfis
      for all to authenticated
      using (public.eh_gestao()) with check (public.eh_gestao());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = 'unidades' and policyname = 'unidades_ler') then
    create policy unidades_ler on public.unidades
      for select to authenticated
      using (id = public.minha_unidade() or public.eh_gestao());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = 'unidades' and policyname = 'unidades_gestao') then
    create policy unidades_gestao on public.unidades
      for all to authenticated
      using (public.eh_gestao()) with check (public.eh_gestao());
  end if;
end $$;

commit;

notify pgrst, 'reload schema';

-- ============================================================================
-- CONFERÊNCIA — rode depois, separado:
--
--   select p.nome, p.papel, u.nome as unidade, p.ativo
--     from public.perfis p left join public.unidades u on u.id = p.unidade_id
--    order by p.nome;
--   -- todo usuário de hoje com papel 'gestao' e unidade 'Waterfall'
--
--   select count(*) from auth.users u
--    where not exists (select 1 from public.perfis p where p.user_id = u.id);
--   -- tem que dar 0
--
-- Para liberar uma conta nova enquanto a tela de usuários não existe:
--
--   update public.perfis
--      set papel = 'gestao',
--          unidade_id = (select id from public.unidades where tipo = 'casa')
--    where nome = 'fulano';
-- ============================================================================
