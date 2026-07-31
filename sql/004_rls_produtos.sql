-- ============================================================================
-- Waterfall — Migração 004: política de acesso (RLS) da tabela produtos
-- ============================================================================
-- Rode este arquivo no SQL Editor do Supabase. É idempotente.
--
-- Diagnóstico: cadastrar produto falhava silenciosamente ao salvar. A causa é
-- que a tabela "produtos" tem RLS habilitado mas nunca ganhou, em nenhuma
-- migração deste repositório, a política "acesso_autenticado" que as tabelas
-- de vendas/financeiro receberam em 001_vendas_financeiro.sql. Sem policy de
-- INSERT/UPDATE para o papel "authenticated", todo INSERT/UPDATE é bloqueado
-- pelo Postgres com o erro 42501 "new row violates row-level security policy",
-- mesmo com o usuário logado.
-- ============================================================================

alter table public.produtos enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'produtos'
                   and policyname = 'acesso_autenticado')
  then
    create policy acesso_autenticado on public.produtos
      for all to authenticated using (true) with check (true);
  end if;
end $$;

notify pgrst, 'reload schema';
