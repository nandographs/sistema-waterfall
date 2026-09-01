-- ============================================================================
-- Waterfall — LIMPEZA das conversas de teste do WhatsApp
-- ============================================================================
-- ⚠️  ESTE ARQUIVO APAGA DADOS. NÃO É UMA MIGRAÇÃO.
--
-- Por isso ele NÃO tem número de sequência: as migrações (001…013) descrevem a
-- forma do banco e são feitas para rodar em qualquer instalação, sempre. Esta
-- aqui é uma faxina pontual, de uma vez, na SUA base. Guardar as duas coisas
-- com a mesma cara seria o começo de alguém rodar esta sem querer.
--
-- O QUE ELE APAGA
--   1. os cartões de lead do funil que nasceram de conversas do WhatsApp;
--   2. as conversas;
--   3. as mensagens — POR CASCATA, sem que este arquivo precise citá-las:
--      `mensagens.conversa_id` é `on delete cascade` (migração 010). Some
--      TUDO que foi dito, dos dois lados. Não há lixeira. Não há desfazer.
--
-- O QUE ELE PRESERVA
--   * os clientes cadastrados — ninguém sai do cadastro por causa disto;
--   * as negociações de clientes de verdade (as que têm `cliente_id`), como o
--     cartão "teste" do Fernando dos Santos Junior;
--   * as fotos de perfil no bucket `whatsapp-midia`, que ficam órfãs. Não são
--     apagadas aqui de propósito: mexer em Storage por SQL é outra conversa, e
--     um punhado de JPEGs de 30 KB não incomoda ninguém. Se alguém escrever de
--     novo, a foto é rebaixada e o caminho volta a apontar para algo válido.
--
-- DEPOIS DE RODAR: a caixa de entrada fica vazia e o funil fica só com o que é
-- de cliente. Se qualquer um daqueles números escrever de novo, o webhook
-- recria a conversa, abre o lead em `novo` e busca a foto — do zero, sozinho.
-- É o comportamento que acabamos de consertar; esta faxina é, na prática, o
-- teste dele.
--
-- COMO RODAR: cole INTEIRO no SQL Editor do Supabase e execute.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Os cartões de lead
-- ---------------------------------------------------------------------------
-- Só os que são lead DE VERDADE: nasceram de uma conversa e nunca viraram
-- cliente. A dupla condição é o que protege o cartão de quem já está cadastrado
-- — apagar a negociação de um cliente por causa de uma faxina de WhatsApp seria
-- destruir trabalho comercial junto com dado de teste.
delete from public.oportunidades
 where conversa_id is not null
   and cliente_id is null;

-- ---------------------------------------------------------------------------
-- 2. As conversas (e, por cascata, as mensagens)
-- ---------------------------------------------------------------------------
delete from public.conversas;

commit;

-- ============================================================================
-- CONFERÊNCIA — rode depois, separado:
--
--   select count(*) as conversas from public.conversas;      -- esperado: 0
--   select count(*) as mensagens from public.mensagens;      -- esperado: 0
--
--   -- o que sobrou no funil (esperado: só cartões com cliente_id)
--   select titulo, etapa, cliente_id is not null as tem_cliente
--     from public.oportunidades order by etapa;
--
--   -- os clientes continuam todos lá
--   select count(*) as clientes from public.clientes;
-- ============================================================================
