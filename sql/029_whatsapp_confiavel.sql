-- ============================================================================
-- Waterfall — Migração 029: WhatsApp que não fica mudo sem ninguém saber
-- ============================================================================
-- Rode este arquivo INTEIRO no SQL Editor do Supabase, depois da 028.
-- É idempotente (pode rodar de novo) e NÃO APAGA NADA.
--
-- POR QUE ELA EXISTE: de 24/09 a 30/10/2026 o sistema não recebeu UMA mensagem
-- e ninguém soube. Os envios continuavam saindo, então tudo parecia normal — mas
-- a Evolution tinha perdido a URL do webhook (no Evolution Go, conectar a
-- instância pelo painel sem informar a URL apaga a que estava gravada), e nada
-- no sistema percebia o silêncio.
--
-- O que ela traz:
--   1. `whatsapp_estado` — uma linha por instância, com a última vez que a
--      Evolution falou com o sistema. É o "batimento": conectado e sem batimento
--      depois de um envio quer dizer que o webhook parou.
--   2. `mensagens.editada_em` e `mensagens.apagada_em` — o WhatsApp deixa editar
--      e apagar para todos. Até aqui, os dois chegavam como um balão vazio de
--      "tipo que o sistema não mostra"; agora corrigem a mensagem original.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. ESTADO DA CONEXÃO
-- ---------------------------------------------------------------------------
-- Quem escreve aqui são as Edge Functions: `wa-webhook` a cada evento que chega
-- (no máximo uma vez por minuto, para não gravar a cada recibo) e `wa-status`
-- a cada verificação. O aplicativo só lê.

create table if not exists public.whatsapp_estado (
  instancia         text primary key,          -- 'waterfall'
  conectado         boolean default false,
  nome              text,                      -- nome do perfil do número pareado
  motivo            text,                      -- por que caiu, quando a Evolution diz

  -- A última vez que QUALQUER evento da Evolution chegou ao webhook. Não é a
  -- última mensagem: recibo de entrega, conexão e histórico também contam.
  ultimo_evento_em  timestamptz,
  ultima_verificacao_em timestamptz,

  -- Quantas mensagens o histórico do celular trouxe desde a última conexão.
  -- É o que a tela mostra enquanto o número novo sincroniza.
  historico_mensagens integer default 0,

  atualizado_em     timestamptz not null default now()
);

drop trigger if exists whatsapp_estado_atualizado_em on public.whatsapp_estado;
create trigger whatsapp_estado_atualizado_em
  before update on public.whatsapp_estado
  for each row execute function public.tocar_atualizado_em();

alter table public.whatsapp_estado enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'whatsapp_estado'
                   and policyname = 'acesso_autenticado') then
    create policy acesso_autenticado on public.whatsapp_estado
      for all to authenticated using (true) with check (true);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. MENSAGEM EDITADA E APAGADA
-- ---------------------------------------------------------------------------
-- Apagar para todos NÃO apaga a linha: o registro de que algo foi dito (e
-- quando) continua valendo para quem atende — a tela mostra "mensagem apagada"
-- no lugar do texto, como o próprio WhatsApp.

alter table public.mensagens
  add column if not exists editada_em timestamptz,
  add column if not exists apagada_em timestamptz;

commit;

notify pgrst, 'reload schema';

-- ============================================================================
-- CONFERÊNCIA — rode depois, separado:
--
--   select * from public.whatsapp_estado;
--   -- vazio até a primeira verificação; depois, uma linha 'waterfall'
--
--   select column_name from information_schema.columns
--    where table_name = 'mensagens' and column_name in ('editada_em', 'apagada_em');
--   -- as duas devem aparecer
-- ============================================================================
