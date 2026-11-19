-- ============================================================================
-- Waterfall — Migração 035: vários funis, com etapas editáveis
-- ============================================================================
-- Rode este arquivo INTEIRO no SQL Editor do Supabase, depois da 034.
-- É idempotente (pode rodar de novo) e NÃO APAGA NADA.
--
-- O QUE MUDA
-- ----------
-- Até aqui havia um funil só, com oito etapas fixas no código (ETAPAS_FUNIL).
-- O comentário da 009 já previa a saída: "se um dia houver mais de um funil, a
-- coluna `etapa` já é texto e a migração é direta". O dia chegou — Vendas,
-- Pós-venda e Parcerias são processos diferentes, e espremê-los num quadro só
-- misturava quem está comprando com quem já comprou.
--
--   funis               — cada quadro: nome, cor, se é o principal.
--   funil_etapas        — as colunas de cada quadro, editáveis.
--   oportunidade_historico — toda mudança de funil/etapa de um negócio.
--
-- A DECISÃO QUE SEGURA O RESTO: `oportunidades.etapa` continua sendo TEXTO, e
-- passa a ser a CHAVE da etapa dentro do funil — (funil_id, etapa) aponta para
-- (funil_etapas.funil_id, funil_etapas.chave) por chave estrangeira composta.
--
-- Por que não um `etapa_id` uuid: o sistema inteiro (e o fechamento com
-- venda, e o webhook) sabe que um negócio foi fechado por `etapa = 'ganho'` ou
-- `etapa = 'perdido'`. Todo funil tem EXATAMENTE uma etapa de cada uma dessas,
-- e com essas chaves fixas. Renomear "Ganho" para "Venda fechada" muda o nome,
-- não a chave — e nada do que já pergunta "foi ganho?" precisa mudar.
--
-- As etapas que já existiam viram o funil "Vendas", com as MESMAS chaves
-- (contato, agendado, …): nenhum cartão sai do lugar.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. FUNIS
-- ---------------------------------------------------------------------------
-- A cor vem de uma paleta fixa, e não de um seletor livre: onze cores que se
-- distinguem entre si nos dois temas. Uma cor qualquer escolhida à mão vira
-- dois funis "verdes" que ninguém diferencia na etiqueta da conversa.

create table if not exists public.funis (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null check (length(btrim(nome)) > 0),
  cor        text not null default 'azul'
             check (cor in ('azul', 'verde', 'laranja', 'rosa', 'roxo', 'indigo',
                            'ciano', 'menta', 'amarelo', 'vermelho', 'cinza')),
  -- O principal é onde os contatos novos do WhatsApp entram. Sem nenhum
  -- marcado, vale o primeiro da lista (ver funil_principal()).
  principal  boolean not null default false,
  ordem      numeric(20,10) not null default 1000,
  criado_em  timestamptz not null default now()
);

-- No máximo UM principal. "Exatamente um" não é imposto de propósito: trocar
-- de principal seria uma corrida entre desmarcar um e marcar o outro.
create unique index if not exists funis_um_principal on public.funis ((true)) where principal;

-- ---------------------------------------------------------------------------
-- 2. ETAPAS DE CADA FUNIL
-- ---------------------------------------------------------------------------
-- `tipo` diz o que a etapa SIGNIFICA: aberta (o negócio está andando), ganho
-- ou perdido. As duas últimas têm a chave igual ao tipo — é o CHECK abaixo — e
-- o `unique (funil_id, chave)` faz o resto: no máximo uma de cada por funil.

create table if not exists public.funil_etapas (
  id         uuid primary key default gen_random_uuid(),
  funil_id   uuid not null references public.funis(id) on delete cascade,
  -- Chave sorteada para as etapas criadas na tela: o nome muda, a chave não.
  chave      text not null default ('e' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  nome       text not null check (length(btrim(nome)) > 0),
  tipo       text not null default 'aberta' check (tipo in ('aberta', 'ganho', 'perdido')),
  ordem      integer not null default 0,
  criado_em  timestamptz not null default now(),
  unique (funil_id, chave),
  constraint funil_etapas_chave_do_tipo check (
    (tipo = 'aberta' and chave not in ('ganho', 'perdido')) or (tipo <> 'aberta' and chave = tipo)
  )
);

create index if not exists funil_etapas_funil_idx on public.funil_etapas (funil_id, ordem);

-- As regras fixas do funil, no banco e não só na tela: a chave do navegador é
-- pública, e uma regra que só a tela conhece é uma sugestão.
--
--   * Ganho e Perdido não saem (a não ser junto com o funil inteiro);
--   * todo funil fica com pelo menos uma etapa aberta;
--   * no máximo 15 etapas abertas — mais que isso o quadro deixa de caber
--     na cabeça de quem o usa, e vira lista.
create or replace function public.guardar_regras_das_etapas()
returns trigger
language plpgsql
as $$
declare
  abertas integer;
begin
  if tg_op = 'INSERT' then
    if new.tipo = 'aberta' then
      select count(*) into abertas from public.funil_etapas
       where funil_id = new.funil_id and tipo = 'aberta';
      if abertas >= 15 then
        raise exception 'Um funil pode ter no máximo 15 etapas abertas.';
      end if;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.tipo is distinct from old.tipo or new.chave is distinct from old.chave
       or new.funil_id is distinct from old.funil_id then
      raise exception 'O tipo, a chave e o funil de uma etapa não mudam — só o nome e a ordem.';
    end if;
    return new;
  end if;

  -- DELETE. Quando o funil inteiro está sendo apagado, a cascata chega aqui
  -- depois de a linha do funil já ter saído — e aí tudo pode ir.
  if not exists (select 1 from public.funis where id = old.funil_id) then
    return old;
  end if;
  if old.tipo <> 'aberta' then
    raise exception 'As etapas Ganho e Perdido não podem ser removidas: é por elas que o sistema sabe que um negócio foi fechado.';
  end if;
  select count(*) into abertas from public.funil_etapas
   where funil_id = old.funil_id and tipo = 'aberta' and id <> old.id;
  if abertas = 0 then
    raise exception 'Todo funil precisa de pelo menos uma etapa aberta.';
  end if;
  return old;
end $$;

drop trigger if exists funil_etapas_regras on public.funil_etapas;
create trigger funil_etapas_regras
  before insert or update or delete on public.funil_etapas
  for each row execute function public.guardar_regras_das_etapas();

-- O último funil não sai: sem funil nenhum, o lead do WhatsApp não teria onde
-- cair e o quadro não teria o que mostrar.
create or replace function public.guardar_ultimo_funil()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from public.funis) <= 1 then
    raise exception 'O último funil não pode ser removido.';
  end if;
  return old;
end $$;

drop trigger if exists funis_ultimo on public.funis;
create trigger funis_ultimo
  before delete on public.funis
  for each row execute function public.guardar_ultimo_funil();

-- ---------------------------------------------------------------------------
-- 3. O FUNIL "VENDAS" — as oito etapas de hoje, com as mesmas chaves
-- ---------------------------------------------------------------------------

do $$
declare
  vendas uuid;
begin
  if not exists (select 1 from public.funis) then
    insert into public.funis (nome, cor, principal, ordem)
    values ('Vendas', 'azul', true, 1000)
    returning id into vendas;

    insert into public.funil_etapas (funil_id, chave, nome, tipo, ordem) values
      (vendas, 'contato',      'Em contato',     'aberta',  1),
      (vendas, 'agendado',     'Agendado',       'aberta',  2),
      (vendas, 'sem_resposta', 'Sem resposta',   'aberta',  3),
      (vendas, 'adiado',       'Adiado',         'aberta',  4),
      (vendas, 'proposta',     'Em proposta',    'aberta',  5),
      (vendas, 'negociacao',   'Em negociação',  'aberta',  6),
      (vendas, 'ganho',        'Venda fechada',  'ganho',   1000),
      (vendas, 'perdido',      'Venda perdida',  'perdido', 1001);
  end if;
end $$;

-- O funil onde entra o que chega sem funil escolhido: o marcado, ou o primeiro.
create or replace function public.funil_principal()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.funis order by principal desc, ordem, criado_em limit 1
$$;

create or replace function public.primeira_etapa_aberta(funil uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select chave from public.funil_etapas
   where funil_id = funil and tipo = 'aberta'
   order by ordem, criado_em limit 1
$$;

-- ---------------------------------------------------------------------------
-- 4. OPORTUNIDADES PASSAM A MORAR NUM FUNIL
-- ---------------------------------------------------------------------------

alter table public.oportunidades
  add column if not exists funil_id uuid references public.funis(id) on delete restrict;

-- A regra antiga (`etapa in (...)`, da 027) sai: quem diz quais etapas existem
-- agora é a tabela, pela chave estrangeira composta logo abaixo.
do $$
declare
  regra text;
begin
  for regra in
    select conname from pg_constraint
     where conrelid = 'public.oportunidades'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%etapa%'
  loop
    execute format('alter table public.oportunidades drop constraint %I', regra);
  end loop;
end $$;

alter table public.oportunidades alter column etapa drop default;

-- Quem já existia vai para o funil principal (o "Vendas" acima). Etapa que não
-- exista lá — não deveria haver nenhuma depois da 027 — vai para a primeira.
update public.oportunidades
   set funil_id = public.funil_principal()
 where funil_id is null;

update public.oportunidades o
   set etapa = public.primeira_etapa_aberta(o.funil_id)
 where not exists (select 1 from public.funil_etapas e
                    where e.funil_id = o.funil_id and e.chave = o.etapa);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'oportunidades_etapa_do_funil_fkey') then
    alter table public.oportunidades
      add constraint oportunidades_etapa_do_funil_fkey
      foreign key (funil_id, etapa) references public.funil_etapas (funil_id, chave);
  end if;
end $$;

create index if not exists oportunidades_funil_idx on public.oportunidades (funil_id, etapa, ordem);

-- Quem grava sem dizer o funil — a Edge Function `wa-webhook`, que abre o lead
-- com `etapa = 'contato'` e nunca ouviu falar de funil — cai no PRINCIPAL, na
-- primeira etapa dele, no fim da coluna. É o que faz "o principal é onde entram
-- os contatos novos do WhatsApp" valer sem republicar a função.
--
-- Num UPDATE, funil ou etapa vazios (o app manda '' → null no que não mexeu)
-- ficam como estavam.
create or replace function public.encaixar_no_funil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  sem_funil boolean := new.funil_id is null;
begin
  if tg_op = 'UPDATE' then
    new.funil_id := coalesce(new.funil_id, old.funil_id);
    new.etapa    := coalesce(new.etapa, old.etapa);
    sem_funil := false;
  end if;

  if new.funil_id is null then
    new.funil_id := public.funil_principal();
  end if;

  if sem_funil or new.etapa is null or not exists (
       select 1 from public.funil_etapas where funil_id = new.funil_id and chave = new.etapa) then
    new.etapa := public.primeira_etapa_aberta(new.funil_id);
    if tg_op = 'INSERT' then
      new.ordem := coalesce((select max(ordem) from public.oportunidades
                              where funil_id = new.funil_id and etapa = new.etapa), 0) + 1000;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists oportunidades_encaixar_no_funil on public.oportunidades;
create trigger oportunidades_encaixar_no_funil
  before insert or update on public.oportunidades
  for each row execute function public.encaixar_no_funil();

-- ---------------------------------------------------------------------------
-- 5. HISTÓRICO DO NEGÓCIO
-- ---------------------------------------------------------------------------
-- Os NOMES ficam gravados como eram na hora, e não só os ids: a etapa pode ser
-- renomeada ou removida depois, e o histórico precisa continuar dizendo o que
-- aconteceu ("Vendas › Novo lead"), e não "etapa desconhecida".
--
-- Quem escreve é um trigger, não a tela. Assim entra TUDO — o arrasto no
-- quadro, o menu da conversa, o lead que o webhook abriu, e as mudanças em
-- massa ao remover uma etapa ou um funil — sem depender de cada tela lembrar.

create table if not exists public.oportunidade_historico (
  id               uuid primary key default gen_random_uuid(),
  oportunidade_id  uuid not null references public.oportunidades(id) on delete cascade,
  de_funil         text,
  de_etapa         text,
  para_funil       text,
  para_etapa       text,
  para_funil_id    uuid,
  para_etapa_chave text,
  motivo           text,         -- "etapa removida", "funil removido"…
  feito_por        text,
  feito_em         timestamptz not null default now()
);

create index if not exists oportunidade_historico_idx
  on public.oportunidade_historico (oportunidade_id, feito_em);

-- O motivo chega por uma variável da transação (`waterfall.motivo`), que as
-- funções de remoção abaixo preenchem. Mudança comum, feita na tela, vem sem
-- motivo — e não precisa de um: o "de → para" já diz tudo.
create or replace function public.registrar_mudanca_de_etapa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  quem text;
begin
  if tg_op = 'UPDATE' and new.funil_id is not distinct from old.funil_id
                      and new.etapa is not distinct from old.etapa then
    return null;
  end if;

  quem := coalesce(
    (select coalesce(usuario, nome) from public.perfis where user_id = auth.uid()),
    nullif(new.criado_por, ''),
    'sistema');

  insert into public.oportunidade_historico
    (oportunidade_id, de_funil, de_etapa, para_funil, para_etapa,
     para_funil_id, para_etapa_chave, motivo, feito_por)
  values (
    new.id,
    case when tg_op = 'UPDATE' then (select nome from public.funis where id = old.funil_id) end,
    case when tg_op = 'UPDATE' then (select nome from public.funil_etapas
                                      where funil_id = old.funil_id and chave = old.etapa) end,
    (select nome from public.funis where id = new.funil_id),
    (select nome from public.funil_etapas where funil_id = new.funil_id and chave = new.etapa),
    new.funil_id,
    new.etapa,
    coalesce(nullif(current_setting('waterfall.motivo', true), ''),
             case when tg_op = 'INSERT' then 'negócio criado' end),
    quem
  );
  return null;
end $$;

drop trigger if exists oportunidades_historico on public.oportunidades;
create trigger oportunidades_historico
  after insert or update of funil_id, etapa on public.oportunidades
  for each row execute function public.registrar_mudanca_de_etapa();

-- ---------------------------------------------------------------------------
-- 6. CRIAR E REMOVER, sem deixar nada pela metade
-- ---------------------------------------------------------------------------
-- São funções, e não uma sequência de chamadas da tela, porque cada uma mexe em
-- várias linhas que precisam mudar JUNTAS: um funil sem as etapas, ou metade
-- dos negócios levados para outro funil e a outra metade órfã, é pior do que
-- não ter feito nada. `security invoker`: valem as mesmas permissões (RLS) de
-- quem chamou.

-- Funil novo já nasce com Novo, Em andamento, Ganho e Perdido, e com uma cor
-- que nenhum outro esteja usando (se as onze já estiverem em uso, a menos usada).
create or replace function public.criar_funil(p_nome text, p_cor text default null)
returns public.funis
language plpgsql
security invoker
set search_path = public
as $$
declare
  paleta constant text[] := array['azul', 'verde', 'laranja', 'rosa', 'roxo', 'indigo',
                                  'ciano', 'menta', 'amarelo', 'vermelho', 'cinza'];
  cor  text := p_cor;
  novo public.funis;
begin
  if length(btrim(coalesce(p_nome, ''))) = 0 then
    raise exception 'Dê um nome ao funil.';
  end if;

  if cor is null then
    select c into cor
      from unnest(paleta) with ordinality as p(c, posicao)
     order by (select count(*) from public.funis f where f.cor = p.c), posicao
     limit 1;
  end if;

  insert into public.funis (nome, cor, ordem)
  values (btrim(p_nome), cor,
          coalesce((select max(ordem) from public.funis), 0) + 1000)
  returning * into novo;

  insert into public.funil_etapas (funil_id, chave, nome, tipo, ordem) values
    (novo.id, 'novo',      'Novo',         'aberta',  1),
    (novo.id, 'andamento', 'Em andamento', 'aberta',  2),
    (novo.id, 'ganho',     'Ganho',        'ganho',   1000),
    (novo.id, 'perdido',   'Perdido',      'perdido', 1001);

  return novo;
end $$;

-- Remove uma etapa aberta. Os negócios que estão nela vão para `p_destino`
-- (outra etapa ABERTA do mesmo funil), no fim da coluna, com o motivo gravado
-- no histórico.
--
-- Destino só entre as abertas: mandar dez negócios de uma vez para "Perdido"
-- seria fechá-los sem motivo de perda — exatamente o que o fechamento normal
-- não deixa fazer.
create or replace function public.remover_etapa(p_etapa uuid, p_destino uuid default null)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_etapa   public.funil_etapas;
  v_destino public.funil_etapas;
  base      numeric;
begin
  select * into v_etapa from public.funil_etapas where id = p_etapa;
  if not found then
    raise exception 'Etapa não encontrada.';
  end if;

  if exists (select 1 from public.oportunidades where funil_id = v_etapa.funil_id and etapa = v_etapa.chave) then
    select * into v_destino from public.funil_etapas where id = p_destino;
    if not found or v_destino.funil_id <> v_etapa.funil_id or v_destino.id = v_etapa.id or v_destino.tipo <> 'aberta' then
      raise exception 'Escolha para qual outra etapa aberta deste funil vão os negócios.';
    end if;

    perform set_config('waterfall.motivo', 'etapa removida', true);

    base := coalesce((select max(ordem) from public.oportunidades
                       where funil_id = v_destino.funil_id and etapa = v_destino.chave), 0);
    update public.oportunidades o
       set etapa = v_destino.chave,
           ordem = base + n.posicao * 1000
      from (select id, row_number() over (order by ordem, criado_em) as posicao
              from public.oportunidades
             where funil_id = v_etapa.funil_id and etapa = v_etapa.chave) n
     where o.id = n.id;

    perform set_config('waterfall.motivo', '', true);
  end if;

  delete from public.funil_etapas where id = p_etapa;
end $$;

-- Remove um funil. Os negócios dele vão para `p_destino` — aberto → primeira
-- etapa, ganho → Ganho, perdido → Perdido — ou, com `p_apagar`, saem junto.
create or replace function public.remover_funil(p_funil uuid, p_destino uuid default null, p_apagar boolean default false)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  primeira text;
  base     numeric;
begin
  if not exists (select 1 from public.funis where id = p_funil) then
    raise exception 'Funil não encontrado.';
  end if;
  if (select count(*) from public.funis) <= 1 then
    raise exception 'O último funil não pode ser removido.';
  end if;

  if exists (select 1 from public.oportunidades where funil_id = p_funil) then
    if p_apagar then
      delete from public.oportunidades where funil_id = p_funil;
    else
      if p_destino is null or p_destino = p_funil
         or not exists (select 1 from public.funis where id = p_destino) then
        raise exception 'Escolha para qual funil vão os negócios, ou marque para apagá-los junto.';
      end if;

      primeira := public.primeira_etapa_aberta(p_destino);
      base := coalesce((select max(ordem) from public.oportunidades where funil_id = p_destino), 0);

      perform set_config('waterfall.motivo', 'funil removido', true);

      update public.oportunidades o
         set funil_id = p_destino,
             etapa = case when o.etapa in ('ganho', 'perdido') then o.etapa else primeira end,
             ordem = base + n.posicao * 1000
        from (select id, row_number() over (order by etapa, ordem, criado_em) as posicao
                from public.oportunidades where funil_id = p_funil) n
       where o.id = n.id;

      perform set_config('waterfall.motivo', '', true);
    end if;
  end if;

  delete from public.funis where id = p_funil;
end $$;

-- Troca o principal numa operação só — desmarcar e marcar separados violariam
-- o índice único no meio do caminho, ou deixariam a empresa sem principal.
create or replace function public.definir_funil_principal(p_funil uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.funis set principal = false where principal and id <> p_funil;
  update public.funis set principal = true where id = p_funil;
end $$;

-- ---------------------------------------------------------------------------
-- 7. RLS
-- ---------------------------------------------------------------------------
-- Os funis são a forma de trabalhar da empresa, não dados de uma unidade:
-- todo mundo logado LÊ, só a gestão muda. (Os NEGÓCIOS continuam com a regra
-- por unidade da 031 — o distribuidor vê o quadro "Vendas" com os cartões dele.)
--
-- O histórico segue o negócio: quem enxerga a oportunidade enxerga a história
-- dela. A subconsulta respeita o RLS de `oportunidades` de quem pergunta.
-- Ninguém escreve nele direto; só o trigger (security definer).

alter table public.funis enable row level security;
alter table public.funil_etapas enable row level security;
alter table public.oportunidade_historico enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['funis', 'funil_etapas'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'ler') then
      execute format('create policy ler on public.%I for select to authenticated using (true)', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'gestao_escreve') then
      execute format(
        'create policy gestao_escreve on public.%I for all to authenticated
           using ((select public.eh_gestao())) with check ((select public.eh_gestao()))', t);
    end if;
  end loop;

  if not exists (select 1 from pg_policies where schemaname = 'public'
                  and tablename = 'oportunidade_historico' and policyname = 'segue_o_negocio') then
    create policy segue_o_negocio on public.oportunidade_historico
      for select to authenticated
      using (exists (select 1 from public.oportunidades o
                     where o.id = oportunidade_historico.oportunidade_id));
  end if;
end $$;

revoke execute on function public.criar_funil(text, text) from public, anon;
revoke execute on function public.remover_etapa(uuid, uuid) from public, anon;
revoke execute on function public.remover_funil(uuid, uuid, boolean) from public, anon;
revoke execute on function public.definir_funil_principal(uuid) from public, anon;
grant execute on function public.criar_funil(text, text) to authenticated;
grant execute on function public.remover_etapa(uuid, uuid) to authenticated;
grant execute on function public.remover_funil(uuid, uuid, boolean) to authenticated;
grant execute on function public.definir_funil_principal(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. REALTIME
-- ---------------------------------------------------------------------------
-- A etiqueta "Vendas · Proposta" na lista de conversas tem que mudar sozinha
-- quando alguém arrasta o cartão em outro computador. Sem publicar estas
-- tabelas, só mudaria no F5.

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['oportunidades', 'funis', 'funil_etapas'] loop
      if not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

commit;

notify pgrst, 'reload schema';

-- ============================================================================
-- CONFERÊNCIA — rode depois, separado:
--
--   select f.nome, f.cor, f.principal, count(o.id) as negocios
--     from public.funis f left join public.oportunidades o on o.funil_id = f.id
--    group by 1, 2, 3;
--   -- esperado: "Vendas", azul, true, com todos os negócios
--
--   select count(*) from public.oportunidades where funil_id is null;
--   -- esperado: 0
-- ============================================================================
