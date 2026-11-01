# Redesenho visual do Escritório de Dividendos — mapeamento

Atualizado em 01/11/2026. **Só visual e navegação.** Nenhum componente de tela, cálculo, endpoint, tabela, permissão, limite, integração ou execução foi alterado. Os números (#) são do inventário de 209 itens feito antes do redesenho, cobrindo `/app/**`, `/tv` e o Shell.

## O que mudou

| Mudança | Arquivos | Efeito |
| --- | --- | --- |
| Barra lateral substituída por **barra superior de vidro** (andar 8 · Escritório de Dividendos, "Trocar de escritório", abas Escritório/Carteira/Histórico/Ajustes, menu **Mais**, sino, conta, logout) | `src/components/shell.tsx`, `src/app/dividendos.css` | Mesmas ações (logout, kill, sino), mesmas rotas. O menu **Mais** dá acesso a todas as páginas técnicas, inclusive as que antes não tinham link |
| **Tema** azul-marinho/vidro com o verde ATLAS em todas as telas `/app/**` (tokens `--bg`, `--panel`, `--line`, `--text`, `--green`… e cantos) | `src/app/dividendos.css` (importado em `src/app/layout.tsx`) | Só cores e cantos; os componentes são os mesmos |
| **Transição do mapa para o interior**: ao entrar pelo prédio, a câmera do 3D começa fora da torre e voa até o andar (2,4 s; desligada com movimento reduzido) | `src/components/building/building-view.tsx`, `src/components/office-3d.tsx` (só câmera) | A cena, as pessoas, as salas e os dados do escritório não mudaram |
| 3D do escritório maior (até 82% da altura da tela) e com borda no estilo do prédio | `src/app/dividendos.css` | — |

## Mapeamento item atual → novo lugar

"Funciona?" = a ação ou o dado continua disponível e chama o mesmo endpoint de antes.

| Itens do inventário | O que são | Onde ficam agora | Funciona? | Exceção / pendência |
| --- | --- | --- | --- | --- |
| #1–#2 | Exigência de proprietário, redirecionamento para /login, tela de erro "Tentar novamente" | Iguais (layout e `error.tsx` não mudaram) | Sim | — |
| #3 | Link "Ir para o conteúdo" | Igual, no topo (aparece com o teclado) | Sim | — |
| #4, #9 | Botões abrir/fechar a navegação lateral no celular | **Substituídos**: as abas rolam na horizontal e o menu **Mais** abre em painel; Esc fecha o menu | Sim | A sidebar deixou de existir; nenhum item ficou sem acesso |
| #5 | Marca ATLAS → /app | Selo "8 · Escritório de Dividendos · Sede ATLAS" → /app, na barra superior | Sim | — |
| #6 | Menu Prédio / Escritório / Carteira / Histórico / Ajustes | "Prédio" virou o botão **Trocar de escritório** (→ /predio?andar=8); os outros quatro são as **abas** | Sim | — |
| #7 | Avatar "P · Proprietário · Conta privada · Brasil" | Bloco da conta, à direita da barra (texto completo também no tooltip) | Sim | No celular o texto some e fica só o "P" |
| #8 | Sair da conta | Botão dentro do bloco da conta | Sim (POST /api/auth) | — |
| #10 | Breadcrumb "Workspace / {tela}" | A aba ativa fica destacada; em página técnica o botão **Mais** mostra o nome da página | Sim | O texto "Workspace /" não aparece mais |
| #11–#14 | Sino de avisos, marcar como lidos, painel, toast com bipe | Iguais, na barra superior | Sim (GET/POST notifications) | — |
| #15–#17 | Faixa de segurança e **Parar todas as operações**, mensagem da parada/logout | Faixa logo abaixo da barra, sempre visível em todas as telas | Sim (POST kill) | — |
| #18 | Aviso de modo desenvolvimento | Igual, abaixo da faixa | Sim | — |
| #19 | Rodapé | Igual | Sim | — |
| #20–#22 | Título "Escritório", **Modo TV**, aviso de sem conexão | Iguais, na aba Escritório. Modo TV também em **Mais → Equipe** | Sim | — |
| #23–#27 | Carga do andar, estados (carregando, erro, vazio), `?ia=Nome` | Iguais | Sim | — |
| #28–#31 | Placar (Livre na Genial, Resultado real, CDI, Agora) | Iguais, acima do 3D, com o tema novo | Sim | — |
| #32–#49 | 3D: cena, etiquetas, monitores, conselhos, Chefe, reuniões, mercado, TV, Assistente, cenário, balões, Trocar de escritório, modo Chefe, Centralizar, Som, legenda | Iguais, no 3D maior. Entrar pelo mapa agora tem a transição de fora para dentro | Sim | — |
| #50–#51 | Plano B 2D e legenda de cores | Iguais | Sim | — |
| #52–#62 | Cartão da IA (saúde, conselho, fatos, faixa de 6 meses, previsão, gráfico, histórico real, notícia, Ficha completa, Ver equipe) | Iguais | Sim | — |
| #63–#67 | Faixa de manchetes, "O que cada IA está fazendo", seleção | Iguais, abaixo do 3D | Sim | — |
| #68–#70 | Assistente do Chefe (tabela de ações boas) | Igual, no fim da aba Escritório | Sim (GET scout) | — |
| #71–#74 | Modo TV (/tv) | Igual (sem a barra, como antes). Acesso: botão Modo TV e **Mais → Equipe → Modo TV** | Sim | O rodapé da TV ainda fala em "simulação" (inconsistência anterior, ver abaixo) |
| #75–#84 | Carteira: Dinheiro na Genial, métricas, saldo do MT5, **Depositei mais**, ações de cada IA | Aba **Carteira**, iguais | Sim (GET live/broker-live, POST live deposit) | — |
| #85–#90 | Histórico: decisões, ordens na Genial, histórico de cobranças | Aba **Histórico**, iguais | Sim (GET paper/live/costs) | — |
| #91–#103 | Ajustes: dinheiro real, chaves, teto, dinheiro por IA (**Salvar**), **Ligar/Desligar dinheiro real** com confirmação, posições e ordens reais | Aba **Ajustes**, iguais | Sim (GET/POST live) | — |
| #104–#105 | Ponte com a Genial, **Enviar aviso de teste** | Aba **Ajustes**, iguais | Sim | — |
| #106 | "Páginas técnicas" (6 links) | Mantido na aba Ajustes **e** todas no menu **Mais** | Sim | — |
| #107–#113 | Comum às páginas técnicas: 404, título, ↻ Atualizar, banner sem conexão, faixas de resultado, estados, selos | Iguais | Sim | — |
| #114–#116 | /app/office (sala e "Sala de reunião · Supervisor central") | **Mais → Equipe → Sala e reuniões** | Sim (GET meetings) | Antes não havia link |
| #117–#128 | /app/agents: criar agente, formulário, lista, estratégias de observação, configuração do agente | **Mais → Equipe → Agentes** | Sim (POST agents/strategies/agent-config) | Antes só se chegava pela ficha do agente |
| #129–#145 | /app/portfolio: Conta Genial ao vivo, posições, ordens abertas, cotações MT5, teto, saque (**Salvar teto**, **Preparar saque**, estados), patrimônio, registros | **Mais → Dinheiro → Conta e patrimônio** | Sim (GET broker-live/controls/portfolio-history, POST controls) | Antes não havia link |
| #146–#154 | /app/market: cotação, gráfico, **Cadastrar ativo**, fundamentos CVM | **Mais → Mercado → Mercado e ativos** (e o link "Cadastrar um ativo primeiro" continua) | Sim | — |
| #155–#157 | /app/news: IBGE, contexto macro | **Mais → Mercado → Notícias** (e Ajustes → Páginas técnicas) | Sim | — |
| #158–#159 | /app/orders: livro de ordens | **Mais → Dinheiro → Livro de ordens** | Sim (GET orders) | Antes não havia link |
| #160–#165 | /app/treasury: contabilidade, movimentações, capital | **Mais → Dinheiro → Tesouraria** (e Ajustes → Páginas técnicas) | Sim | — |
| #166–#170 | /app/risk: novo perfil (17 limites), perfis, prontidão, política | **Mais → Sistema → Risco e limites** | Sim (POST risk) | — |
| #171–#172 | /app/audit | **Mais → Sistema → Auditoria** | Sim | — |
| #173–#176 | /app/settings: prontidão, conexões necessárias, o que falta para o dinheiro real | **Mais → Sistema → Configuração** | Sim | — |
| #177–#180 | /app/health | **Mais → Sistema → Saúde do sistema** | Sim | — |
| #181–#182 | /app/research | **Mais → Mercado → Pesquisa** | Sim | Antes não havia link; a página continua só com texto |
| #183–#194 | /app/paper: criar simulação, piloto automático, propostas (Aprovar/Recusar), ordens (Verificar/Cancelar), IR estimado, livro, Pausar/Retomar | **Mais → Dinheiro → Simulação** | Sim (POST paper) | Antes não havia link; continua marcado como SIMULAÇÃO |
| #195–#209 | Ficha do agente: resumo, Pausar/Ativar análise, controles (piloto, Comprar agora, Vender tudo, Cancelar), contexto, notícias, níveis, gráfico, histórico, configuração | Iguais, em /app/agents/[id] (pelo cartão "Ficha completa" ou pela lista em Agentes) | Sim | — |

**Resultado:** os 209 itens foram encontrados no novo layout. Nenhum foi removido. Seis páginas que antes só abriam digitando o endereço (#114–#128, #129–#145, #158–#159, #181–#194) agora têm link no menu **Mais**.

## Dúvidas e inconsistências encontradas (não alteradas)

Ficaram como estavam, porque mexer nelas mudaria comportamento ou texto de regras. Precisam de decisão do proprietário:

1. Seção "overview" em `screen.tsx` sem rota (parece código morto).
2. `/app/office` repete o 3D de `/app`; qual é a oficial?
3. Componentes exportados e nunca usados: ContributionPanel (aporte mensal), FleetAutopilot, NewsTv, Telao, Gestora. Os endpoints de contribution ficam sem tela.
4. O ↻ de settings e research não atualiza nada.
5. Endpoints POST orders/withdraw/deposit (sempre 409) não são chamados.
6. Placar sem live fala em "carteira virtual"; rodapé do /tv fala em "simulação"; "CDI no período" usa o caixa da simulação.
7. Textos falam em "vender perto da máxima", mas a regra atual segura para dividendos (SELLS_NEAR_HIGH=false).
8. /app/orders lê a tabela `orders`, não as ordens reais da Genial.
9. Duas listas de prontidão diferentes (Readiness fixa × RealMoneyChecklist com dados).
10. Os controles da ficha do agente operam a simulação, enquanto o resto mostra dinheiro real.
11. O e-mail dos avisos está fixo no texto.
12. Intervalo de atualização das notícias: o texto diz 2 ou 5 min, o código usa 30 s.
