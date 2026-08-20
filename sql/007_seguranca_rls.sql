-- ============================================================================
-- Waterfall — Migração 007: fechar o cerco da segurança (RLS + Storage)
-- ============================================================================
-- Rode este arquivo INTEIRO no SQL Editor do Supabase, depois do 006.
-- É idempotente (pode rodar quantas vezes quiser) e NÃO APAGA NADA.
--
-- POR QUE ELA EXISTE
-- ------------------
-- A chave que vai no navegador (VITE_SUPABASE_ANON_KEY) é PÚBLICA por
-- natureza: ela viaja dentro do JavaScript do site, e qualquer pessoa que
-- abrir o sistema consegue lê-la. Isso não é um defeito — é como o Supabase
-- foi desenhado. A consequência, porém, é dura:
--
--   O que protege os seus dados NÃO é a chave. É o RLS.
--
-- Sem RLS numa tabela, qualquer pessoa com a chave pública pode baixar,
-- alterar ou apagar aquela tabela inteira — sem nunca fazer login. Com RLS,
-- o Postgres barra cada linha na origem, e a chave pública deixa de valer
-- qualquer coisa sozinha.
--
-- As migrações anteriores ligaram RLS conforme criavam tabelas novas:
--   001 -> lancamentos, vendas, venda_itens
--   004 -> produtos
--   005 -> atividades
--
-- Mas as tabelas MAIS ANTIGAS — as que foram criadas na mão pelo painel, antes
-- deste repositório existir — nunca passaram por migração nenhuma. São elas:
--
--   clientes      (nome, telefone, endereço, CPF/CNPJ dos seus clientes)
--   agendamentos  (a agenda inteira)
--   equipamentos  (o que está instalado na casa de cada cliente)
--   fotos         (caminhos das fotos dos clientes)
--
-- É exatamente o material mais sensível do sistema. Esta migração garante que
-- TODAS as tabelas estejam protegidas, incluindo as que já estavam — repetir
-- não causa dano.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. RLS + política em todas as tabelas do aplicativo
-- ---------------------------------------------------------------------------
-- A política é a mesma já adotada pelo sistema: quem está autenticado usa
-- tudo. O sistema é de uso interno da equipe, e não há separação de dados por
-- usuário — então "estar logado" é a fronteira certa. O que importa aqui é que
-- NÃO-logado (o papel `anon`, o da chave pública) não acessa absolutamente
-- nada. É essa a linha que estava aberta em quatro tabelas.

do $$
declare
  t text;
  tabelas text[] := array[
    'clientes', 'produtos', 'equipamentos', 'agendamentos',
    'vendas', 'venda_itens', 'lancamentos', 'atividades', 'fotos'
  ];
begin
  foreach t in array tabelas loop
    -- Pula tabela que ainda não exista neste banco, em vez de abortar tudo.
    if not exists (select 1 from information_schema.tables
                   where table_schema = 'public' and table_name = t) then
      raise notice 'Tabela public.% nao existe -- ignorada.', t;
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);

    if not exists (select 1 from pg_policies
                   where schemaname = 'public' and tablename = t
                     and policyname = 'acesso_autenticado') then
      execute format(
        'create policy acesso_autenticado on public.%I
           for all to authenticated using (true) with check (true)', t);
      raise notice 'Politica criada em public.%', t;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Tira o acesso do papel público (`anon`) das tabelas
-- ---------------------------------------------------------------------------
-- O RLS do passo 1 já bloqueia o `anon` (as políticas são só `to
-- authenticated`). Este passo é a segunda tranca: mesmo que uma política
-- futura seja escrita larga demais por engano, sem o GRANT o `anon` continua
-- do lado de fora. Duas travas independentes, para que um erro sozinho não
-- vire vazamento.
--
-- Isto NÃO afeta a tela de login: o login acontece no schema `auth` (GoTrue),
-- que tem permissões próprias e não depende destes grants.

revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

-- E o mesmo para as tabelas que forem criadas daqui em diante — senão a
-- próxima migração nasce aberta de novo.
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

-- ---------------------------------------------------------------------------
-- 3. `vendas_legado` — o backup da migração 001
-- ---------------------------------------------------------------------------
-- Esta tabela guarda o financeiro antigo e o aplicativo NÃO a usa mais. A
-- intenção aqui é deixá-la com RLS ligado e NENHUMA política, o que a torna
-- invisível pela API para todo mundo, inclusive logado — você continua lendo
-- ela pelo SQL Editor do painel, que roda como dono do banco e ignora RLS.
--
-- ATENÇÃO: ligar o RLS abaixo NÃO basta, e a conferência desta migração provou
-- isso. A `vendas_legado` nasceu do rename da antiga `vendas` (migração 001), e
-- políticas acompanham a tabela num rename — então ela chegou aqui já com uma
-- política herdada, que continuou liberando leitura para qualquer usuário
-- logado. Quem termina o serviço é a `sql/008_limpar_politicas.sql`, removendo
-- essa política. Rode as duas.

do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'vendas_legado') then
    alter table public.vendas_legado enable row level security;
  end if;
end $$;

commit;

-- ---------------------------------------------------------------------------
-- 4. STORAGE — o bucket de fotos dos clientes
-- ---------------------------------------------------------------------------
-- As fotos ficam no bucket 'fotos-clientes'. O aplicativo já trata ele como
-- privado (usa URL assinada de 8h, ver src/lib/imagem.js), mas "privado" no
-- Storage depende de DUAS coisas que precisam estar certas ao mesmo tempo:
--
--   a) a flag `public` do bucket em false — senão qualquer URL direta abre a
--      foto sem login, e as URLs seguem um padrão adivinhável;
--   b) políticas em storage.objects — é o RLS do Storage.
--
-- Sem (b), o upload e a leitura ficam bloqueados ou liberados conforme o
-- padrão da conta. Aqui deixamos explícito: só quem está logado mexe.

update storage.buckets set public = false where id = 'fotos-clientes';

do $$
declare
  politicas text[] := array['fotos_ler', 'fotos_enviar', 'fotos_atualizar', 'fotos_remover'];
  acoes     text[] := array['select', 'insert', 'update', 'delete'];
  i int;
begin
  for i in 1 .. array_length(politicas, 1) loop
    if not exists (select 1 from pg_policies
                   where schemaname = 'storage' and tablename = 'objects'
                     and policyname = politicas[i]) then
      if acoes[i] = 'insert' then
        execute format(
          'create policy %I on storage.objects for insert to authenticated
             with check (bucket_id = %L)', politicas[i], 'fotos-clientes');
      elsif acoes[i] = 'update' then
        execute format(
          'create policy %I on storage.objects for update to authenticated
             using (bucket_id = %L) with check (bucket_id = %L)',
          politicas[i], 'fotos-clientes', 'fotos-clientes');
      else
        execute format(
          'create policy %I on storage.objects for %s to authenticated
             using (bucket_id = %L)', politicas[i], acoes[i], 'fotos-clientes');
      end if;
      raise notice 'Politica de Storage criada: %', politicas[i];
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

-- ============================================================================
-- CONFERÊNCIA — rode este bloco separado, DEPOIS, e leia o resultado
-- ============================================================================
-- Toda linha precisa sair com rls_ligado = true e politicas >= 1.
-- A única exceção proposital é `vendas_legado`: true / 0 (trancada de vez).
--
--   select c.relname                                   as tabela,
--          c.relrowsecurity                            as rls_ligado,
--          (select count(*) from pg_policies p
--            where p.schemaname = 'public'
--              and p.tablename  = c.relname)           as politicas
--     from pg_class c
--     join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relkind = 'r'
--    order by c.relrowsecurity, c.relname;
--
-- E o bucket precisa sair com public = false:
--
--   select id, public from storage.buckets where id = 'fotos-clientes';
-- ============================================================================
