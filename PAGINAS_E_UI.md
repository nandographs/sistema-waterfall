# Waterfall — Páginas e UI

Complementa o [SISTEMA.md](SISTEMA.md) (arquitetura, dados, regras de negócio).
Este documento cobre **o design da interface** e **o que tem em cada tela**.

---

## 1. Linguagem visual

- **Estilo flat**: bordas sutis (`border-slate-200`), sem sombras pesadas, sem
  gradientes, sem animações. Cards brancos (`bg-white rounded-xl border`) sobre
  fundo `slate-50`.
- **Paleta**: a escala `slate` do Tailwind foi *redefinida* em `src/index.css`
  com os valores de um template de referência ("library-dashboard") — não são
  os slate padrão do Tailwind:
  - `slate-900` (`#0a1b39`, navy frio) = texto principal
  - `slate-500` (`#858585`) = texto de apoio
  - `slate-200` (`#ededed`) = bordas
  - `slate-50` (`#f8f8f8`) = fundo de página / campos de formulário
  - **Azul da marca** `#009ace` substitui o azul padrão do template — é a cor
    de ação (`blue-600`) em todo o sistema, porque a logo Waterfall é azul.
  - **Coral** `#ff5150` substitui o vermelho — usado para vencido/atrasado/excluir.
  - `accent-suave` (`#edf3fc`, azul bem claro) = destaque suave, item ativo da sidebar.
- **Fonte**: Inter.
- **Ícones**: SVG próprios em `components/icons.jsx` (sem biblioteca externa).

## 2. Componentes de UI compartilhados (`components/ui.jsx`)

| Componente | Papel |
|---|---|
| `Page` | espaçamento padrão de página, `max-w-1600px`, reserva espaço para a barra inferior mobile |
| `PageTitle` | título + subtítulo + ação; **omite o `<h2>` quando repetiria o nome já mostrado na topbar** |
| `Card` | container branco com título/ação opcional no cabeçalho |
| `Button` | variantes `primary` (azul), `secondary` (contorno), `danger` (coral), `ghost`, `hero` (sobre fundo escuro); alvo de toque de 44px no mobile |
| `Field` / `inputCls` | label + campo; campo **sem borda visível**, preenchido em `slate-50`, foca em branco com anel azul; fonte 16px no mobile (evita zoom automático do Safari) |
| `Badge` | pílula colorida (`slate`, `green`, `amber`, `red`, `sky`) para status |
| `Modal` | vira **bottom sheet** no mobile (nasce colado embaixo, cabeçalho sticky); no desktop é modal centrado; usa `dvh` para não ficar atrás do teclado no iOS; só fecha por X/Esc por padrão (evita perder formulários grandes por toque acidental) |
| `Empty` | mensagem central discreta para listas vazias |

## 3. Navegação

Definida uma vez em `components/navegacao.js` e consumida por `Sidebar` (desktop)
e `TopNav`/`BottomNav` (mobile) — uma única fonte de verdade.

- **Desktop (`≥lg`)**: sidebar fixa à esquerda, 290px expandida / 80px colapsada
  (só ícones, estado persistido em `localStorage`), com item ativo em fundo
  `accent-suave`. Rodapé da sidebar mostra o usuário logado, atalho "Mudar
  wallpaper" (só no dashboard), "Sair" e o botão de colapsar.
- **Mobile (`<lg`)**: `TopNav` (barra superior sticky só com o título da tela) +
  `BottomNav` (barra inferior fixa, 5 destinos com ícone+rótulo, mais um botão
  "Mais" que abre uma folha com os 2 destinos restantes e "Sair"). A escolha
  dos 5 itens da barra segue a frequência de uso em campo (Dashboard, Agenda,
  Clientes, Serviços, Financeiro) — Produtos e Vendas são tarefas de escritório
  e ficam em "Mais".
- 7 destinos ao todo: **Dashboard, Agenda, Clientes, Produtos, Serviços
  (`/agendamentos`), Vendas, Financeiro**. "Serviços" é o nome de tela de
  "Agendamentos" (rota e tabela mantêm o nome antigo) — separado
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
Tela cheia com imagem de fundo (`login-bg.jpg`) e logo. Formulário de usuário/senha
(usuário, não e-mail — ver `lib/auth.js`) com opção de mostrar/ocultar senha. Ao
autenticar, o listener global em `App.jsx` percebe a sessão e libera a navegação.

### Dashboard (`/`)
Painel do dia, com wallpaper de fundo escolhível (`WallpaperPicker`). Contém:
- **Hero** de saudação (uma de várias frases sorteada por sessão, com o
  primeiro nome de quem logou).
- **Resumo financeiro do mês** — tudo derivado da tabela única de lançamentos
  ("Vendido no mês" conta pela data de **vencimento**, não pela criação do registro).
- **O dia**: pendências atrasadas primeiro (é a pergunta que o dashboard precisa
  responder de cara: "o que eu faço hoje?"), depois os próximos.
- Cards: **Registrar agora** (`CapturaRapida` — atalho para lançar
  ligação/tarefa/nota sem abrir a Agenda), **Calendário** (`MiniCalendario`),
  **Próximas visitas**, **Trocas de refil previstas**, **A receber por forma
  de pagamento**.

### Agenda (`/agenda`)
A tela mais complexa do sistema (824 linhas). É o **diário de trabalho +
calendário unificado** — mistura `atividades` (contatos/tarefas) e
`agendamentos` (serviços em campo) na mesma visão.
- Visão por **mês** (grade) ou por **dia**, alternável; no mobile o padrão é
  "Dia" (a grade de mês mal cabe ~46px por dia no celular).
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

- Cores/tokens → `src/index.css` (bloco `@theme`)
- Componentes reaproveitáveis → `src/components/ui.jsx`
- Navegação/rótulos de tela → `src/components/navegacao.js`
- Layout de shell (sidebar/topbar/bottom nav) → `App.jsx`, `Sidebar.jsx`, `TopNav.jsx`
