-- ============================================================================
-- Waterfall — Migração 033: tira as regras antigas das fotos dos clientes
-- ============================================================================
-- Rode este arquivo INTEIRO no SQL Editor do Supabase, depois da 032.
-- É idempotente (pode rodar de novo). NÃO APAGA NENHUMA FOTO — só regras.
--
-- POR QUE ELA EXISTE: a 031 trocou as regras do bucket `fotos-clientes` pelas
-- que conferem a unidade do cliente, mas removeu só as que conhecia pelo nome.
-- O banco tinha outras quatro, criadas à mão pelo painel, antes deste
-- repositório: "Logado lê / sobe / atualiza / apaga fotos-clientes", todas com
-- `auth.uid() IS NOT NULL`.
--
-- Políticas permissivas se somam com OU, então essas quatro anulavam as novas:
-- qualquer pessoa logada, de qualquer unidade e até sem papel, continuava
-- abrindo, trocando e apagando a foto de qualquer cliente.
--
-- Quem usa o sistema hoje não sente nada: todos são gestão, e a gestão passa
-- pelas regras novas (`arquivo_permitido` responde sim para ela).
-- ============================================================================

begin;

-- Trava: sem as quatro regras novas, remover as antigas deixaria o bucket sem
-- regra nenhuma, e as fotos sumiriam para o sistema inteiro.
do $$
begin
  if (select count(*) from pg_policies
       where schemaname = 'storage' and tablename = 'objects'
         and policyname in ('fotos_ler', 'fotos_enviar', 'fotos_atualizar', 'fotos_remover')) <> 4 then
    raise exception
      'ABORTADO: faltam as politicas fotos_* em storage.objects. Rode sql/031_dados_por_unidade.sql primeiro.';
  end if;
end $$;

-- A regra é declarativa, como na 008, e pelo mesmo motivo: o nome das antigas
-- tem acento ("lê"), e comparar por nome pode falhar em silêncio. Sai tudo que
-- fala do bucket e não é uma das quatro regras novas.
do $$
declare p text;
begin
  for p in select policyname from pg_policies
            where schemaname = 'storage' and tablename = 'objects'
              and policyname not in ('fotos_ler', 'fotos_enviar', 'fotos_atualizar', 'fotos_remover')
              and coalesce(qual, '') || coalesce(with_check, '') like '%fotos-clientes%'
  loop
    execute format('drop policy %I on storage.objects', p);
    raise notice 'Removida a politica "%" de storage.objects', p;
  end loop;
end $$;

commit;

-- ============================================================================
-- CONFERÊNCIA — rode depois, separado:
--
--   select policyname, cmd from pg_policies
--    where schemaname = 'storage' and tablename = 'objects'
--    order by policyname;
--
--   -- Oito linhas: fotos_ler, fotos_enviar, fotos_atualizar, fotos_remover e
--   -- as quatro wa_midia_*. Nenhuma começando com "Logado".
-- ============================================================================
