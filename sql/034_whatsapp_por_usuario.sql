-- ============================================================================
-- Waterfall — Migração 034: um número de WhatsApp por usuário
-- ============================================================================
-- Rode este arquivo INTEIRO no SQL Editor do Supabase, depois da 033.
-- É idempotente (pode rodar de novo) e NÃO APAGA NENHUMA CONVERSA.
--
-- ATÉ AQUI o WhatsApp era UM número, o da Waterfall, e só a gestão via. Agora
-- cada usuário pode conectar o próprio celular:
--
--   * quem é distribuidor vê e usa SÓ o número dele;
--   * a gestão vê todos, e escolhe com qual número está atendendo — o dela, o
--     da empresa ou o de qualquer pessoa da equipe que esteja conectado;
--   * desconectar e reiniciar valem para o número que a pessoa pode usar.
--
-- O QUE MUDA:
--   1. `whatsapp_estado` vira o cadastro dos números: uma linha por instância
--      da Evolution, com DONO (o usuário) e unidade. Sem dono = número da
--      empresa, usado pela gestão.
--   2. `whatsapp_tokens` guarda a chave de cada instância. Tabela SEM política
--      nenhuma: só as Edge Functions (service_role) leem. O navegador nunca vê
--      a chave — é a mesma regra de sempre (CRM_WHATSAPP.md, seção 3.1).
--   3. A conversa passa a ser única por NÚMERO SEU + telefone do cliente. O
--      mesmo cliente pode falar com dois vendedores, e são duas conversas.
--   4. A mensagem passa a ser única dentro da conversa. Dois números da equipe
--      conversando entre si geram a MESMA mensagem dos dois lados (saída num,
--      entrada no outro); com o unique antigo, o segundo lado era descartado.
--   5. As regras de acesso de conversas, mensagens e mídia passam a olhar o
--      dono do número, e não só "é gestão".
--
-- AS CONVERSAS ANTIGAS (instância 'waterfall', o número apagado em 30/10) vão
-- para o número atual da empresa. É a história da empresa: separar deixaria o
-- mesmo cliente em dois fios, um deles de um número que não existe mais.
-- ============================================================================

begin;

-- Trava: sem a 029 e a 031, as peças abaixo não existem.
do $$
begin
  if not exists (select 1 from information_schema.tables
                  where table_schema = 'public' and table_name = 'whatsapp_estado') then
    raise exception 'ABORTADO: falta a tabela whatsapp_estado. Rode sql/029_whatsapp_confiavel.sql primeiro.';
  end if;
  if not exists (select 1 from pg_proc where proname = 'eh_gestao') then
    raise exception 'ABORTADO: falta a função eh_gestao(). Rode sql/030 e sql/031 primeiro.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. O CADASTRO DOS NÚMEROS
-- ---------------------------------------------------------------------------

alter table public.whatsapp_estado
  add column if not exists dono_id    uuid references auth.users(id) on delete set null,
  add column if not exists unidade_id uuid references public.unidades(id) on delete set null,
  add column if not exists numero     text,      -- E.164 do celular pareado
  add column if not exists criado_em  timestamptz not null default now();

comment on column public.whatsapp_estado.dono_id is
  'Usuário dono do número. Vazio = número da empresa (usado pela gestão).';

-- Um número por pessoa. Conectar "outro" é trocar o celular dela, não somar.
create unique index if not exists whatsapp_estado_um_por_dono
  on public.whatsapp_estado (dono_id) where dono_id is not null;

-- O número que já existe é o da empresa, da unidade da casa.
update public.whatsapp_estado
   set unidade_id = (select id from public.unidades where tipo = 'casa')
 where unidade_id is null and dono_id is null;

-- ---------------------------------------------------------------------------
-- 2. AS CHAVES — fora do alcance do navegador
-- ---------------------------------------------------------------------------

create table if not exists public.whatsapp_tokens (
  instancia  text primary key references public.whatsapp_estado(instancia)
             on update cascade on delete cascade,
  token      text not null,
  criado_em  timestamptz not null default now()
);

alter table public.whatsapp_tokens enable row level security;
-- Nenhuma política: com RLS ligado e sem política, ninguém logado lê nem
-- escreve. As Edge Functions usam a service_role, que passa por cima.
revoke all on public.whatsapp_tokens from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. CONVERSA ÚNICA POR (NÚMERO SEU, TELEFONE DO CLIENTE)
-- ---------------------------------------------------------------------------

-- A instância atual da empresa: a única linha que existe hoje.
update public.conversas
   set instancia = (select instancia from public.whatsapp_estado
                     where dono_id is null order by atualizado_em desc limit 1)
 where instancia is distinct from (select instancia from public.whatsapp_estado
                                    where dono_id is null order by atualizado_em desc limit 1)
   and exists (select 1 from public.whatsapp_estado where dono_id is null);

alter table public.conversas alter column instancia drop default;

do $$
declare c text;
begin
  -- O unique antigo é só no número; o nome dele foi dado pelo Postgres.
  for c in select con.conname
             from pg_constraint con
             join pg_class t on t.oid = con.conrelid
            where t.relname = 'conversas' and con.contype = 'u'
              and (select array_agg(a.attname::text) from pg_attribute a
                    where a.attrelid = t.oid and a.attnum = any(con.conkey)) = array['numero'] loop
    execute format('alter table public.conversas drop constraint %I', c);
  end loop;
end $$;

create unique index if not exists conversas_instancia_numero
  on public.conversas (instancia, numero);
create index if not exists conversas_numero_idx on public.conversas (numero);

-- ---------------------------------------------------------------------------
-- 4. MENSAGEM ÚNICA DENTRO DA CONVERSA
-- ---------------------------------------------------------------------------

do $$
declare c text;
begin
  for c in select con.conname
             from pg_constraint con
             join pg_class t on t.oid = con.conrelid
            where t.relname = 'mensagens' and con.contype = 'u'
              and (select array_agg(a.attname::text) from pg_attribute a
                    where a.attrelid = t.oid and a.attnum = any(con.conkey)) = array['wa_message_id'] loop
    execute format('alter table public.mensagens drop constraint %I', c);
  end loop;
end $$;

-- Sem `where`: o upsert do histórico usa (conversa_id, wa_message_id) como alvo,
-- e o Postgres só aceita índice parcial como alvo se o insert repetir o filtro.
-- Mensagem sem id do WhatsApp (envio que falhou) tem wa_message_id nulo, e
-- nulos não colidem entre si.
create unique index if not exists mensagens_conversa_wa_id
  on public.mensagens (conversa_id, wa_message_id);
-- Recibo de entrega e "apagar para todos" procuram só pelo id.
create index if not exists mensagens_wa_id_idx on public.mensagens (wa_message_id);

-- ---------------------------------------------------------------------------
-- 5. QUEM VÊ O QUÊ
-- ---------------------------------------------------------------------------

-- Pode usar este número? Gestão usa todos; os outros, só o próprio.
-- O parâmetro é `alvo`, e não `nome`: `whatsapp_estado` e `perfis` têm uma
-- coluna `nome`, e o Postgres recusa a função por não saber qual das duas é.
create or replace function public.pode_usar_instancia(alvo text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.eh_gestao()
      or exists (select 1 from public.whatsapp_estado e
                  join public.perfis p on p.user_id = e.dono_id
                 where e.instancia = alvo and e.dono_id = auth.uid()
                   and p.ativo and p.papel is not null)
$$;

create or replace function public.pode_ver_conversa(conversa uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.conversas c
                  where c.id = conversa and public.pode_usar_instancia(c.instancia))
$$;

revoke all on function public.pode_usar_instancia(text) from public, anon;
revoke all on function public.pode_ver_conversa(uuid) from public, anon;
grant execute on function public.pode_usar_instancia(text) to authenticated;
grant execute on function public.pode_ver_conversa(uuid) to authenticated;

-- Sai a regra "só gestão" da 031 (e qualquer outra), entra a do dono.
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies
            where schemaname = 'public' and tablename in ('conversas', 'mensagens', 'whatsapp_estado') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy por_numero on public.conversas for all to authenticated
  using (public.pode_usar_instancia(instancia))
  with check (public.pode_usar_instancia(instancia));

create policy por_numero on public.mensagens for all to authenticated
  using (public.pode_ver_conversa(conversa_id))
  with check (public.pode_ver_conversa(conversa_id));

-- O cadastro dos números: cada um vê o seu; a gestão vê todos. Quem escreve
-- aqui são as Edge Functions.
create policy por_numero_ler on public.whatsapp_estado for select to authenticated
  using (public.pode_usar_instancia(instancia));
create policy gestao_escreve on public.whatsapp_estado for all to authenticated
  using ((select public.eh_gestao())) with check ((select public.eh_gestao()));

-- Mídia: a foto, o áudio e a foto de perfil seguem a conversa.
--   mensagens/<conversa_id>/<arquivo>  → quem vê a conversa
--   avatares/<telefone>/<arquivo>      → quem vê alguma conversa com esse telefone
create or replace function public.midia_whatsapp_permitida(caminho text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case split_part(caminho, '/', 1)
    when 'mensagens' then
      split_part(caminho, '/', 2) ~ '^[0-9a-f-]{36}$'
      and public.pode_ver_conversa(split_part(caminho, '/', 2)::uuid)
    when 'avatares' then
      exists (select 1 from public.conversas c
               where c.numero = split_part(caminho, '/', 2)
                 and public.pode_usar_instancia(c.instancia))
    else public.eh_gestao()
  end
$$;

revoke all on function public.midia_whatsapp_permitida(text) from public, anon;
grant execute on function public.midia_whatsapp_permitida(text) to authenticated;

drop policy if exists wa_midia_ler on storage.objects;
create policy wa_midia_ler on storage.objects for select to authenticated
  using (bucket_id = 'whatsapp-midia' and public.midia_whatsapp_permitida(name));

commit;

notify pgrst, 'reload schema';

-- ============================================================================
-- CONFERÊNCIA — rode depois, separado:
--
--   select instancia, dono_id, unidade_id, conectado from public.whatsapp_estado;
--   -- uma linha, sem dono: o número da empresa
--
--   select instancia, count(*) from public.conversas group by 1;
--   -- todas no número da empresa
--
--   select indexname from pg_indexes
--    where indexname in ('conversas_instancia_numero', 'mensagens_conversa_wa_id');
--   -- as duas
-- ============================================================================
