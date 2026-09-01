# Sistema Waterfall — Visão geral para outra IA

Documento de contexto. Descreve **o que o sistema é, como está organizado e quais
regras de negócio existem**, para que outro agente consiga trabalhar no código
sem precisar reler tudo.

---

## 1. O que é

Aplicação web (SPA) de gestão para uma empresa de **purificadores/filtros de água**
(marca Waterfall). Um operador único (ou poucos usuários internos) usa o sistema
para tocar o negócio inteiro:

- cadastro de **clientes** e do **equipamento instalado** na casa de cada um;
- **catálogo de produtos** (aparelhos e refis, com vínculo entre eles);
- **agenda** de visitas/instalações/trocas e um **diário de trabalho** (ligações, WhatsApps, tarefas);
- **funil de negociações** (CRM em quadro Kanban), da primeira conversa até a venda ou a perda;
- **vendas/orçamentos** com itens, descontos, frete e parcelamento;
- **financeiro** (contas a receber/pagar, baixa, estorno, fechamento mensal);
- geração dos documentos oficiais em **.docx e .pdf**: *Ordem de Serviço* e *Pedido de Venda*;
- **ciclo de troca de refil**: ao concluir uma instalação, o equipamento é criado
  e a próxima troca já é prevista pela periodicidade do refil.

Todo o código, comentários, nomes de variáveis e interface estão em **português do
Brasil**. Mantenha esse padrão ao escrever código novo.

---

## 2. Stack e execução

| Item | Escolha |
|---|---|
| Front-end | React 18 + React Router 6 (SPA, sem SSR) |
| Build | Vite 5 |
| Estilo | Tailwind CSS 4 (via `@tailwindcss/vite`), utilitários inline nas telas |
| Backend | **Supabase** (Postgres + Auth + Storage) — não existe servidor próprio |
| Documentos | JSZip (edita o `word/document.xml` de um `.docx` modelo), jsPDF + html2canvas |
| Imagens | `browser-image-compression` no cliente; `sharp` só em script de build de wallpapers |
| Deploy | Vercel (`vercel.json`) |

Comandos:

```bash
npm run dev
```

- `npm run dev` — Vite na porta 5173 (ou `PORT`)
- `npm run build` — build de produção
- `npm test` — roda `scripts/testar-*.mjs`, testes em Node puro, sem framework

Variáveis de ambiente (`.env`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

---

## 3. Arquitetura

```
src/
  main.jsx / App.jsx      sessão, carregamento inicial, rotas, layout
  pages/                  uma tela por rota
  components/             UI compartilhada, modais, navegação
  data/
    repository.js         CAMADA DE DADOS (o coração do sistema, ~1250 linhas)
    financeiro.js         regras de dinheiro puras (testáveis em Node)
    fotos.js, wallpapers.js
  lib/
    supabaseClient.js, auth.js, datas.js, mascaras.js, cep.js, imagem.js
  os/                     Ordem de Serviço: fill.js, gerar.js, gerarPdf.js, reference.docx
  pedido/                 Pedido de Venda: mesma estrutura
  documentos/docx.js      plumbing compartilhado dos dois documentos
sql/                      migrações numeradas 001..008, rodadas à mão no SQL Editor
scripts/                  testes em Node + otimizador de wallpapers
```

### Padrão central: cache em memória + escrita assíncrona

`src/data/repository.js` é a única porta para os dados. O modelo é:

- `carregarDados()` roda **uma vez logo após o login** e traz todas as tabelas
  para um `cache` em memória;
- as telas leem de forma **síncrona**: `clientes.list()`, `produtos.get(id)`;
- `create/update/remove` são **assíncronos** (rede) e atualizam o cache ao concluir;
- as telas re-renderizam guardando o resultado de `list()` em `useState` e
  chamando um `refresh()` depois de salvar.

Conversões automáticas nas fronteiras:

- app→banco: `camelCase` → `snake_case`; string vazia → `null`; `id`/`criadoEm` nunca são enviados;
- banco→app: `snake_case` → `camelCase`; `null` → `''` (para inputs controlados).

Exceção de volume: **atividades** não são carregadas inteiras — traz-se a janela
dos últimos 365 dias **mais** tudo que estiver `pendente`, de qualquer data.

### Sessão (App.jsx)

Detalhe importante e não óbvio: o Supabase dispara `TOKEN_REFRESHED`/`SIGNED_IN`
sempre que a aba volta ao foco. O `App.jsx` ignora esses eventos de propósito —
trocar o objeto da sessão remontava a árvore inteira e recarregava o banco. O
efeito de carga depende do **id do usuário**, não do objeto de sessão.

---

## 4. Modelo de dados (Postgres/Supabase)

Tabelas: `clientes`, `produtos`, `equipamentos`, `agendamentos`, `oportunidades`,
`vendas`, `venda_itens`, `lancamentos`, `atividades`, `conversas`, `mensagens`,
`fotos`.

Pontos-chave:

- **`produtos`** tem `tipo` (`aparelho` | `refil`), `intervalo_troca_meses` e
  `aparelho_compativel_id` — o refil aponta para o aparelho que ele serve.
- **`equipamentos`** = o aparelho instalado na casa do cliente; dele sai a
  previsão da próxima troca (`proximaTroca`).
- **`agendamentos`** = serviço em campo. Gera OS, pode entrar no caixa, cria o
  equipamento ao ser concluído e dispara o ciclo de refil.
- **`atividades`** = diário de trabalho (ligação, WhatsApp, e-mail, visita,
  reunião, tarefa, nota). É **deliberadamente leve**: não move dinheiro nem gera
  documento. `pendente` = tarefa a fazer; `concluida` = histórico — a mesma linha
  em momentos diferentes, para não existirem duas listas que desandam.
  Resultado `retornar` **obriga** marcar a data do follow-up.
- **`oportunidades`** = a negociação (o cartão do funil). Tem `etapa`
  (novo → contato → proposta → negociacao → ganho/perdido), `valor_estimado`,
  `ordem` (posição na coluna) e o vínculo com a `venda` que a fechou. Existe
  como tabela própria — e não como uma coluna `etapa` em `clientes` — porque o
  mesmo cliente negocia várias vezes ao longo dos anos e cada negociação precisa
  sobreviver como histórico. Ver `sql/009` e `CRM_WHATSAPP.md`.
- **`vendas` + `venda_itens`** com `tipo` (venda/orçamento), `canal`, `status`
  (proposta/confirmada/cancelada), totais gravados, condição de pagamento.
- **`lancamentos`** = o caixa. `tipo` entrada/saída, `status` previsto/realizado,
  `vencimento` × `data_pagamento`, `parcela`/`parcelas`, e `origem`
  (`venda` | `agendamento` | `manual`) com o vínculo correspondente.

- **`conversas` + `mensagens`** = o WhatsApp. Uma conversa por número (o número é
  a identidade, não o cliente — mensagem chega de quem quiser); `mensagens` tem
  `wa_message_id` **unique**, que é o que torna o webhook idempotente. Quem
  escreve nelas é a Edge Function, não o navegador. Ver `sql/010` e a seção 6.
  As colunas `avatar_*` (migração 012) guardam a foto de perfil do WhatsApp do
  contato: o **caminho** no bucket privado, não a URL — a que o WhatsApp entrega
  expira em horas. Quem decide qual foto uma tela mostra é `fotoDoContato()`, no
  repositório: a do cadastro ganha, a do WhatsApp preenche o vazio.

**Rastreabilidade ("de onde veio isso?")**: agendamentos, vendas e oportunidades
guardam `origem_atividade_id`, formando uma corrente navegável — ver
`trilhaDeOrigem()`, `desdobramentosDe()` e o componente `TrilhaOrigem.jsx`. A
corrente completa é
`atividade → oportunidade → venda → agendamento → equipamento → próxima troca`.

### Migrações (`sql/`)

Numeradas 001→012, **idempotentes**, aplicadas manualmente no SQL Editor do
Supabase. Não há ferramenta de migração automática. Os arquivos são fortemente
comentados e explicam a intenção de cada decisão.

`007_seguranca_rls.sql` é o mais importante: a `ANON_KEY` é pública por natureza,
então **o que protege os dados é o RLS**, não a chave. Essa migração garante RLS
em todas as tabelas, incluindo as antigas criadas à mão no painel. A `008` remove
políticas por regra em vez de por nome.

---

## 5. Regras de negócio que precisam estar corretas

Concentradas em `src/data/financeiro.js` (JS puro, sem React nem Supabase — por
isso testável direto no Node):

- `somarMeses()` evita o overflow do `Date.setMonth`: 31/01 + 1 mês = **28/02**, não 03/03.
- `dividirCentavos()` distribui o resto centavo a centavo nas primeiras parcelas —
  a soma das parcelas bate **exatamente** com o total.
- `totaisDaVenda()`: por linha, `quantidade × unitário − desconto da linha`;
  depois `subtotal − desconto geral + frete`, nunca negativo.
- `resumoDoMes()` usa **dois critérios distintos, de propósito**:
  - *realizado* → dinheiro que se moveu, pela `data_pagamento`;
  - *previsto* → o que vence no mês e ainda não foi quitado, pelo `vencimento`.

  Misturar os dois faria o relatório mentir.

Fluxos automáticos no `repository.js`:

- salvar venda/agendamento com `lancarFinanceiro` gera os lançamentos do plano de parcelas;
- concluir agendamento → cria o equipamento → agenda a próxima troca de refil;
- `darBaixa()` / `estornarLancamento()` / `removerDoFinanceiro()` mantêm caixa e
  origem coerentes.
- `ganharOportunidade()` pode abrir a venda correspondente, sempre como
  **proposta**: ganhar no funil não lança receita sozinho — quem gera parcelas e
  agenda a instalação continua sendo a confirmação da venda.
- `perderOportunidade()` **exige o motivo**, pela mesma razão que o resultado
  "retornar" de uma atividade exige a data do retorno.

---

## 6. Documentos (.docx / .pdf)

`src/os/` e `src/pedido/` seguem a mesma estrutura, com `documentos/docx.js`
compartilhado.

A geração **não usa template engine**: carrega o `reference.docx` oficial com
JSZip e edita o `word/document.xml` por spans de texto, preservando 100% do
visual — nada além das células mapeadas é tocado. Os modelos são tabelas de
nível superior, sem aninhamento e sem `vMerge` (mescla só horizontal, `gridSpan`).

Nome de arquivo padronizado: `ordem <cliente> <DD-MM-AAAA>.docx` e
`pedido <cliente> <DD-MM-AAAA>.docx`. Em modo dev, `window.__gerarOS` e
`window.__gerarPedido` ficam expostos para teste no navegador.

---

## 6.1 WhatsApp (Evolution Go + Edge Functions)

Único ponto do sistema com **servidor próprio**: três Edge Functions em
`supabase/functions/` (Deno/TypeScript), publicadas com o Supabase CLI.

| Função | JWT | Papel |
|---|---|---|
| `wa-enviar` | exige | `POST /send/text` na Evolution e grava a mensagem |
| `wa-webhook` | **não** | recebe os eventos; tranca própria pelo `WEBHOOK_TOKEN` |
| `wa-status` | exige | estado da conexão e QR |

**Por que existem**: a chave da Evolution dá poder total sobre o WhatsApp, e
tudo que vai para o navegador é público — mesmo raciocínio da migração 007
sobre a `ANON_KEY`. O front nunca fala com a Evolution.

Detalhes que custaram tempo e não estão na documentação da Evolution:

- o header é `apikey`, e o valor é o **token da instância** (a chave global
  devolve 401 em tudo que é de instância);
- a API do Evolution **Go** não é a da versão Node: `POST /send/text`,
  `GET /instance/status`, `GET /instance/qr`, e o webhook é definido em
  `POST /instance/connect`;
- o número chega em E.164 e **sem o nono dígito**; o casamento com o cadastro
  usa `mesmoNumero()` de `lib/telefone.js`, que converte os dois lados antes de
  comparar. Errar isso não dá erro — só faz a conversa aparecer como número
  desconhecido. Há teste para o caso real em `scripts/testar-telefone.mjs`.

No repositório, o WhatsApp abre duas exceções ao padrão: `mensagens` não entra
na carga inicial (busca por conversa, sob demanda) e `assinarWhatsapp()` escuta
o Realtime — é o único dado que muda sem ninguém clicar em nada.

Segredos ficam em `supabase secrets` (nunca no `.env` do app):
`EVOLUTION_URL`, `EVOLUTION_TOKEN_INSTANCIA`, `EVOLUTION_INSTANCIA`,
`WEBHOOK_TOKEN`. Ver `CRM_WHATSAPP.md` para o desenho completo.

## 7. Autenticação

Login por **nome de usuário**, não por e-mail. `lib/auth.js` converte
`fernando` → `fernando@waterfall.app` antes de chamar o Supabase Auth (que é
baseado em e-mail). Invisível para quem usa; contas com e-mail real continuam
funcionando. O usuário logado fica em memória para gravar autoria (`criado_por`)
nos registros.

---

## 8. Interface

- Layout com **sidebar** fixa no desktop (colapso persistido em `localStorage`),
  `TopNav` e `BottomNav` no mobile — a navegação foi separada por tamanho de tela.
- Rotas: `/` dashboard, `/clientes`, `/clientes/:id`, `/produtos`, `/agenda`,
  `/agendamentos`, `/crm`, `/whatsapp`, `/vendas`, `/financeiro`.
- A tela `/crm` se chama **CRM** no menu; no código ela continua sendo o "funil"
  (`pages/Funil.jsx`, `ETAPAS_FUNIL`, `resumoDoFunil`) — mesma separação de
  "Serviços", cuja rota e tabela seguem como `agendamentos`.
- O CRM (`/crm`) arrasta com o drag-and-drop nativo do HTML5 no desktop e, no
  celular, move pelo menu "Mover para…" do cartão — o DnD do HTML5 não existe no
  toque, e nenhuma biblioteca de arrasto foi adicionada.
- Dashboard com wallpaper escolhível (`WallpaperPicker`, preferência local),
  saudação aleatória, mini-calendário, captura rápida e pendências atrasadas.
- Componentes de UI genéricos em `components/ui.jsx` (`Card`, `Page`, `Button`,
  `Field`, `Modal`, `Badge`, `Empty`, `inputCls`); ícones SVG em `icons.jsx`.
- Fotos (perfil de cliente e de produto) ficam em **bucket privado** do Storage;
  as URLs são assinadas em lote no carregamento (`fotoPerfilUrl`, `fotoUrl`).

---

## 9. Convenções ao mexer no código

1. **Português** em tudo: nomes, comentários, textos de tela.
2. Comentários explicam **por que**, não o quê — o código existente segue esse
   padrão de forma consistente. Mantenha-o.
3. Toda leitura/escrita de dados passa pelo `repository.js`. Telas não chamam
   Supabase direto.
4. Regra de dinheiro nova → `data/financeiro.js` + teste em `scripts/testar-*.mjs`.
5. Alteração de schema → **novo arquivo numerado** em `sql/`, idempotente e
   comentado. Nunca editar migração já aplicada.
6. Tabela nova → adicionar a `TABELAS` no repositório, mapear em
   `MIGRACAO_DA_TABELA` e **ligar RLS** na migração.
7. Sem TypeScript, sem framework de teste, sem gerenciador de estado. Não
   introduza nenhum dos três sem pedido explícito.
