-- ============================================================================
-- Waterfall — Migração 013: leads retroativos das conversas do WhatsApp
-- ============================================================================
-- Rode este arquivo INTEIRO no SQL Editor do Supabase, depois da 012.
-- É idempotente (pode rodar de novo) e NÃO APAGA NADA.
--
-- POR QUE ELA EXISTE
--
-- A regra "número desconhecido que escreve vira lead no funil" foi escrita na
-- Edge Function `wa-webhook`, e ela só roda quando uma mensagem CHEGA. As
-- conversas que já estavam no banco quando a regra subiu nunca passaram por
-- ela — ficaram na caixa de entrada como "sem cadastro" e nunca apareceram no
-- CRM.
--
-- O webhook já foi corrigido para se curar sozinho (agora ele pergunta "esta
-- conversa já tem cartão?" em vez de "esta conversa é nova?"), mas isso só
-- resolve na PRÓXIMA mensagem de cada um. Esta migração faz o resto: cria o
-- cartão de quem já está aí, agora.
--
-- O QUE ELA CRIA — um cartão na etapa `novo` para cada conversa que:
--   * não está ligada a um cliente (quem já é cliente entra pelo funil normal);
--   * não está arquivada (arquivar é dizer "isto aqui está encerrado");
--   * ainda não tem cartão nenhum, de etapa nenhuma.
--
-- A última condição é a que torna o arquivo seguro de rodar duas vezes.
-- ============================================================================

begin;

insert into public.oportunidades
  (cliente_id, conversa_id, contato_nome, contato_telefone,
   titulo, etapa, canal, observacoes, ordem, criado_por)
select
  null,
  c.id,
  nullif(c.nome_whatsapp, ''),
  c.numero,
  -- Mesmo formato de título que o webhook usa, para os cartões criados hoje e
  -- os criados amanhã não parecerem de sistemas diferentes.
  case
    when nullif(c.nome_whatsapp, '') is not null then c.nome_whatsapp || ' (WhatsApp)'
    else 'Contato novo ' || c.numero
  end,
  'novo',
  'whatsapp',
  -- A última mensagem é o melhor resumo que existe do que a pessoa quer. O
  -- webhook guarda a PRIMEIRA; aqui só temos a prévia da última, e dizer qual é
  -- evita que alguém leia isso achando que foi o primeiro contato.
  case
    when nullif(c.ultima_previa, '') is not null
      then 'Última mensagem: "' || c.ultima_previa || '"'
    else null
  end,
  -- Espaçamento de 1000 entre vizinhos, como o PASSO_ORDEM do aplicativo: um
  -- arrasto grava UMA linha em vez de renumerar a coluna inteira. A ordem segue
  -- a da caixa de entrada — quem falou por último aparece por último na coluna.
  (coalesce((select max(o.ordem) from public.oportunidades o where o.etapa = 'novo'), 0)
    + 1000 * row_number() over (order by c.ultima_em asc nulls first)),
  'whatsapp'
from public.conversas c
where c.cliente_id is null
  and coalesce(c.arquivada, false) = false
  and not exists (
    select 1 from public.oportunidades o where o.conversa_id = c.id
  );

commit;

notify pgrst, 'reload schema';

-- ============================================================================
-- CONFERÊNCIA — rode depois, separado:
--
--   select etapa, count(*) from public.oportunidades
--    where canal = 'whatsapp' group by etapa;
--
--   -- as que continuam sem cartão (esperado: só clientes e arquivadas)
--   select c.numero, c.nome_whatsapp, c.cliente_id is not null as eh_cliente,
--          c.arquivada
--     from public.conversas c
--    where not exists (select 1 from public.oportunidades o where o.conversa_id = c.id);
-- ============================================================================
