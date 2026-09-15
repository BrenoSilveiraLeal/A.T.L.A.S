---
name: ATLAS
description: Centro de operações financeiro institucional com estados verificáveis.
colors:
  background: "#101214"
  sidebar: "#121517"
  panel: "#181c1f"
  panel-raised: "#20262a"
  line: "#30373b"
  text: "#edf1ee"
  muted: "#a1ada8"
  primary: "#a3cdb5"
  primary-ink: "#16291e"
  warning: "#e3c28d"
  danger: "#eea29b"
typography:
  headline:
    fontFamily: '"Manrope Variable", sans-serif'
    fontSize: "30px"
    fontWeight: 620
    lineHeight: 1.25
    letterSpacing: "-0.035em"
  title:
    fontFamily: '"Manrope Variable", sans-serif'
    fontSize: "16px"
    fontWeight: 660
    letterSpacing: "-0.015em"
  body:
    fontFamily: '"Manrope Variable", sans-serif'
    fontSize: "13px"
    lineHeight: 1.85
  label:
    fontFamily: '"Manrope Variable", sans-serif'
    fontSize: "12px"
  metric:
    fontFamily: '"Manrope Variable", sans-serif'
    fontSize: "33px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "-0.04em"
rounded:
  input: "6px"
  control: "7px"
  station: "8px"
  panel: "12px"
spacing:
  control-gap: "8px"
  mobile-gutter: "18px"
  panel-padding: "23px"
  section-gap: "24px"
  desktop-gutter: "38px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-ink}"
    rounded: "{rounded.control}"
    padding: "10px 17px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "10px 17px"
  button-stop:
    backgroundColor: "transparent"
    textColor: "{colors.danger}"
    rounded: "4px"
    padding: "5px 10px"
  input:
    backgroundColor: "#121718"
    textColor: "{colors.text}"
    rounded: "{rounded.input}"
    padding: "12px"
  navigation-item:
    textColor: "#b1bcb7"
    rounded: "{rounded.control}"
    padding: "11px 13px"
  status-label:
    backgroundColor: "#2b3235"
    textColor: "#c5cfcc"
    rounded: "3px"
    padding: "4px 7px"
  panel:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.panel}"
    padding: "{spacing.panel-padding}"
---

# Design System: ATLAS

## Overview

**Creative North Star: "Centro de operações institucional"**

Direção já definida no pedido do proprietário: financeiro, futurista, escuro e elegante, sem estética de cassino nem excesso de neon. A interface usa grafite, superfícies discretas, Manrope local e ícones lineares. A identidade aparece na precisão das relações entre rótulo, valor, origem e estado.

Este documento registra a implementação atual em `src/app/globals.css`, `src/components/shell.tsx`, `src/components/screen.tsx` e `src/components/candle-chart.tsx`. As capturas de confirmação estão em `.impeccable/review/desktop.png` e `.impeccable/review/mobile.png`. O escritório atual é uma grade de agentes persistidos com iniciais e estados; personagens animados e deslocamento espacial não estão implementados.

**Key Characteristics:**

- Grafite com verde suave, âmbar e vermelho sem efeitos luminosos.
- Valores tabulares, separadores finos e contexto junto do dado.
- Ausência de informação expressa por estado vazio e próxima ação.
- Navegação lateral persistente no desktop e recolhível no celular.

## Colors

O verde suave sustenta ações e identidade, enquanto os tons neutros organizam a informação. Verde em uma superfície não certifica prontidão operacional; texto e evidência precisam indicar o estado.

### Primary

- **Verde suave:** ação principal, links, foco e elementos de identidade.
- **Tinta verde escura:** texto sobre a ação principal.

### Secondary

- **Âmbar:** configuração, pendência e avisos.
- **Vermelho suave:** bloqueios, erro e ação de parada.

### Neutral

- **Grafite de fundo e navegação:** estrutura persistente.
- **Painel e painel elevado:** agrupamento e interação.
- **Linha:** divisórias e contornos discretos.
- **Texto claro e texto secundário:** hierarquia de leitura.

## Typography

Manrope Variable é carregada localmente, com fallback sans-serif. Títulos usam pesos intermediários e espaçamento compacto; explicações têm entrelinha ampla e limite de largura de 72 caracteres.

A hierarquia base está nos tokens acima. O título principal passa a 26px no celular e 34px a partir de 1600px; métricas passam a 30px no celular. Tabelas e métricas usam `tabular-nums`. Metadados e estados usam tamanhos menores que o corpo; não devem carregar sozinhos instruções essenciais.

## Layout

O desktop tem navegação fixa de 236px, cabeçalho, faixa de segurança e conteúdo de até 1700px. A visão geral combina quatro métricas e uma grade de duas colunas; tabelas mantêm rolagem própria. Os valores aqui descrevem o código atual, não novos tokens globais.

Abaixo de 1150px a navegação passa a 205px. Até 900px, painéis formam uma coluna e métricas duas. Até 700px a navegação sai da área de conteúdo, usa 245px quando aberta e fica com `visibility: hidden` quando fechada. A navegação tem rolagem vertical própria. O conteúdo usa margens laterais de 18px no celular.

## Elevation & Depth

Painéis em repouso usam mudança de tom e bordas finas, sem sombra. Apenas a navegação aberta no celular recebe sombra de sobreposição (`12px 8px 40px #0008`). Profundidade não serve para sugerir ganhos, atividade ou estados que o backend não confirmou.

## Shapes

Painéis têm cantos suaves; controles são mais compactos. Estações de agentes usam borda de 1px, inclusive a borda inferior. A marca atual é um A geométrico tipográfico com base horizontal. Avatares são iniciais em superfícies quadradas arredondadas, sem imagens de pessoas inventadas.

## Components

### Ações e campos

Botão principal verde, secundário transparente com contorno e parada vermelha com rótulo explícito. Botões indisponíveis têm opacidade reduzida e estado `disabled`. Campos usam fundo escuro, borda legível e rótulo associado. Foco visível usa contorno de 2px e afastamento de 4px.

### Navegação

Item selecionado combina superfície verde escura, texto claro, indicador pequeno e `aria-current`. No celular, o botão informa `aria-expanded`; selecionar uma rota, acionar fechar ou pressionar Escape recolhe a navegação. Há link para pular ao conteúdo.

### Estados, prontidão e segurança

Os rótulos têm texto explícito e variações neutra, âmbar, vermelha ou verde. A faixa atual informa “Execução bloqueada” e que a operação real aguarda integração e validação. As métricas contábeis informam “Aguardando reconciliação” quando não há snapshot válido; registros conciliados exibem a data de origem. A ação de parada fica desabilitada sem configuração e não representa liquidação de posições.

### Agentes e informação financeira

Agentes são criados a partir de registros persistidos e exibem nome, ativo, limite e estado. Sem snapshot conciliado, saldo e patrimônio mostram ausência de dados; zero não substitui falta de confirmação. Os totais da visão geral e da tesouraria usam o snapshot contábil em strings decimais e deixam explícito que são registros históricos. O gráfico patrimonial continua pendente.

O gráfico de mercado usa candles diários reais, volume e seleção de 20, 60 ou 100 pregões, acompanhados de descrição e tabela acessível. Não há histórico patrimonial, marcadores de ordens ou rentabilidade fictícios.

A consulta de fundamentos exige código CVM, exercício e escopo. A tabela preserva valor normalizado, rubrica/unidade original, versão e referência. Campos ausentes ficam indisponíveis. A data de recepção é apresentada separadamente da coleta e não é descrita como data de publicação comprovada. A seção de rastreabilidade pode ser expandida sem interromper a consulta.

### Movimento e feedback

Transições curtas afetam cores de botão (180ms), navegação e fundo das estações (200ms). `prefers-reduced-motion` remove animações e transições. Feedback de requisição usa região de status. Não há animação de personagens simulando trabalho.

## Do's and Don'ts

### Do

- **Do** exibir fonte, atraso e ausência de informação junto ao dado relevante.
- **Do** preservar rótulos textuais para bloqueios, pendências e ações de segurança.
- **Do** manter a navegação fechada do celular invisível também para foco sequencial.
- **Do** atualizar avatares e estados a partir de registros reais.

### Don'ts

- **Don't** preencher falta de saldo com zero ou apresentar capital como protegido sem confirmação.
- **Don't** criar gráficos, ganhos, agentes ou atividade fictícios para preencher a composição.
- **Don't** transformar verde, brilho ou movimento em prova de prontidão operacional.
- **Don't** adicionar estética de cassino ou excesso de neon.
