-- ============================================================================
-- Waterfall — Migração 012: foto de perfil do WhatsApp
-- ============================================================================
-- Rode este arquivo INTEIRO no SQL Editor do Supabase, depois da 011.
-- É idempotente (pode rodar de novo) e NÃO APAGA NADA.
--
-- O que ela traz: quatro colunas em `conversas` para a foto que o contato usa
-- no WhatsApp dele.
--
-- POR QUE A FOTO NÃO É GUARDADA COMO URL: o WhatsApp entrega um endereço
-- assinado do `pps.whatsapp.net` que expira em algumas horas. Guardar essa URL
-- daria uma foto que funciona hoje e vira quadrado quebrado amanhã. Então a
-- Edge Function BAIXA a imagem e guarda no bucket privado `whatsapp-midia`,
-- exatamente como já é feito com a foto de perfil do cadastro (migração 007).
-- Aqui fica só o caminho.
--
-- Efeito colateral bom: o navegador do seu time nunca fala com o servidor do
-- WhatsApp. Quem carrega a lista de conversas não anuncia para o Meta que
-- carregou.
-- ============================================================================

begin;

alter table public.conversas
  -- Caminho dentro do bucket `whatsapp-midia`. Inclui uma impressão digital do
  -- conteúdo (ver avatar.ts): quando a pessoa troca a foto, o caminho muda, e
  -- por isso a imagem nova aparece na hora em vez de ficar presa no cache do
  -- navegador com o endereço de sempre.
  add column if not exists avatar_path text,

  -- O id que o próprio WhatsApp dá à foto. Serve para um atalho: se ele é o
  -- mesmo da última vez, nem baixamos a imagem de novo.
  add column if not exists avatar_id text,

  -- Quando conferimos pela última vez. É o que permite reconferir de vez em
  -- quando sem bater na Evolution a cada abertura de tela.
  add column if not exists avatar_em timestamptz,

  -- "Conferido, e não há foto." São dois casos com o mesmo desfecho: a pessoa
  -- não pôs foto nenhuma, ou pôs a privacidade em "meus contatos" e você não
  -- está na lista dela. Sem esta marca, todo carregamento tentaria de novo um
  -- número que nunca vai devolver imagem.
  add column if not exists avatar_ausente boolean default false;

-- Índice parcial de "quem ainda não foi conferido". É a consulta que a tela faz
-- ao abrir o WhatsApp, e ela precisa ser barata mesmo com milhares de conversas.
create index if not exists conversas_avatar_pendente_idx
  on public.conversas (avatar_em nulls first)
  where avatar_ausente is not true;

commit;

notify pgrst, 'reload schema';

-- ============================================================================
-- CONFERÊNCIA — rode depois, separado:
--
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'conversas'
--      and column_name like 'avatar%';
--   -- esperado: avatar_path, avatar_id, avatar_em, avatar_ausente
-- ============================================================================
