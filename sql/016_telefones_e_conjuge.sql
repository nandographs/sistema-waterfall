-- ============================================================================
-- Waterfall — Migração 016: vários telefones por cliente e os dados do cônjuge
-- ============================================================================
-- Rode este arquivo INTEIRO no SQL Editor do Supabase, depois da 015.
-- É idempotente (pode rodar de novo) e NÃO APAGA NADA.
--
-- O QUE MUDA
--
-- Cinco colunas em `clientes`. Nenhuma tabela nova.
--
-- 1. TELEFONES
--
-- Um cliente tem o celular dele, o fixo de casa, o da esposa e o do vizinho que
-- recebe recado. Com uma coluna `telefone` só, os outros três iam parar nas
-- observações — onde ninguém consegue buscar e o WhatsApp nunca acha.
--
--   [ { "numero": "(47) 99123-4567", "rotulo": "WhatsApp" },
--     { "numero": "(47) 3333-4444",  "rotulo": "Casa" } ]
--
-- As chaves são camelCase de propósito: a conversão snake_case <-> camelCase do
-- repositório só toca nas colunas de primeiro nível, nunca dentro do JSON.
--
-- Por que jsonb e não uma tabela `cliente_telefones`: um telefone não tem vida
-- própria. Não é consultado sozinho, não é editado sozinho e é sempre regravado
-- junto com o cliente. É a mesma decisão de `vendas.pagamentos` (migração 015),
-- pelo mesmo motivo.
--
-- A COLUNA `telefone` CONTINUA, agora derivada do PRIMEIRO da lista. Meio
-- sistema lê ela — a busca do WhatsApp (lib/telefone.js), a Ordem de Serviço, o
-- Pedido, o cartão do funil. Mantê-la preenchida é o que faz nada disso precisar
-- ser reescrito. Cliente cadastrado antes desta migração fica com `[]` e segue
-- sendo lido pela coluna antiga.
--
-- 2. CÔNJUGE
--
-- Quem assina junto e quem está em casa na hora da instalação normalmente não é
-- a mesma pessoa do cadastro. São campos soltos, e não uma tabela de "contatos
-- do cliente", porque é UM cônjuge — uma tabela aqui cobraria join e tela para
-- guardar quatro campos que já sabemos quais são.
-- ============================================================================

begin;

alter table public.clientes
  add column if not exists telefones         jsonb default '[]'::jsonb,
  add column if not exists conjuge_nome      text,
  add column if not exists conjuge_telefone  text,
  add column if not exists conjuge_cpf       text,
  add column if not exists conjuge_nascimento date;

-- Sem NOT NULL em nenhuma: a convenção do repositório é converter string vazia
-- em NULL (ver paraColuna), e um campo opcional deixado em branco não pode
-- virar erro de gravação.

comment on column public.clientes.telefones is
  'Telefones do cliente: [{numero, rotulo}]. O primeiro é o principal e espelha '
  'a coluna `telefone`, que o WhatsApp e os documentos continuam lendo. '
  'Lista vazia = usar só a coluna `telefone`.';

comment on column public.clientes.conjuge_nome is
  'Cônjuge/companheiro(a): quem assina junto e quem costuma receber o técnico.';

commit;

-- Se a API do PostgREST ainda não enxergar as colunas novas, rode:
--   notify pgrst, 'reload schema';
