# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Operadores internos da Waterfall, normalmente uma pessoa ou uma equipe pequena, que alternam entre trabalho de escritório e atendimento em campo. Precisam registrar contatos, localizar clientes, acompanhar serviços, fechar vendas e conferir o caixa com rapidez, inclusive pelo celular e sob interrupções.

## Product Purpose

Centralizar a operação da empresa de purificadores e filtros de água: clientes, equipamentos instalados, catálogo, agenda, serviços, vendas, documentos e financeiro. Sucesso significa que o operador consegue ver o que precisa fazer agora, registrar o desfecho e deixar o próximo passo preparado sem perder rastreabilidade.

## Positioning

O sistema conecta todo o ciclo de cuidado do equipamento — vender, instalar, acompanhar, trocar o refil e receber — mantendo a origem e os desdobramentos de cada ação navegáveis.

## Operating Context

- Uso diário no desktop para cadastro, vendas, documentos e fechamento financeiro.
- Uso móvel em ligações, visitas, instalações e acompanhamento de tarefas.
- Ritual de início do dia guiado por atrasos e compromissos; ritual de fechamento para decidir pendências.
- Ordem de Serviço e Pedido de Venda gerados em DOCX/PDF a partir dos dados operacionais.
- Informações financeiras distinguem vencimento, pagamento, previsto e realizado.

## Capabilities and Constraints

- SPA React 18 e React Router, com Vite e Tailwind CSS.
- Supabase é a única camada de backend; as páginas acessam dados pelo `repository.js`.
- Interface, código e comentários permanecem em português do Brasil.
- O redesign deve preservar rotas, regras de negócio, documentos, autenticação e fluxos existentes.
- Não introduzir TypeScript, novo gerenciador de estado ou framework de testes.
- Gráficos e indicadores só entram quando representam dados operacionais úteis; decoração não substitui conteúdo.

## Brand Commitments

- Nome Waterfall, logo existente e azul da marca permanecem reconhecíveis.
- A referência visual fornecida pelo usuário é vinculante: base escura, alta legibilidade, navegação compacta, cartões de densidade controlada e acentos funcionais em azul, verde, coral e amarelo.
- A direção deve ser adaptada ao produto, sem copiar métricas, gráficos, avatares ou recursos inexistentes na Waterfall.
- O tom continua direto, humano e operacional.

## Evidence on Hand

- Visão funcional e regras de negócio em `SISTEMA.md`.
- Inventário das telas e decisões de interface em `PAGINAS_E_UI.md`.
- Referência visual em `.impeccable/referencia-dashboard.png`.
- Logo e imagens existentes em `src/assets/`.
- Dados exibidos são reais do cache do Supabase; não fabricar clientes, resultados ou indicadores.

## Product Principles

1. O próximo passo deve ficar evidente antes dos indicadores secundários.
2. Registrar uma ação precisa custar menos esforço do que lembrá-la depois.
3. Cada efeito financeiro ou operacional deve explicar sua origem e consequência.
4. Desktop privilegia varredura e eficiência; mobile privilegia alcance, continuidade e recuperação após interrupções.
5. Expressão visual nunca obscurece estado, tarefa ou affordance familiar.

## Accessibility & Inclusion

Buscar WCAG AA para contraste, foco visível e nomes acessíveis. Fluxos principais devem funcionar por teclado, modais devem gerenciar foco e alvos móveis devem ter pelo menos 44 × 44 px.
