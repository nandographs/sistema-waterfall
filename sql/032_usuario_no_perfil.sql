-- ============================================================================
-- Waterfall — Migração 032: o nome de login no perfil
-- ============================================================================
-- Rode este arquivo INTEIRO no SQL Editor do Supabase, depois da 031.
-- É idempotente (pode rodar de novo) e NÃO APAGA NADA.
--
-- A tela de Equipe lista quem usa o sistema, e a gestão precisa saber com que
-- nome cada pessoa ENTRA — "fernando", não "Nando". Esse nome mora no e-mail
-- interno do Supabase Auth (fernando@waterfall.app, ver lib/auth.js), e o
-- navegador não lê `auth.users`. Então o perfil passa a guardar uma cópia.
-- ============================================================================

begin;

alter table public.perfis add column if not exists usuario text;

-- Mesma regra de lib/auth.js (emailParaUsuario): o domínio interno sai; e-mail
-- de outro domínio fica inteiro, porque é ele que a pessoa digita.
create or replace function public.usuario_do_email(email text)
returns text
language sql
immutable
as $$
  select case when lower(email) like '%@waterfall.app'
              then split_part(lower(email), '@', 1)
              else lower(email) end
$$;

update public.perfis p
   set usuario = public.usuario_do_email(u.email)
  from auth.users u
 where u.id = p.user_id and p.usuario is null;

-- A 030 criava o perfil sem o login; agora já nasce com ele.
create or replace function public.criar_perfil_do_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.perfis (user_id, nome, usuario)
  values (new.id,
          coalesce(nullif(new.raw_user_meta_data->>'nome', ''),
                   nullif(new.raw_user_meta_data->>'display_name', ''),
                   split_part(new.email, '@', 1)),
          public.usuario_do_email(new.email))
  on conflict (user_id) do nothing;
  return new;
end $$;

revoke execute on function public.criar_perfil_do_usuario() from public;

commit;

notify pgrst, 'reload schema';

-- ============================================================================
-- CONFERÊNCIA — rode depois, separado:
--
--   select nome, usuario, papel from public.perfis order by nome;
--   -- todo perfil com `usuario` preenchido
-- ============================================================================
