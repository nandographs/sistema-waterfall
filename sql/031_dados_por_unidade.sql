-- ============================================================================
-- Waterfall — Migração 031: cada unidade vê só os próprios dados
-- ============================================================================
-- Rode este arquivo INTEIRO no SQL Editor do Supabase, depois da 030.
-- É idempotente (pode rodar de novo) e NÃO APAGA NENHUM DADO.
--
-- É aqui que o nível de acesso passa a valer. Até a 030, toda tabela tinha a
-- `acesso_autenticado` da 007 — logado usa tudo. A partir desta:
--
--   gestão        → vê e altera tudo, de todas as unidades (como hoje);
--   distribuidor  → vê e altera só o que é da unidade dele;
--   sem papel     → não vê nada.
--
-- Para quem usa o sistema hoje NADA MUDA: todos são gestão (030), e todo dado
-- que já existe passa a ser da Waterfall.
--
-- DE QUEM É CADA REGISTRO
-- -----------------------
-- O dono de verdade é o CLIENTE. Serviço, equipamento, negociação, venda,
-- lançamento, atividade e foto de um cliente são da unidade dele, não da de
-- quem clicou: se a gestão agenda uma troca para um cliente do distribuidor, a
-- troca aparece na agenda do distribuidor. Sem cliente (tarefa interna,
-- despesa avulsa, lead do WhatsApp), vale a unidade de quem criou.
--
-- Quem preenche `unidade_id` é um trigger, não o navegador: o app não precisa
-- mandar nada, e o que ele mandar não vale mais do que o cliente diz.
--
-- O QUE FICA SÓ COM A GESTÃO
-- --------------------------
--   funcionarios                          → a folha de pagamento da Waterfall
--   conversas, mensagens, whatsapp_estado → o WhatsApp é UM número, o da
--                                           Waterfall. Cada distribuidor com o
--                                           seu número é a próxima etapa.
--   produtos                              → todos LEEM o catálogo; só a gestão
--                                           cadastra e muda preço.
--
-- As Edge Functions do WhatsApp também passam a recusar quem não é gestão —
-- ver `exigirGestao` em supabase/functions/_compartilhado/acesso.ts. Elas
-- precisam ser publicadas de novo para isso valer.
-- ============================================================================

begin;

-- Trava: sem um gestor ativo, as políticas abaixo trancariam todo mundo.
do $$
begin
  if not exists (select 1 from public.perfis where papel = 'gestao' and ativo) then
    raise exception
      'ABORTADO: nenhum usuario da gestao ativo em public.perfis. Rode sql/030_perfis_e_unidades.sql e confira.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. A COLUNA DO DONO
-- ---------------------------------------------------------------------------
-- Adicionada já com a Waterfall como valor padrão: o Postgres preenche as
-- linhas existentes sem reescrevê-las uma a uma — e, principalmente, sem
-- disparar os triggers de `atualizado_em`, que marcariam a base inteira como
-- "alterada agora". Logo depois o padrão sai: daqui em diante quem decide é o
-- trigger do passo 2.

do $$
declare
  t text;
  casa uuid := (select id from public.unidades where tipo = 'casa');
  tabelas text[] := array[
    'clientes', 'equipamentos', 'agendamentos', 'oportunidades',
    'vendas', 'venda_itens', 'lancamentos', 'atividades', 'fotos'
  ];
begin
  foreach t in array tabelas loop
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = t
                      and column_name = 'unidade_id') then
      execute format(
        'alter table public.%I add column unidade_id uuid not null default %L
           references public.unidades(id)', t, casa);
      execute format('alter table public.%I alter column unidade_id drop default', t);
      raise notice 'unidade_id criada em public.%', t;
    end if;
    execute format(
      'create index if not exists %I on public.%I (unidade_id)', t || '_unidade_idx', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. QUEM PREENCHE
-- ---------------------------------------------------------------------------
-- Uma função para todas as tabelas: lê as colunas de vínculo pelo jsonb da
-- linha, porque nem toda tabela tem as três (venda_itens só tem venda_id).
--
-- `security definer` é proposital. Se a busca do cliente respeitasse o RLS, um
-- distribuidor que mandasse o id de um cliente da Waterfall não o encontraria,
-- cairia na unidade dele, e o registro entraria — pendurado num cliente que
-- ele nem enxerga. Vendo a unidade real, o `with check` da política recusa.

create or replace function public.definir_unidade()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  linha  jsonb := to_jsonb(new);
  dono   uuid;
begin
  if linha ? 'cliente_id' and linha->>'cliente_id' is not null then
    select unidade_id into dono from public.clientes where id = (linha->>'cliente_id')::uuid;
  end if;
  if dono is null and linha ? 'venda_id' and linha->>'venda_id' is not null then
    select unidade_id into dono from public.vendas where id = (linha->>'venda_id')::uuid;
  end if;
  if dono is null and linha ? 'agendamento_id' and linha->>'agendamento_id' is not null then
    select unidade_id into dono from public.agendamentos where id = (linha->>'agendamento_id')::uuid;
  end if;

  if dono is null then
    if tg_op = 'UPDATE' then
      -- O app regrava o item inteiro e manda '' (null) no que não mexeu: sem
      -- valor novo, fica o de antes.
      dono := coalesce(new.unidade_id, old.unidade_id);
    else
      -- `minha_unidade()` é nula para as Edge Functions (service_role, sem
      -- usuário) — o lead que o WhatsApp cria é da Waterfall, dona do número.
      dono := coalesce(new.unidade_id, public.minha_unidade(),
                       (select id from public.unidades where tipo = 'casa'));
    end if;
  end if;

  new.unidade_id := dono;
  return new;
end $$;

-- Passar um cliente para outra unidade leva junto tudo o que é dele. Sem isto,
-- o cliente mudaria de dono e a história dele ficaria para trás, visível só
-- para quem não atende mais.
create or replace function public.levar_dados_do_cliente()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t text;
begin
  foreach t in array array['equipamentos', 'agendamentos', 'oportunidades', 'vendas',
                           'lancamentos', 'atividades', 'fotos'] loop
    execute format('update public.%I set unidade_id = $1 where cliente_id = $2 and unidade_id <> $1', t)
      using new.unidade_id, new.id;
  end loop;
  return null;
end $$;

-- Os itens da venda não têm cliente_id; seguem a venda.
create or replace function public.levar_itens_da_venda()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.venda_itens set unidade_id = new.unidade_id
   where venda_id = new.id and unidade_id <> new.unidade_id;
  return null;
end $$;

revoke execute on function public.definir_unidade()        from public;
revoke execute on function public.levar_dados_do_cliente() from public;
revoke execute on function public.levar_itens_da_venda()   from public;

do $$
declare
  t text;
  tabelas text[] := array[
    'clientes', 'equipamentos', 'agendamentos', 'oportunidades',
    'vendas', 'venda_itens', 'lancamentos', 'atividades', 'fotos'
  ];
begin
  foreach t in array tabelas loop
    execute format('drop trigger if exists definir_unidade on public.%I', t);
    execute format(
      'create trigger definir_unidade before insert or update on public.%I
         for each row execute function public.definir_unidade()', t);
  end loop;
end $$;

drop trigger if exists levar_dados_do_cliente on public.clientes;
create trigger levar_dados_do_cliente
  after update of unidade_id on public.clientes
  for each row when (old.unidade_id is distinct from new.unidade_id)
  execute function public.levar_dados_do_cliente();

drop trigger if exists levar_itens_da_venda on public.vendas;
create trigger levar_itens_da_venda
  after update of unidade_id on public.vendas
  for each row when (old.unidade_id is distinct from new.unidade_id)
  execute function public.levar_itens_da_venda();

-- ---------------------------------------------------------------------------
-- 3. AS POLÍTICAS
-- ---------------------------------------------------------------------------
-- Mesma regra da 008: em cada tabela sai TODA política que houver e entra uma
-- só, a definitiva — sem depender de nome, e sem duas regras somando com OU.
--
-- `(select ...)` em volta das funções não é enfeite: faz o Postgres calcular a
-- resposta uma vez por consulta. Sem ele, perguntaria "é gestão?" a cada linha
-- de uma tabela com milhares de clientes.

create or replace function pg_temp.trocar_politicas(tabela text, definicoes text[])
returns void language plpgsql as $$
declare
  p text;
  d text;
begin
  for p in select policyname from pg_policies
            where schemaname = 'public' and tablename = tabela loop
    execute format('drop policy %I on public.%I', p, tabela);
  end loop;
  foreach d in array definicoes loop
    execute replace(d, '@', format('public.%I', tabela));
  end loop;
end $$;

do $$
declare
  t text;
  regra constant text :=
    '((select public.eh_gestao()) or unidade_id = (select public.minha_unidade()))';
begin
  foreach t in array array['clientes', 'equipamentos', 'agendamentos', 'oportunidades',
                           'vendas', 'venda_itens', 'lancamentos', 'atividades', 'fotos'] loop
    perform pg_temp.trocar_politicas(t, array[
      format('create policy por_unidade on @ for all to authenticated using %s with check %s',
             regra, regra)
    ]);
  end loop;

  foreach t in array array['funcionarios', 'conversas', 'mensagens', 'whatsapp_estado'] loop
    if exists (select 1 from information_schema.tables
                where table_schema = 'public' and table_name = t) then
      perform pg_temp.trocar_politicas(t, array[
        'create policy so_gestao on @ for all to authenticated
           using ((select public.eh_gestao())) with check ((select public.eh_gestao()))'
      ]);
    end if;
  end loop;

  -- Catálogo: lê quem tem papel; escreve só a gestão. Políticas separadas
  -- porque "ler" e "escrever" aqui têm respostas diferentes.
  perform pg_temp.trocar_politicas('produtos', array[
    'create policy produtos_ler on @ for select to authenticated
       using ((select public.minha_unidade()) is not null)',
    'create policy produtos_gestao on @ for all to authenticated
       using ((select public.eh_gestao())) with check ((select public.eh_gestao()))'
  ]);
end $$;

-- ---------------------------------------------------------------------------
-- 4. STORAGE
-- ---------------------------------------------------------------------------
-- As políticas da 007 e da 010 olhavam só o bucket — quem estava logado abria
-- qualquer arquivo. No bucket de fotos, o caminho diz de quem é o arquivo:
--
--   <cliente_id>/<arquivo>.jpg   fotos da ficha do cliente
--   perfil/<cliente_id>.jpg      foto de perfil do cliente
--   produto/<produto_id>.jpg     foto do catálogo
--
-- `escrita` separa o catálogo: todos veem a foto do produto, só a gestão troca.

create or replace function public.arquivo_permitido(caminho text, escrita boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  pasta   text := split_part(caminho, '/', 1);
  cliente text;
begin
  if public.eh_gestao() then return true; end if;
  if public.minha_unidade() is null then return false; end if;

  if pasta = 'produto' then return not escrita; end if;

  cliente := case when pasta = 'perfil'
                  then split_part(split_part(caminho, '/', 2), '.', 1)
                  else pasta end;
  -- Compara como texto: um caminho que não seja uuid não pode virar erro de
  -- conversão no meio da política, só um "não".
  return exists (select 1 from public.clientes
                  where id::text = cliente and unidade_id = public.minha_unidade());
end $$;

revoke execute on function public.arquivo_permitido(text, boolean) from public;
grant  execute on function public.arquivo_permitido(text, boolean) to authenticated;

do $$
declare
  p text;
begin
  for p in select unnest(array['fotos_ler', 'fotos_enviar', 'fotos_atualizar', 'fotos_remover',
                               'wa_midia_ler', 'wa_midia_enviar', 'wa_midia_atualizar', 'wa_midia_remover']) loop
    execute format('drop policy if exists %I on storage.objects', p);
  end loop;
end $$;

create policy fotos_ler on storage.objects for select to authenticated
  using (bucket_id = 'fotos-clientes' and public.arquivo_permitido(name, false));
create policy fotos_enviar on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos-clientes' and public.arquivo_permitido(name, true));
create policy fotos_atualizar on storage.objects for update to authenticated
  using (bucket_id = 'fotos-clientes' and public.arquivo_permitido(name, true))
  with check (bucket_id = 'fotos-clientes' and public.arquivo_permitido(name, true));
create policy fotos_remover on storage.objects for delete to authenticated
  using (bucket_id = 'fotos-clientes' and public.arquivo_permitido(name, true));

-- Mídia do WhatsApp: mesmo destino das conversas, só a gestão. Quem grava aqui
-- são as Edge Functions (service_role), que não passam por estas políticas.
create policy wa_midia_ler on storage.objects for select to authenticated
  using (bucket_id = 'whatsapp-midia' and (select public.eh_gestao()));
create policy wa_midia_enviar on storage.objects for insert to authenticated
  with check (bucket_id = 'whatsapp-midia' and (select public.eh_gestao()));
create policy wa_midia_atualizar on storage.objects for update to authenticated
  using (bucket_id = 'whatsapp-midia' and (select public.eh_gestao()))
  with check (bucket_id = 'whatsapp-midia' and (select public.eh_gestao()));
create policy wa_midia_remover on storage.objects for delete to authenticated
  using (bucket_id = 'whatsapp-midia' and (select public.eh_gestao()));

commit;

notify pgrst, 'reload schema';

-- ============================================================================
-- CONFERÊNCIA 1 — rode depois, separado. Uma política por tabela:
--
--   select tablename, policyname, cmd from pg_policies
--    where schemaname = 'public' order by tablename, policyname;
--
--   -- produtos com duas (produtos_ler, produtos_gestao); perfis e unidades
--   -- com as da 030; as demais com uma só (por_unidade ou so_gestao).
--
-- CONFERÊNCIA 2 — prova o isolamento SEM criar login de verdade. Monta um
-- distribuidor de mentira, finge ser ele e desfaz tudo no fim (rollback).
-- Rode o bloco inteiro de uma vez:
--
--   begin;
--   insert into auth.users (id, email, aud, role)
--        values ('00000000-0000-0000-0000-0000000000d1', 'teste-dist@waterfall.app',
--                'authenticated', 'authenticated');
--   insert into public.unidades (id, nome, tipo)
--        values ('00000000-0000-0000-0000-0000000000a1', 'Distribuidor Teste', 'distribuidor');
--   update public.perfis set papel = 'distribuidor',
--          unidade_id = '00000000-0000-0000-0000-0000000000a1'
--    where user_id = '00000000-0000-0000-0000-0000000000d1';
--
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}';
--
--   select count(*) as clientes_que_ele_ve from public.clientes;         -- 0
--   insert into public.clientes (nome) values ('Cliente do distribuidor');
--   select count(*) as clientes_que_ele_ve from public.clientes;         -- 1
--   select count(*) as produtos_que_ele_ve from public.produtos;         -- o catálogo todo
--   select count(*) as conversas_que_ele_ve from public.conversas;       -- 0
--   select count(*) as folha_que_ele_ve from public.funcionarios;        -- 0
--
--   rollback;
-- ============================================================================
