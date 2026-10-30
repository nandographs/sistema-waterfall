-- ============================================================================
-- Waterfall — Migração 028: cliente inativo
-- ============================================================================
-- Rode este arquivo INTEIRO no SQL Editor do Supabase, depois da 027.
-- É idempotente (pode rodar de novo) e NÃO APAGA NADA.
--
-- Até aqui, o único jeito de tirar um cliente do caminho era EXCLUIR — e
-- excluir leva junto o histórico de quem comprou, recebeu visita e pagou. Mas
-- quem se mudou, trocou de marca ou devolveu o aparelho não é um cadastro
-- errado: é um cliente que deixou de ser atendido. O histórico precisa ficar;
-- o que precisa sair é o alarme (troca de refil prevista, lista de clientes).
--
--   inativo_em         → desde quando. Vazio = cliente ativo
--   motivo_inativacao  → por quê (ver MOTIVOS_INATIVACAO no repository.js)
--   obs_inativacao     → detalhe livre ("foi para Curitiba", "comprou Europa")
--
-- É a DATA, e não um booleano `ativo`, que marca a situação: "inativo desde
-- quando" é a primeira pergunta de quem pensa em reconquistar alguém, e uma
-- coluna só não deixa as duas informações desandarem uma da outra.
--
-- O motivo importa porque nem todo inativo é igual: "trocou de marca" é alguém
-- que dá para reconquistar; "faleceu" é alguém para quem não se manda mensagem.
-- ============================================================================

alter table public.clientes
  add column if not exists inativo_em date,
  add column if not exists motivo_inativacao text,
  add column if not exists obs_inativacao text;

comment on column public.clientes.inativo_em is
  'Data em que o cliente foi inativado. Vazio = cliente ativo.';
comment on column public.clientes.motivo_inativacao is
  'Por que o cliente foi inativado (mudou, concorrente, retirou, sem_contato, faleceu, outro).';
comment on column public.clientes.obs_inativacao is
  'Observação livre sobre a inativação.';

notify pgrst, 'reload schema';
