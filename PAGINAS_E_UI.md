# Waterfall — Páginas e UI

Complementa o [SISTEMA.md](SISTEMA.md) (arquitetura, dados, regras de negócio).
Este documento cobre **o design da interface** e **o que tem em cada tela**.

---

## 1. Linguagem visual — a galeria branca

A referência é a página de produto da Apple, e ela mora no repositório:
`docs/referencia-apple/` (`DESIGN.md` com os tokens por extenso, mais
`theme.css`, `variables.css` e `tokens.json`). Três regras explicam quase
todas as decisões abaixo.

**1. A galeria é branca.** O canvas é Studio Mist (`#f5f5f7`) e a superfície é
Gallery White (`#ffffff`). Cor não preenche superfície grande: ela aparece em
texto de link, em pílula compacta de ação e em ponto de status. O Pricing Blue
nunca é fundo de bloco — a referência proíbe isso explicitamente.

**2. Não existe sombra.** Separação vem de cor (branco sobre `#f5f5f7`) e de
filete de 1px. A única marca de elevação admitida é `0 0 0 1px` — é o que a
classe `.superficie-flutuante` faz, e é o que todo menu, popover e listbox do
sistema usa. Há uma regra de rede em `index.css` que zera qualquer
`shadow-*` que escape para dentro de `.app-shell`.

**3. A tinta é fria e quase sem croma.** Ink (`#1d1d1f`) no título e no corpo,
Slate (`#707070`) no apoio, Steel (`#86868b`) no contorno e na menor ênfase.

### Tokens

A escala `slate` do Tailwind é **redefinida** em `src/index.css` — não são os
slate de fábrica. A convenção é: **50–300 são superfície e borda; 400–900 são
texto**, do apoio ao principal.

| Token | Claro | Papel na referência |
|---|---|---|
| `slate-50` | `#f5f5f7` | Studio Mist — canvas da página |
| `slate-100` | `#fafafc` | Paper Frost — campo afundado, faixa de aviso |
| `slate-200` | `#e6e6e8` | Control Gray — filete de 1px, divisores |
| `slate-300` | `#d6d6d6` | Hairline Silver — borda de controle |
| `slate-400` | `#86868b` | Steel — menor ênfase, contorno de campo |
| `slate-500` | `#707070` | Slate — texto secundário |
| `slate-900` | `#1d1d1f` | Ink — título e corpo principal |
| `blue-500` | `#0071e3` | Pricing Blue — **só** preenchimento de pílula de ação |
| `blue-600` | `#0066cc` | Apple Blue — link e texto azul |
| `amber-500` | `#b64400` | Launch Orange |
| `emerald-500` / `red-500` / `violet-500` | `#248a3d` / `#d70015` / `#5e5ce6` | paleta de sistema da Apple; a referência não tem estado, um CRM tem |

**Raios.** Os tokens `--radius-*` são sobrescritos no `@theme`, o que reafina
os ~153 usos de `rounded-*` de uma vez: `rounded-2xl` = **28px** (o card da
referência), `rounded-xl` = **12px** (campo de formulário), `rounded-lg` =
**10px** (controle pequeno). Botão é sempre `rounded-full`.

> A referência pede 980px nos campos, mas aquilo é a busca da barra de navegação
> da Apple — um campo isolado. Num formulário de 40 campos a cápsula come o
> espaço útil, então aqui o campo fica em 12px. Mesma lógica para os 90px de
> intervalo entre seções: o ritmo de espaçamento do sistema foi mantido.

**Tipografia.** SF Pro Display/Text nativas onde existem (Mac, iPhone, iPad —
é onde a referência foi medida), **Inter** como substituto, que é o que o
próprio `DESIGN.md` indica. Tracking negativo global (`-0.016em` no corpo,
`-0.022em` nos títulos, `-0.03em` no herói) — é a assinatura da Apple em texto
pequeno. Pesos limitados a **400/500/600**; não há 700 nem 800 no sistema.

**Temas.** O claro é o padrão. O escuro é opt-in pelo botão da TopNav e usa a
variante escura da própria Apple: canvas `#000`, superfície `#1c1c1e`, azul
`#2997ff`. Os nomes dos tokens são os mesmos nos dois, então **nenhuma classe
de página muda entre temas** — quem alterna é `src/lib/tema.js` via
`<html data-theme>`.

**Ícones**: SVG próprios em `components/icons.jsx` (sem biblioteca externa).

## 2. Componentes de UI compartilhados (`components/ui.jsx`)

| Componente | Papel |
|---|---|
| `Page` | espaçamento padrão de página, `max-w-1480px`, reserva espaço para a barra inferior mobile |
| `PageTitle` | título em tipo de display + subtítulo + ação; **omite o `<h2>` quando repetiria o nome já mostrado na topbar** |
| `Card` | a "Feature Media Card": Gallery White, 28px, filete de 1px, **sem sombra** |
| `Button` | sempre pílula. `primary` = Pricing Blue preenchido (a ação de conversão, em geral uma por tela); `secondary` = "Outlined Explore Pill", transparente com filete Steel; `danger`; `ghost`. Alvo de toque de 44px no mobile |
| `Field` / `inputCls` | label + campo; campo **branco com contorno de 1px Steel**, raio 12px, foco em Pricing Blue; fonte 16px no mobile (evita zoom automático do Safari) |
| `Badge` | a "Launch Status Label": **texto colorido puro com um ponto de 6px**, sem preenchimento e sem borda. O ponto é adaptação nossa — numa lista de 2.600 linhas o status é uma coluna que se varre na vertical, e cor de texto sozinha não se acha nessa varredura |
| `Aviso` | a faixa de alerta inline, antes copiada à mão em ~18 lugares com raios e tons divergentes |
| `Segmentos` | o controle de aba/segmento. Antes havia **cinco** desenhos concorrentes; este é o único. Aceita `'mes'`, `['mes','Mês']` ou `{valor,rotulo}` |
| `menuFlutuante` / `itemMenu` | a superfície e o item de qualquer coisa que flutua sobre o conteúdo. Antes eram duas receitas concorrentes para o mesmo trabalho |
| `Modal` | vira **bottom sheet** no mobile (nasce colado embaixo, cabeçalho sticky); no desktop é painel branco de 28px centrado; usa `dvh` para não ficar atrás do teclado no iOS; só fecha por X/Esc por padrão (evita perder formulários grandes por toque acidental) |
| `Empty` | mensagem central discreta para listas vazias |

O outro subsistema de token do projeto é `components/evento.jsx` (`PALETAS`,
seis papéis por matiz), que veste a agenda inteira. Nele a cor também saiu do
fundo e foi para o traço: a superfície do evento é neutra, e o tipo aparece no
ponto, no glifo e na etiqueta.

## 3. Navegação

Definida uma vez em `components/navegacao.js` e consumida por `Sidebar` (desktop)
e `TopNav`/`BottomNav` (mobile) — uma única fonte de verdade.

- **Desktop (`≥lg`)**: sidebar branca fixa à esquerda, 248px expandida / 80px
  colapsada (só ícones, estado persistido em `localStorage`). O item ativo é uma
  **pílula neutra**, não uma tinta: a referência marca "onde eu estou" por
  superfície e peso. Rodapé com "Sair" e o botão de colapsar.
- **Topbar**: 64px nos dois tamanhos, no espírito da "Product Local Navigation" —
  nome da tela em 19px/600, controles despojados, filete de 1px em vez de sombra.
  Duas telas calculam altura a partir dela (`WhatsApp.jsx`, `Funil.jsx`); mexer
  nesses 64px exige mexer lá também.
- **Mobile (`<lg`)**: `BottomNav` fixa, 5 destinos com ícone+rótulo mais um
  botão "Mais" que abre uma folha com os destinos restantes e "Sair". A escolha
  dos 5 segue a frequência de uso em campo (Dashboard, Agenda, Clientes,
  Serviços, Financeiro) — Produtos e Vendas são tarefas de escritório.
- 8 destinos ao todo: **Dashboard, Agenda, Clientes, Produtos, Serviços
  (`/agendamentos`), CRM, WhatsApp, Vendas, Financeiro**. "Serviços" é o nome de
  tela de "Agendamentos" (rota e tabela mantêm o nome antigo) — separado
  deliberadamente de "Agenda", que é o diário de trabalho.

## 4. Padrões responsivos recorrentes

- Painéis de filtro ("Filtrar por") em Clientes/Agendamentos: abrem/fecham,
  fecham ao clicar fora.
- Tabelas com muitas ações por linha viram, no mobile, só "Ver" + um "⋯" que
  expande o resto em pilha com alvos de 44px (Agendamentos).
- Modal "wide" (`max-w-3xl`) para telas de detalhe mais densas (venda,
  fechamento do dia); `md` (`max-w-lg`) para formulários/confirmações comuns.

---

## 5. As páginas

### Login (`/login` implícito, rota fora do layout)
Duas colunas: formulário em Gallery White à esquerda, foto (`login-bg.jpg`) à direita **sem véu escuro** — a legenda sobre ela é uma cápsula branca de 28px, no formato da "Floating Pricing Callout". Formulário de usuário/senha
(usuário, não e-mail — ver `lib/auth.js`) com opção de mostrar/ocultar senha. Ao
autenticar, o listener global em `App.jsx` percebe a sessão e libera a navegação.

### Dashboard (`/`)
Painel do dia. Contém:
- **Herói** de saudação no formato "Hero Product Stage" da referência: palco
  branco, sem caixa e sem imagem por baixo do texto — data como kicker, a
  saudação em tipo de display (uma de várias frases sorteada por sessão, com o
  primeiro nome de quem logou) e o resumo no corpo de 17px. O wallpaper com véu
  escuro que existia aqui saiu com o redesign, e com ele o módulo de wallpapers,
  os assets e o script `npm run wallpapers` que os gerava.
- **Resumo financeiro do mês** — tudo derivado da tabela única de lançamentos
  ("Vendido no mês" conta pela data de **vencimento**, não pela criação do registro).
- **O dia**: pendências atrasadas primeiro (é a pergunta que o dashboard precisa
  responder de cara: "o que eu faço hoje?"), depois os próximos.
- Cards: **Registrar agora** (`CapturaRapida` — atalho para lançar
  ligação/tarefa/nota sem abrir a Agenda), **Calendário** (`MiniCalendario`),
  **Próximas visitas**, **Trocas de refil previstas**, **A receber por forma
  de pagamento**.

### Agenda (`/agenda`)
A tela mais complexa do sistema. É o **diário de trabalho + calendário
unificado** — mistura `atividades` (contatos/tarefas) e `agendamentos`
(serviços em campo) na mesma visão.
- Visão por **mês** (grade) ou por **dia**, alternável; no mobile o padrão é
  "Dia" (a grade de mês mal cabe ~46px por dia no celular).
- Desenho **sem grade de linhas** (`components/calendario.jsx`): o mês é só
  número + pontos coloridos por fonte, o dia escolhido vira pílula sólida. A
  moldura só aparece onde carrega informação — no cartão do evento, tingido
  pela cor do tipo.
- A visão "Dia" tem **faixa da semana** (sete dias na largura do polegar) e
  **linha do tempo** com calha de horas; o que não tem hora marcada fica numa
  tira acima, e as horas desenhadas vão só do primeiro ao último compromisso.
- **Atrasados** aparecem no topo do dia de hoje, limitados a 5 com "ver os
  outros N" — aviso, não lista de trabalho.
- A tela **assina o repositório** (`assinarDados`) e rebusca as tabelas ao
  abrir e ao voltar do segundo plano (`recarregarTabelas`): concluir um serviço
  em outra tela (ou em outro aparelho) tem que sumir daqui sem F5.
- Navegação por seta ou **swipe horizontal** no card do dia (arrastar troca de
  dia, como um app de agenda de verdade).
- Filtros: por fonte (atividade/agendamento) e "só as minhas" (aplica-se só a
  atividades — serviços em campo não têm dono no modelo atual). No mobile,
  filtro e escolha de data viram bottom sheets.
- **Relatório do dia**: não é digitado, é derivado do que já foi registrado
  (`resumoDoDia`) — só funciona porque registrar uma atividade é barato.
- **"Fechar o dia"**: um ritual de fim de expediente — modal "wide" que força
  decisão sobre tudo que ficou pendente no dia, para nada ficar solto.
- Concluir uma **tarefa** é um clique; concluir um **contato** abre o registro
  do desfecho (resultado + descrição), porque é aí que nasce o próximo passo.
- Clicar num **serviço** abre o pop-up de detalhes, que tem **Reagendar**: o dia
  original fica marcado como reagendado (âmbar, sem risco) e o serviço novo
  nasce na data escolhida; a agenda pula para lá. Os dois lados aparecem no
  pop-up ("veio do dia X" / "foi para o dia Y") com o motivo, se houver.

### Clientes (`/clientes`)
Lista + cadastro. Busca, filtro por cidade/UF (dinâmico, com deduplicação de
cadastros antigos digitados de formas diferentes). Modal de "Novo cliente" com
os campos de `ClienteFormFields` (endereço com busca de CEP). Ao criar, grava
quem cadastrou; ao editar, não mexe na autoria original.

### Cliente Detalhe (`/clientes/:id`)
Página 360°, a mais rica em conteúdo do cliente individual:
- **Dados do cliente** (editável em modal) + foto de perfil.
- **Próximo passo**: a próxima coisa marcada para esse cliente, seja contato ou
  serviço, calculada a partir do histórico inteiro.
- **Produtos e vendas**: histórico de vendas do cliente, com atalho para gerar
  o **Pedido** (.docx) e excluir venda.
- **Contas a receber** desse cliente (venham de venda ou de agendamento avulso).
- **Linha do tempo**: todos os eventos do cliente intercalados
  (`linhaDoTempoDoCliente`), com `TrilhaOrigem` mostrando de onde cada coisa veio.
- Cadastro rápido de "venda de produto já entregue": não gera visita de
  instalação — cria o equipamento na hora e já programa a troca de refil a
  partir da data de instalação informada.

### Produtos (`/produtos`)
Catálogo dividido em **aparelhos** e **refis**. Cada produto tem nome, código,
valor, foto e, quando aplicável, intervalo de troca em meses. O vínculo
refil↔aparelho pode ser escolhido a partir de qualquer um dos dois lados do
formulário (mora fisicamente no refil).

### Agendamentos / "Serviços" (`/agendamentos`)
Serviços em campo: visitas, instalações, trocas de refil. Lista com filtro,
modal de criação/edição vinculando cliente e um ou mais produtos (o valor é
recalculado somando a tabela de preços, mas continua editável manualmente
depois). Cada linha permite gerar a **Ordem de Serviço** (.docx),
concluir/cancelar e excluir. No mobile, ações comprimidas em "Ver" + menu "⋯".

### Vendas (`/vendas`)
Pedidos e orçamentos. Lista com detalhe em modal "wide" mostrando itens,
totais, condição de pagamento. Formulário com busca de cliente/produto,
cálculo de totais recalculado a cada tecla digitada (o rodapé sempre mostra o
que será de fato gravado). Gera o **Pedido de Venda** (.docx) a partir daqui
também.

### Financeiro (`/financeiro`)
O caixa do sistema.
- **Relatório do mês** com comparação ao mês anterior (variação percentual —
  mostra "—" em vez de inventar "+100%" quando não há base de comparação).
- **Fluxo de caixa dos próximos 6 meses**, mês a mês.
- Lista de lançamentos com dar baixa, estornar e remover (lançamento manual
  some de vez; um vinculado a venda/agendamento apenas desliga a origem —
  `removerDoFinanceiro` cuida das duas pontas). Dar baixa sem informar data de
  pagamento assume a data de vencimento.

---

## 6. Onde olhar para mexer no visual

- A referência do desenho → `docs/referencia-apple/DESIGN.md`
- Cores/tokens/raios/temas → `src/index.css` (bloco `@theme` + os dois blocos de tema)
- Componentes reaproveitáveis → `src/components/ui.jsx`
- Navegação/rótulos de tela → `src/components/navegacao.js`
- Layout de shell (sidebar/topbar/bottom nav) → `App.jsx`, `Sidebar.jsx`, `TopNav.jsx`
