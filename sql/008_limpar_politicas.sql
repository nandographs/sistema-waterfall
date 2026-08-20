-- ============================================================================
-- Waterfall — Migração 008: tranca o backup e tira as políticas duplicadas
-- ============================================================================
-- Rode este arquivo INTEIRO no SQL Editor do Supabase, depois do 007.
-- É idempotente e NÃO APAGA NENHUM DADO — só remove políticas redundantes.
--
-- CONTEXTO
-- --------
-- A conferência da migração 007 mostrou que cinco tabelas antigas carregavam
-- uma política herdada do painel, chamada "Usuários autenticados podem tudo":
--
--     for all to public using (auth.uid() IS NOT NULL)
--
-- O papel `{public}` assusta, porque em Postgres `public` quer dizer TODOS os
-- papéis — inclusive o `anon`, o da chave que vai no navegador. Mas a condição
-- salva: numa requisição sem login, `auth.uid()` devolve NULL, a condição dá
-- falso e nada é liberado. Ou seja: NÃO havia vazamento. Esta migração não
-- corrige uma brecha nessas cinco tabelas — ela arruma a bagunça.
--
-- POR QUE ARRUMAR, ENTÃO
-- ----------------------
-- Porque políticas permissivas se somam com OU, nunca com E. Enquanto houver
-- duas regras dizendo a mesma coisa por caminhos diferentes, toda auditoria
-- futura precisa reconstruir esse raciocínio inteiro para concluir "está ok".
-- Pior: se um dia alguém afrouxar a política antiga achando que a nova segura
-- a barra, o OU deixa passar. Uma regra por tabela, explícita, é o que permite
-- ler a segurança do sistema sem ter que decifrá-la.
--
-- A `acesso_autenticado` (criada em 007) cobre exatamente o mesmo terreno e é
-- mais precisa: prende no papel `authenticated` em vez de depender de uma
-- condição avaliada em tempo de execução.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Remove a política duplicada das tabelas em uso
-- ---------------------------------------------------------------------------
-- Seguro porque `acesso_autenticado` já permite tudo para quem está logado —
-- é um superconjunto do que a política antiga permitia. Ninguém que consegue
-- trabalhar hoje perde acesso amanhã.
--
-- (Não existe papel que satisfaça `auth.uid() IS NOT NULL` e ao mesmo tempo
-- não seja `authenticated`: quando há um JWT de usuário, o PostgREST assume o
-- papel `authenticated` a partir do próprio token. E o `service_role` ignora
-- RLS por completo, então também não depende desta política.)

do $$
declare
  t text;
  tabelas text[] := array['clientes', 'agendamentos', 'equipamentos', 'fotos', 'produtos'];
begin
  foreach t in array tabelas loop
    if exists (select 1 from pg_policies
               where schemaname = 'public' and tablename = t
                 and policyname = 'Usuários autenticados podem tudo') then

      -- Trava de segurança: só remove a antiga se a nova estiver mesmo lá.
      -- Sem isto, rodar este arquivo sem ter rodado o 007 deixaria a tabela
      -- com RLS ligado e ZERO políticas — trancada para o sistema inteiro.
      if not exists (select 1 from pg_policies
                     where schemaname = 'public' and tablename = t
                       and policyname = 'acesso_autenticado') then
        raise exception
          'ABORTADO: public.% nao tem a politica acesso_autenticado. Rode sql/007_seguranca_rls.sql primeiro.', t;
      end if;

      execute format('drop policy %I on public.%I', 'Usuários autenticados podem tudo', t);
      raise notice 'Politica duplicada removida de public.%', t;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. `vendas_legado` — este é o ajuste que muda algo de verdade
-- ---------------------------------------------------------------------------
-- Aqui havia um problema real. A migração 001 renomeou a antiga `vendas` para
-- `vendas_legado`, e as políticas seguem a tabela no rename — então o backup
-- do seu financeiro antigo continuou legível pela API, para qualquer usuário
-- logado. O `enable row level security` da 007 não resolveu isso sozinho,
-- justamente porque a política veio junto.
--
-- Removendo a última política, a tabela fica com RLS ligado e nenhuma regra de
-- acesso: invisível pela API para todo mundo. Os DADOS CONTINUAM LÁ, intactos.
-- Você lê normalmente pelo SQL Editor do painel, que roda como dono do banco e
-- ignora RLS — o único lugar de onde um backup deveria ser consultado.
--
-- O aplicativo não é afetado: `vendas_legado` não aparece na lista TABELAS de
-- src/data/repository.js, ou seja, o sistema nunca a consulta.

do $$
begin
  if exists (select 1 from pg_policies
             where schemaname = 'public' and tablename = 'vendas_legado') then
    drop policy "Usuários autenticados podem tudo" on public.vendas_legado;
    raise notice 'vendas_legado trancada: RLS ligado, nenhuma politica.';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';

-- ============================================================================
-- CONFERÊNCIA — rode este bloco separado, depois
-- ============================================================================
-- Esperado: uma linha por tabela, todas com politicas = 1 e papeis
-- {authenticated}. A `vendas_legado` deve SUMIR do resultado (zero políticas).
--
--   select tablename as tabela, policyname as politica, roles as papeis
--     from pg_policies where schemaname = 'public'
--    order by tablename;
--
-- E o teste que importa — prove que o backup está mesmo trancado. Rode isto
-- na aba SQL e depois tente ler a mesma tabela pelo aplicativo: aqui funciona
-- (dono do banco ignora RLS), lá não retorna nada.
--
--   select count(*) from public.vendas_legado;
-- ============================================================================
