# Waterfall — Plano do CRM (funil Kanban) e da integração com WhatsApp

Documento de planejamento. Complementa o [SISTEMA.md](SISTEMA.md) (arquitetura e
regras de negócio) e o [PAGINAS_E_UI.md](PAGINAS_E_UI.md) (interface). Descreve
**o que construir, em que ordem e por quê**.

> **Situação em 01/09/2026 — as fases 1 e 2 estão no ar.**
>
> Migrações `009` e `010` aplicadas. Evolution **Go** rodando na VPS da
> Hostinger, publicada com HTTPS pelo Traefik que já estava lá
> (`evolution-go-xdoz.srv1945429.hstgr.cloud`; a raiz redireciona para
> `/manager`). Instância de produção: **`waterfall`**, número
> **(47) 99252-4344**. As três Edge Functions publicadas; segredos em
> `supabase secrets`.
>
> O webhook aponta **direto** para a `wa-webhook`, assinando `MESSAGE`,
> `SEND_MESSAGE` e `CONNECTION` — com `SEND_MESSAGE`, o que for respondido pelo
> celular também entra no histórico. (A instância de teste `nando_teste` passava
> por um fluxo do n8n, que continua publicado e serve de ponto de entrada caso
> um dia entre IA no meio.)
>
> Conferido em produção: recebimento, idempotência (3 entregas → 1 linha),
> tranca do webhook (401 sem o segredo) e o casamento com o cadastro pelo nono
> dígito.
>
> Fora do escopo até agora: mídia (áudio/imagem), grupos e as automações da
> fase 3.

Decisões já tomadas antes deste plano:

| Pergunta | Decisão |
|---|---|
| O que é um cartão do Kanban | **Oportunidade** (negociação), não o cliente |
| Alcance do WhatsApp | **Enviar e receber** (inbox dentro do sistema) |
| Onde roda a Evolution | **Evolution Go** em VPS própria (Docker) + **Supabase Edge Functions** como backend |
| Navegação | **Rota nova `/crm`** |

---

## 1. Por que uma oportunidade e não uma etapa no cliente

Colocar `etapa` na tabela `clientes` seria uma linha de SQL. O problema aparece
no segundo negócio: o cliente que comprou o purificador em março e volta em
outubro para um segundo aparelho teria que sair de "ganho" e voltar para
"contato", apagando o registro da primeira negociação. O funil viraria uma foto
do presente sem memória — e memória é justamente o que este sistema faz bem
(ver `trilhaDeOrigem()` e `desdobramentosDe()`).

Uma **oportunidade** é uma negociação com começo e fim. Ela nasce de uma
atividade (uma ligação, um WhatsApp), passa pelas etapas, e termina virando uma
**venda** ou uma perda com motivo. O cliente acumula oportunidades ao longo dos
anos; o funil mostra só as abertas.

Isso mantém a corrente que já existe:

```
atividade → oportunidade → venda → agendamento → equipamento → próxima troca
```

Hoje a corrente pula da atividade direto para a venda. A oportunidade preenche o
buraco: o período em que o negócio existe mas ainda não tem um pedido montado.

### Etapas: constante em JS, não tabela de configuração

O sistema já resolve vocabulário fechado com dicionários em `repository.js`
(`TIPOS_ATIVIDADE`, `STATUS_VENDA`, `CANAIS_VENDA`). O funil segue o mesmo
padrão: uma constante `ETAPAS_FUNIL` e um `check` no banco.

Uma tabela `funil_etapas` editável só se paga quando existem vários funis ou
vários vendedores discordando do processo. Com um funil só, ela cobra o preço de
uma tela de configuração e do risco de etapa órfã, sem entregar nada em troca.
Se um dia precisar, a migração é direta: a coluna `etapa` já é texto.

Etapas propostas, coladas no ciclo real de venda de purificador:

| Etapa | Significa |
|---|---|
| `novo` | Chegou um contato, ninguém falou com ele ainda |
| `contato` | Já houve conversa; entendendo a necessidade |
| `proposta` | Orçamento/pedido apresentado |
| `negociacao` | Discutindo preço, condição, prazo |
| `ganho` | Virou venda (guarda `venda_id`) |
| `perdido` | Não fechou (exige `motivo_perda`) |

`ganho` e `perdido` são terminais: no quadro ficam recolhidas numa coluna
estreita de "fechadas nos últimos 30 dias", para o quadro não crescer sem fim.

---

## 2. Fase 1 — o funil (sem WhatsApp)

Entregável: quadro Kanban funcionando com os dados reais, sem depender de
nenhuma infraestrutura nova. É a fase que pode ir para produção sozinha.

### 2.1 Migração `sql/009_crm_oportunidades.sql`

Idempotente e comentada, como as anteriores. Esboço do essencial:

```sql
create table if not exists public.oportunidades (
  id             uuid primary key default gen_random_uuid(),

  cliente_id     uuid references public.clientes(id) on delete set null,
  titulo         text,                    -- "Purificador para a cozinha"
  etapa          text default 'novo'
                 check (etapa in ('novo','contato','proposta','negociacao','ganho','perdido')),

  valor_estimado numeric(12,2) default 0, -- soma por coluna = valor do funil
  produto_id     uuid references public.produtos(id) on delete set null,
  canal          text check (canal in ('indicacao','whatsapp','instagram','loja','telefone','site','outro')),
  responsavel    text,
  data_prevista  date,                    -- previsão de fechamento

  -- Posição dentro da coluna. Numérico com folga: mover um cartão calcula a
  -- média entre os vizinhos e grava UMA linha, em vez de renumerar a coluna
  -- inteira a cada arrasto.
  ordem          numeric(20,10) default 1000,

  -- Fechamento
  motivo_perda   text,
  fechada_em     date,
  venda_id       uuid references public.vendas(id) on delete set null,

  -- A corrente: de onde esta negociação nasceu.
  origem_atividade_id uuid references public.atividades(id) on delete set null,

  criado_por     text,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

create index if not exists oportunidades_etapa_idx   on public.oportunidades (etapa, ordem);
create index if not exists oportunidades_cliente_idx on public.oportunidades (cliente_id);
create index if not exists oportunidades_abertas_idx on public.oportunidades (data_prevista)
  where etapa not in ('ganho','perdido');

create trigger oportunidades_atualizado_em
  before update on public.oportunidades
  for each row execute function public.tocar_atualizado_em();   -- já existe (005)
```

Mais:

- `alter table public.vendas add column if not exists oportunidade_id ...` e o
  mesmo em `atividades` — para a trilha andar nos dois sentidos.
- RLS `acesso_autenticado` no mesmo molde da 007. O `alter default privileges`
  da 007 já tira o `anon` das tabelas novas, mas a política precisa ser criada.
- `notify pgrst, 'reload schema';` no fim, fora da transação.

Nenhuma coluna `not null` além de `id`/`criado_em`: é a convenção do projeto,
porque `paraColuna()` converte string vazia em `null`.

### 2.2 Camada de dados (`src/data/repository.js`)

1. `'oportunidades'` entra em `TABELAS`, no `cache` e em `MIGRACAO_DA_TABELA`.
   Volume é baixo (dezenas por mês) — carrega inteiro no boot, sem janela.
2. `export const oportunidades = makeStore('oportunidades')`, com o comentário de
   forma do objeto que os outros stores têm.
3. Helpers de domínio:

| Função | Papel |
|---|---|
| `oportunidadesPorEtapa()` | agrupa as abertas + fechadas recentes, já ordenadas |
| `moverOportunidade(id, etapa, indiceDestino)` | calcula `ordem` pela média dos vizinhos e grava |
| `ganharOportunidade(id, venda)` | marca `ganho`, grava `venda_id` e `fechada_em` |
| `perderOportunidade(id, motivo)` | exige motivo — perda sem motivo não ensina nada |
| `oportunidadesDoCliente(clienteId)` | para o bloco no ClienteDetalhe |
| `resumoDoFunil()` | contagem e soma por etapa, para o topo do quadro |

4. Integrar nas funções de rastreabilidade existentes: `origemDe()`,
   `trilhaDeOrigem()`, `desdobramentosDe()`, `linhaDoTempoDoCliente()` e
   `proximoPasso()`. Uma oportunidade sem atividade pendente é um negócio
   esquecido — `proximoPasso()` precisa saber disso.

Regra que vale impor na camada de dados, no mesmo espírito do
`resultado = 'retornar'` das atividades: **mover para `proposta` ou
`negociacao` sem nenhuma atividade pendente do cliente sugere criar o próximo
passo**. Sugerir na tela, não bloquear.

### 2.3 Tela `/crm`

- Rota nova em `App.jsx`; entrada `{ to: '/crm', label: 'CRM', Icon: ... }` em
  `components/navegacao.js`. São 8 destinos — a barra mobile continua com 5 e o
  "Mais" passa a ter 3.
- Componentes novos: `pages/Funil.jsx`, `components/OportunidadeCard.jsx`,
  `components/OportunidadeModal.jsx`.
- Cartão mostra: cliente (com a foto de perfil, que já vem assinada no cache),
  título, valor, ícone do canal e o **próximo passo**, em coral quando atrasado.
  Densidade controlada, sem sombra — linguagem visual da seção 1 do
  `PAGINAS_E_UI.md`.
- Cabeçalho da coluna: nome da etapa, quantidade e soma dos valores.

**Arrastar sem biblioteca nova.** A convenção 7 do `SISTEMA.md` pede parcimônia
com dependências, e as bibliotecas de drag-and-drop de React são pesadas.
Solução em duas camadas:

- **Desktop**: `draggable` nativo do HTML5 (`onDragStart`/`onDragOver`/`onDrop`).
  Cerca de 40 linhas e nenhuma dependência.
- **Mobile**: o HTML5 DnD não existe no touch. Em vez de emular, o cartão tem um
  menu "Mover para…" que abre o `Modal` (que já vira bottom sheet) com a lista de
  etapas; as colunas viram carrossel horizontal com `snap`. É mais rápido de usar
  em campo do que arrastar com o polegar.

Ao soltar em `ganho`, abrir o fluxo de venda já preenchido com o cliente e o
produto da oportunidade — o pulo do gato do funil é não redigitar.

### 2.4 Onde o funil aparece fora do quadro

- **ClienteDetalhe**: bloco "Negociações" com as oportunidades do cliente.
- **Dashboard**: uma linha no resumo — "N negociações abertas, R$ X em jogo,
  M paradas há mais de 7 dias". A terceira é a útil.
- **CapturaRapida**: opção de abrir oportunidade junto com a atividade.

### 2.5 Como verificar a fase 1

1. `sql/009` roda duas vezes seguidas sem erro (idempotência).
2. O bloco de conferência de RLS da 007 mostra `oportunidades` com política ≥ 1.
3. Criar oportunidade, arrastar entre colunas, recarregar a página: a ordem e a
   etapa sobrevivem.
4. Ganhar uma oportunidade gera venda com `oportunidade_id` preenchido, e o
   `TrilhaOrigem` mostra a corrente completa.
5. Perder sem motivo é recusado.
6. `npm test` continua passando.

---

## 3. Fase 2 — WhatsApp com a Evolution API

### 3.1 A restrição que decide toda a arquitetura

A chave global da Evolution (`GLOBAL_API_KEY` no Evolution Go) **não pode
existir no navegador**. Qualquer variável `VITE_*` é compilada dentro do JavaScript público
— é o mesmo raciocínio que a migração 007 já faz sobre a `ANON_KEY`. Quem tiver
essa chave envia mensagem pelo seu WhatsApp, apaga suas instâncias e lê suas
conversas.

Portanto: **o front nunca fala com a Evolution API**. Ele fala com uma Edge
Function do Supabase, autenticado com o JWT que já tem do login; a função é que
guarda a chave e conversa com a Evolution.

```
Navegador ──JWT──> Edge Function ──apikey──> Evolution API ──> WhatsApp
                        │
Evolution ──webhook──>  │ ──> Postgres (conversas, mensagens) ──realtime──> Navegador
```

### 3.2 Infraestrutura (VPS, com Evolution Go)

**Evolution Go** é a implementação em Go da Evolution, mantida pela mesma
fundação e baseada na `whatsmeow` em vez da Baileys da versão Node. Para este
caso ela é a escolha certa por consumo: um binário compilado na casa de
50–150 MB de RAM por instância, contra 200–500 MB da versão Node — o que muda o
tamanho (e o preço) da VPS. Do ponto de vista do sistema o contrato é o mesmo:
REST com chave no header, webhook de eventos, QR para parear.

- VPS Linux modesta já serve (1–2 GB de RAM). Hostinger tem template pronto de
  Evolution Go em Docker, o que encurta o marco 5.
- `docker compose` com o serviço da Evolution Go e **PostgreSQL** — ela usa dois
  bancos próprios (`evogo_auth` e `evogo_users`), separados do Supabase.
  RabbitMQ/NATS e MinIO/S3 são opcionais e **não** entram: os eventos vêm por
  webhook e a mídia fica no Storage do Supabase, junto com as fotos.
- Domínio + TLS via Caddy ou Nginx + Certbot. HTTPS é obrigatório: o webhook
  carrega conteúdo de conversa.
- Variável principal: `GLOBAL_API_KEY` (gere 32+ bytes aleatórios).
- **Backup**: o Postgres da Evolution guarda a sessão do WhatsApp. Perder o
  volume significa reconectar lendo o QR de novo.
- Firewall: só 80/443 abertos; a porta da Evolution não vai para a internet.

**A conferir no marco 5**, com o Swagger da instância no ar: os caminhos exatos
dos endpoints e o formato do payload de webhook. Os nomes usados neste documento
vêm da versão Node e servem de referência, não de contrato — a Go é projeto
irmão, não a mesma base de código.

Uma instância só, chamada `waterfall`. Multi-instância (um número por atendente)
fica fora de escopo — o desenho não impede, já que `instancia` é coluna.

### 3.3 Migração `sql/010_whatsapp.sql`

```sql
-- Uma conversa por número. É o "fio" que a tela mostra.
create table if not exists public.conversas (
  id             uuid primary key default gen_random_uuid(),
  numero         text not null unique,   -- E.164 sem '+': 5547991868646
  cliente_id     uuid references public.clientes(id) on delete set null,
  nome_whatsapp  text,                   -- nome do perfil, quando vem
  instancia      text default 'waterfall',
  ultima_em      timestamptz,
  ultima_previa  text,                   -- ~80 caracteres, para a lista
  nao_lidas      integer default 0,
  arquivada      boolean default false,
  criado_em      timestamptz not null default now()
);

create table if not exists public.mensagens (
  id             uuid primary key default gen_random_uuid(),
  conversa_id    uuid not null references public.conversas(id) on delete cascade,

  -- Id da mensagem no WhatsApp. O UNIQUE é o que torna o webhook idempotente:
  -- a Evolution reentrega eventos, e sem isto a conversa duplicaria sozinha.
  wa_message_id  text unique,

  direcao        text check (direcao in ('entrada','saida')),
  tipo           text default 'texto'
                 check (tipo in ('texto','imagem','audio','video','documento','outro')),
  texto          text,
  midia_path     text,                    -- bucket privado, como as fotos
  status         text default 'enviada'
                 check (status in ('pendente','enviada','entregue','lida','falhou')),
  erro           text,

  -- Contexto de trabalho: de qual negociação saiu esta mensagem.
  oportunidade_id uuid references public.oportunidades(id) on delete set null,
  enviado_por     text,

  ocorrido_em    timestamptz,             -- carimbo do WhatsApp
  criado_em      timestamptz not null default now()
);

create index if not exists mensagens_conversa_idx on public.mensagens (conversa_id, ocorrido_em);
create index if not exists conversas_cliente_idx  on public.conversas (cliente_id);
```

Mais RLS `acesso_autenticado` nas duas, bucket privado `whatsapp-midia` com as
mesmas quatro políticas de Storage da 007, e `notify pgrst`.

### 3.4 As três Edge Functions (`supabase/functions/`)

Escritas em TypeScript/Deno — é o runtime do Supabase. Isso **não** contraria a
convenção "sem TypeScript": a regra vale para o aplicativo React; a função de
borda é outro programa, e Deno não aceita outra coisa.

**A API real, conferida no Swagger da instância** (`/swagger/doc.json`) — e ela
**não** é a da versão Node:

| O quê | Evolution Go | Versão Node (o que este plano supunha antes) |
|---|---|---|
| Header de autenticação | `apikey` | `apikey` |
| Qual chave | **token da instância** (36 caracteres). A global só serve para `/instance/all` e criar instâncias — nas demais devolve 401 | chave global |
| Enviar texto | `POST /send/text` com `{ number, text }`; a instância vem do token | `POST /message/sendText/{instancia}` |
| Estado | `GET /instance/status` | `GET /instance/connectionState/{instancia}` |
| QR | `GET /instance/qr` | `GET /instance/connect/{instancia}` |
| Webhook | **não tem endpoint próprio**: a URL é definida em `POST /instance/connect` (`webhookUrl` + `subscribe`), uma por instância | `POST /webhook/set/{instancia}` |

Rota descoberta depois, na mesma fonte, para a foto de perfil do contato:
`POST /user/avatar` com `{ number, preview }`. A resposta é um mapa solto
(`gin.H`), e o nome do campo da URL já mudou entre versões — por isso
`_compartilhado/avatar.ts` lê vários nomes possíveis em vez de um só.

| Função | `verify_jwt` | O que faz |
|---|---|---|
| `wa-avatar` | **true** | Confere as fotos de perfil que faltam ou passaram de 7 dias, em fila (uma por vez: a Evolution fala com um único aparelho pareado, e uma rajada de pedidos é como se derruba a instância). Baixa a imagem e guarda no bucket privado — a URL do `pps.whatsapp.net` expira em horas, então guardá-la daria uma foto boa hoje e quebrada amanhã. O caminho leva uma impressão digital do conteúdo, para foto trocada virar URL nova e não ficar presa no cache do navegador. |
| `wa-enviar` | **true** | Recebe `{ conversaId ou clienteId, texto, oportunidadeId }`, normaliza o número, chama `POST /send/text`, grava a mensagem com o id retornado. Erro da Evolution vira mensagem `falhou` com o motivo — nunca some silenciosamente. |
| `wa-webhook` | **false** | Recebe `messages.upsert`, `messages.update` (status de entrega) e `connection.update`. Valida um segredo próprio, faz upsert da conversa, insere a mensagem, casa o número com um cliente, atualiza `nao_lidas`. |
| `wa-status` | **true** | `GET /instance/connectionState/waterfall` e `GET /instance/connect/waterfall` (QR em base64), para a tela de conexão. |

Pontos que costumam morder:

- **O webhook é público.** Com `verify_jwt = false` no `config.toml`, qualquer um
  pode chamá-lo. Ele precisa validar um segredo próprio: um header custom
  (`x-waterfall-token`, que a Evolution v2 permite configurar no webhook) ou, se
  o header não pegar, um segmento aleatório no caminho da URL. Sem isso, qualquer
  pessoa injeta mensagem falsa no seu CRM.
- **Idempotência** pelo `wa_message_id` único — reentrega é normal, não exceção.
- **Sua própria mensagem volta pelo webhook** com `key.fromMe = true`. Tratar
  como `direcao = 'saida'` e deduplicar contra a que o `wa-enviar` já gravou.
- **Sempre responder 200** rápido, mesmo em erro de processamento (logando):
  webhook que devolve 500 entra em fila de retentativa e atrasa o resto.
- Grupos (`@g.us`) e status (`status@broadcast`): ignorar na primeira versão.
- Segredos em `supabase secrets set` — `EVOLUTION_URL`, `EVOLUTION_API_KEY`,
  `EVOLUTION_INSTANCIA`, `WEBHOOK_TOKEN`. O webhook usa a `SERVICE_ROLE_KEY`
  (disponível no ambiente da Edge Function) porque escreve sem usuário logado.

Ferramenta nova no projeto: **Supabase CLI** (`npx supabase functions deploy`).
É a primeira coisa neste repositório que não é "rodar SQL na mão" — vale
registrar no `SISTEMA.md` quando a fase entrar.

### 3.5 Camada de dados: duas exceções conscientes

O padrão do `repository.js` é "carrega tudo uma vez, lê síncrono". Mensagens
quebram esse padrão por dois motivos, e as duas quebras precisam ficar contidas
dentro do repositório:

1. **Volume.** `conversas` são poucas e entram no boot normalmente. `mensagens`
   não: `carregarMensagens(conversaId)` busca sob demanda e guarda por conversa.
   É a mesma lógica da janela de 365 dias das atividades, um passo adiante.
2. **Chegada assíncrona.** Uma mensagem nova entra pelo webhook, não por uma ação
   da tela. Assinatura de Realtime do Supabase na tabela `mensagens`
   (`assinarMensagens(callback)`), que atualiza o cache e avisa a tela aberta.
   Se o Realtime der trabalho, o plano B é *polling* de 15 s enquanto o inbox
   estiver aberto — pior, mas sem infraestrutura nova.

Nada disso justifica um gerenciador de estado; a assinatura fica num `useEffect`
da tela, como o `refresh()` de hoje.

### 3.6 Números de telefone (`src/lib/telefone.js` + teste)

O casamento entre `clientes.telefone` e o número do WhatsApp é a fonte mais
provável de bug silencioso desta fase:

- os clientes estão gravados com máscara (`(47) 99186-8646`);
- o WhatsApp entrega `5547991868646@s.whatsapp.net`;
- celulares brasileiros anteriores a 2016 podem estar cadastrados **sem** o nono
  dígito, e o WhatsApp responde com ele;
- fixo não tem nono dígito nenhum.

Então: `paraE164(telefone)` e `casarComCliente(numero)` tentando as duas formas
(com e sem o 9 depois do DDD). Lógica pura, sem React nem Supabase — vai para
`src/lib/telefone.js` com testes em `scripts/testar-telefone.mjs`, plugado no
`npm test`, na linha da convenção 4.

Quando não casar com ninguém, a conversa fica **sem cliente** e a tela oferece
"vincular a um cliente" ou "cadastrar". Criar cliente automático a partir de
qualquer número que mandar mensagem enche o cadastro de lixo.

### 3.7 Interface da fase 2

O trabalho acontece onde o cliente já está. O inbox é a exceção, não o caminho
principal:

- **ClienteDetalhe** ganha um bloco "WhatsApp" com a conversa e o campo de envio.
  É aqui que a maior parte do uso vai acontecer.
- **Cartão da oportunidade**: botão que abre a conversa com a mensagem vinculada
  à negociação (`oportunidade_id`).
- **Rota `/whatsapp`**: lista de conversas + painel, para quando a mensagem chega
  antes de você saber de quem é. Vai para o "Mais" no mobile e para a sidebar no
  desktop, com contador de não lidas.
- **Modelos de mensagem** em `src/data/mensagens.js` (constante, como as etapas):
  confirmação de visita, aviso de troca de refil, cobrança gentil, agradecimento
  pós-instalação. Variáveis `{{cliente}}`, `{{data}}`, `{{valor}}` preenchidas do
  registro aberto. Tabela editável só se a lista mudar toda semana.
- **Tela de conexão** dentro de `/whatsapp`: estado da instância e QR code para
  parear, vindos do `wa-status`.

### 3.8 Riscos que precisam ser ditos em voz alta

- **A Evolution Go usa a via não oficial do WhatsApp (`whatsmeow`)**, não a API
  oficial da Meta. Trocar Baileys por whatsmeow muda a linguagem e o consumo, não
  o risco: as duas falam o protocolo do WhatsApp Web como se fossem um celular
  pareado. Uso intenso, disparo em massa ou muitas mensagens para quem
  nunca falou com você **podem levar o número ao bloqueio**. Mitigação: número
  dedicado (não o pessoal), volume humano, nada de lista fria, e responder só
  quem escreveu ou já é cliente.
- **LGPD**: conversa de cliente é dado pessoal. Fica no seu Supabase, sob RLS, e
  a VPS precisa de acesso restrito. Não exportar conversa sem necessidade.
- **A VPS é sua para manter**: atualização de imagem, backup do volume, e o
  número desconectando quando o celular pareado fica offline demais.
- **Custo recorrente**: VPS (~R$ 30–50/mês) + domínio. As Edge Functions cabem no
  plano gratuito do Supabase neste volume.

### 3.9 Como verificar a fase 2

1. `curl` no `/instance/connectionState` da VPS responde `open` depois do QR.
2. Mandar mensagem do celular para o número: a linha aparece em `mensagens` com
   `direcao = 'entrada'` em segundos, e a conversa casa com o cliente certo.
3. Reenviar o mesmo webhook duas vezes: **não** duplica — o `unique` do
   `wa_message_id` segurou.
4. Chamar o webhook sem o segredo: recusado.
5. Enviar pelo sistema: chega no celular e a mensagem fica `entregue` quando o
   `messages.update` volta.
6. Procurar `EVOLUTION_API_KEY` no `dist/` depois do build: **zero ocorrências**.
7. `npm test` com os novos testes de telefone.

---

## 4. Fase 3 — automações (fora do escopo, mas o desenho comporta)

Com o inbox de pé, disparos por evento são um passo pequeno, porque os dados já
existem: lembrete na véspera do agendamento, aviso de refil vencendo (a
`proximaTroca` já está calculada), cobrança de parcela atrasada (`lancamentos`
vencidos). Precisaria de um agendador — `pg_cron` no Supabase chamando uma quarta
função. Não entra agora: automação errada em WhatsApp queima o número e irrita
cliente. Melhor calibrar com envio manual primeiro.

---

## 5. Ordem de entrega

| # | Marco | Depende de | Esforço aproximado |
|---|---|---|---|
| 1 | Migração 009 + repositório + store | — | meio dia |
| 2 | Tela `/crm` com quadro, cartão e modal | 1 | 1–2 dias |
| 3 | Ganhar/perder + integração com venda e trilha | 2 | meio dia |
| 4 | Funil no ClienteDetalhe e no Dashboard | 3 | meio dia |
| — | **Fase 1 pronta para produção** | | **~3 dias** |
| 5 | VPS, Docker, TLS, instância pareada | — | meio dia |
| 6 | Migração 010 + `lib/telefone.js` + testes | 5 | meio dia |
| 7 | `wa-webhook` (recebimento e idempotência) | 6 | 1 dia |
| 8 | `wa-enviar` + `wa-status` | 7 | meio dia |
| 9 | Conversa no ClienteDetalhe + Realtime | 8 | 1 dia |
| 10 | Inbox `/whatsapp`, modelos, tela de conexão | 9 | 1–2 dias |
| 11 | Mídia (imagem/áudio) no bucket privado | 10 | meio dia |
| — | **Fase 2 pronta** | | **~5 dias** |

Os marcos 1–4 não dependem de nada externo: dá para começar hoje. A VPS pode ser
provisionada em paralelo.

---

## 6. Variáveis e segredos

| Onde | Chave | Observação |
|---|---|---|
| `.env` do app | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | já existem; **nada novo entra aqui** |
| VPS (`.env` da Evolution Go) | `GLOBAL_API_KEY`, `DATABASE_*` | nunca sai da VPS |
| `supabase secrets` | `EVOLUTION_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCIA`, `WEBHOOK_TOKEN` | só as Edge Functions leem |

A ausência de qualquer segredo novo no `.env` do front é o teste mais simples de
que a arquitetura está certa.

---

## 7. Pontos ainda em aberto

1. ~~**Nome do destino no menu**: "CRM" ou "Funil"?~~ Resolvido: o menu mostra
   **CRM**. No código a tela segue como "funil" (`pages/Funil.jsx`,
   `ETAPAS_FUNIL`, `resumoDoFunil`), mesma separação de "Serviços", cuja rota e
   tabela continuam `agendamentos`.
2. **Oportunidade automática**: toda atividade de cliente novo deveria abrir uma?
   Provavelmente não — sujaria o quadro, igual ao que a 005 evitou com os
   agendamentos. Começar manual e observar.
3. **Quem é o responsável** quando a equipe crescer: hoje `criado_por` basta.
4. **Retenção de mensagens**: guardar conversa para sempre ou arquivar depois de
   um ano? Decidir antes de o volume existir, não depois.
