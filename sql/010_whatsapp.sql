-- ============================================================================
-- Waterfall — Migração 010: WhatsApp (conversas e mensagens)
-- ============================================================================
-- Rode este arquivo INTEIRO no SQL Editor do Supabase, depois da 009.
-- É idempotente (pode rodar de novo) e NÃO APAGA NADA.
--
-- O que ela traz:
--   1. `conversas` — um fio por número de telefone.
--   2. `mensagens` — o que foi dito, em qual direção, com qual estado.
--   3. O bucket privado `whatsapp-midia`, para áudio e imagem.
--
-- CONTEXTO: quem escreve nestas tabelas NÃO é o navegador. É a Edge Function
-- `wa-webhook`, que recebe os eventos da Evolution Go rodando na VPS. O
-- aplicativo só LÊ daqui (e pede o envio para a função `wa-enviar`). A chave da
-- Evolution nunca chega ao navegador — ver a seção 3.1 do CRM_WHATSAPP.md.
--
-- Convenção de nulos: a camada de dados converte string vazia em NULL (ver
-- paraColuna em src/data/repository.js). Por isso quase nada aqui é NOT NULL, e
-- os CHECK toleram NULL — igual às tabelas existentes.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. CONVERSAS — um fio por número
-- ---------------------------------------------------------------------------
-- O número é a identidade, e não o cliente: mensagem chega de quem quiser,
-- inclusive de quem não está no cadastro. `cliente_id` é o vínculo, feito
-- quando o número casa com alguém (ver src/lib/telefone.js) ou quando você
-- vincula à mão na tela.

create table if not exists public.conversas (
  id             uuid primary key default gen_random_uuid(),

  -- E.164 sem o '+': 5547991234567. UNIQUE porque duas conversas para o mesmo
  -- número seriam duas metades do mesmo histórico.
  numero         text not null unique,

  -- `set null` e não `cascade`, como nas demais tabelas: excluir um cliente não
  -- apaga o registro do que foi conversado com ele.
  cliente_id     uuid references public.clientes(id) on delete set null,
  nome_whatsapp  text,                    -- nome do perfil, quando o WhatsApp manda
  instancia      text default 'waterfall',-- qual número SEU atendeu

  -- Espelho da última mensagem, para a lista da caixa de entrada não precisar
  -- ler a tabela de mensagens inteira só para desenhar 20 linhas.
  ultima_em      timestamptz,
  ultima_previa  text,
  nao_lidas      integer default 0,

  arquivada      boolean default false,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

create index if not exists conversas_cliente_idx  on public.conversas (cliente_id);
create index if not exists conversas_recentes_idx on public.conversas (ultima_em desc);

-- Reaproveita a função criada na migração 005.
drop trigger if exists conversas_atualizado_em on public.conversas;
create trigger conversas_atualizado_em
  before update on public.conversas
  for each row execute function public.tocar_atualizado_em();

-- ---------------------------------------------------------------------------
-- 2. MENSAGENS
-- ---------------------------------------------------------------------------

create table if not exists public.mensagens (
  id             uuid primary key default gen_random_uuid(),

  -- `cascade` aqui SIM: mensagem sem conversa não significa nada.
  conversa_id    uuid not null references public.conversas(id) on delete cascade,

  -- O id da mensagem no WhatsApp. O UNIQUE é o que torna o webhook idempotente:
  -- a Evolution reentrega eventos (é o comportamento normal de qualquer
  -- webhook), e sem esta restrição a conversa duplicaria sozinha. É a linha
  -- mais importante desta migração.
  wa_message_id  text unique,

  direcao        text check (direcao in ('entrada', 'saida')),
  tipo           text default 'texto'
                 check (tipo in ('texto', 'imagem', 'audio', 'video', 'documento', 'outro')),
  texto          text,

  -- Caminho no bucket privado, no mesmo esquema das fotos de cliente: o arquivo
  -- não fica público, a tela pede uma URL assinada quando vai exibir.
  midia_path     text,
  midia_nome     text,

  status         text default 'enviada'
                 check (status in ('pendente', 'enviada', 'entregue', 'lida', 'falhou')),
  erro           text,                    -- motivo, quando status = 'falhou'

  -- Contexto de trabalho: de qual negociação saiu esta mensagem. É o que faz a
  -- conversa aparecer dentro do cartão do CRM, e não só na caixa de entrada.
  oportunidade_id uuid references public.oportunidades(id) on delete set null,
  enviado_por     text,                   -- usuário do sistema que mandou

  ocorrido_em    timestamptz,             -- carimbo do WhatsApp (não o nosso)
  criado_em      timestamptz not null default now()
);

-- (conversa, ocorrido_em) é exatamente como a tela lê: uma conversa por vez, em
-- ordem cronológica.
create index if not exists mensagens_conversa_idx     on public.mensagens (conversa_id, ocorrido_em);
create index if not exists mensagens_oportunidade_idx on public.mensagens (oportunidade_id);
-- Índice parcial das que falharam: é a consulta de "o que não saiu?", que
-- precisa ser barata mesmo com anos de histórico.
create index if not exists mensagens_falhas_idx       on public.mensagens (criado_em)
  where status = 'falhou';

-- ---------------------------------------------------------------------------
-- 3. RLS — quem está logado usa tudo; o `anon` não vê nada
-- ---------------------------------------------------------------------------
-- Vale lembrar por quê (é o assunto da migração 007): a chave que vai no
-- navegador é pública. Sem RLS, qualquer pessoa com ela leria as conversas dos
-- seus clientes sem nunca fazer login. Conteúdo de conversa é dado pessoal —
-- aqui a proteção não é conforto, é obrigação.
--
-- A Edge Function do webhook escreve com a SERVICE_ROLE_KEY, que passa por
-- cima do RLS por definição: ela roda no servidor, sem usuário logado.

alter table public.conversas enable row level security;
alter table public.mensagens enable row level security;

do $$
declare t text;
begin
  foreach t in array array['conversas', 'mensagens'] loop
    if not exists (select 1 from pg_policies
                   where schemaname = 'public' and tablename = t
                     and policyname = 'acesso_autenticado')
    then
      execute format(
        'create policy acesso_autenticado on public.%I
           for all to authenticated using (true) with check (true)', t);
    end if;
  end loop;
end $$;

commit;

-- ---------------------------------------------------------------------------
-- 4. STORAGE — bucket privado da mídia recebida
-- ---------------------------------------------------------------------------
-- Mesmo esquema do bucket de fotos (migração 007): privado de verdade, com as
-- quatro políticas explícitas. Áudio de cliente é tão sensível quanto foto.

insert into storage.buckets (id, name, public)
     values ('whatsapp-midia', 'whatsapp-midia', false)
on conflict (id) do update set public = false;

do $$
declare
  politicas text[] := array['wa_midia_ler', 'wa_midia_enviar', 'wa_midia_atualizar', 'wa_midia_remover'];
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
             with check (bucket_id = %L)', politicas[i], 'whatsapp-midia');
      elsif acoes[i] = 'update' then
        execute format(
          'create policy %I on storage.objects for update to authenticated
             using (bucket_id = %L) with check (bucket_id = %L)',
          politicas[i], 'whatsapp-midia', 'whatsapp-midia');
      else
        execute format(
          'create policy %I on storage.objects for %s to authenticated
             using (bucket_id = %L)', politicas[i], acoes[i], 'whatsapp-midia');
      end if;
      raise notice 'Politica de Storage criada: %', politicas[i];
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Realtime — a mensagem que chega sem você pedir
-- ---------------------------------------------------------------------------
-- A mensagem nova entra pelo webhook, não por uma ação da tela. Sem publicar a
-- tabela, o navegador só descobriria recarregando a página. Com isto, a
-- assinatura de Realtime avisa a aba aberta em segundos.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime'
                     and schemaname = 'public' and tablename = 'mensagens') then
      alter publication supabase_realtime add table public.mensagens;
    end if;
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime'
                     and schemaname = 'public' and tablename = 'conversas') then
      alter publication supabase_realtime add table public.conversas;
    end if;
  end if;
end $$;

notify pgrst, 'reload schema';

-- ============================================================================
-- CONFERÊNCIA — rode depois, separado:
--
--   select c.relname, c.relrowsecurity as rls_ligado,
--          (select count(*) from pg_policies p
--            where p.schemaname = 'public' and p.tablename = c.relname) as politicas
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relname in ('conversas', 'mensagens');
--   -- esperado: true / 1 nas duas
--
--   select id, public from storage.buckets where id = 'whatsapp-midia';
--   -- esperado: public = false
--
--   select tablename from pg_publication_tables where pubname = 'supabase_realtime';
--   -- 'conversas' e 'mensagens' devem aparecer
-- ============================================================================
