-- ============================================================================
-- Waterfall — Migração 011: leads que chegam pelo WhatsApp
-- ============================================================================
-- Rode este arquivo INTEIRO no SQL Editor do Supabase, depois da 010.
-- É idempotente (pode rodar de novo) e NÃO APAGA NADA.
--
-- O QUE MUDA
-- ----------
-- Quando chega mensagem de um número que NÃO está no cadastro, o sistema passa
-- a abrir uma oportunidade na etapa `novo` — o lead aparece sozinho no CRM, em
-- vez de ficar esperando alguém reparar na caixa de entrada.
--
-- POR QUE NÃO CRIAR UM CLIENTE AUTOMÁTICO
-- ---------------------------------------
-- Seria mais simples e estaria errado. `clientes` alimenta venda, financeiro,
-- agenda e os documentos oficiais; qualquer número que mandar mensagem —
-- engano, entregador, propaganda — viraria cadastro, e em seis meses ninguém
-- confia mais na lista. Um lead é uma negociação com alguém que você ainda não
-- sabe se é cliente. E negociação o funil já sabe representar.
--
-- Por isso `oportunidades.cliente_id` continua podendo ser NULL, e as colunas
-- abaixo guardam quem é a pessoa enquanto ela não tem cadastro. Quando virar
-- cliente de verdade, a tela converte em um clique e o vínculo é preenchido.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. De qual conversa o lead nasceu
-- ---------------------------------------------------------------------------
-- `set null` e não `cascade`: apagar a conversa não pode apagar a negociação.
-- O que foi conversado some; o fato de existir um negócio, não.
alter table public.oportunidades
  add column if not exists conversa_id uuid references public.conversas(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 2. Quem é a pessoa, enquanto ela não é cliente
-- ---------------------------------------------------------------------------
-- Guardados NA PRÓPRIA oportunidade, e não só na conversa, de propósito: o
-- cartão do funil precisa mostrar um nome mesmo que a conversa seja apagada, e
-- o nome do WhatsApp pode mudar depois (o cliente troca o perfil) sem que a
-- negociação perca a identidade de quando nasceu.
alter table public.oportunidades
  add column if not exists contato_nome text;

alter table public.oportunidades
  add column if not exists contato_telefone text;      -- E.164, como em conversas

create index if not exists oportunidades_conversa_idx on public.oportunidades (conversa_id);

-- Índice parcial dos leads sem cadastro: é a pergunta "quem chegou e ainda não
-- é cliente?", que a tela faz para destacá-los.
create index if not exists oportunidades_leads_idx on public.oportunidades (criado_em)
  where cliente_id is null;

commit;

notify pgrst, 'reload schema';

-- ============================================================================
-- CONFERÊNCIA — rode depois, separado:
--
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'oportunidades'
--      and column_name in ('conversa_id', 'contato_nome', 'contato_telefone');
--   -- esperado: as três
--
--   select count(*) as leads_sem_cadastro
--     from public.oportunidades where cliente_id is null;
-- ============================================================================
