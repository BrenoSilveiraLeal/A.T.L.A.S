# Transmitir o Trading Floor ao vivo (YouTube)

O ATLAS tem um **Modo TV** em `http://localhost:3000/tv`: tela cheia, sem botões de controle,
atualiza a cada 20 segundos e mostra o patrimônio da equipe contra o CDI, a TV de notícias e as
estações das IAs em perspectiva. É a mesma ideia da sala do Invista Já.

## Uma vez só

1. Instale o **OBS Studio** (grátis): https://obsproject.com
2. No YouTube Studio, ative a transmissão ao vivo da sua conta (a primeira ativação pode levar
   até 24 horas) e copie a **chave de transmissão**. Não compartilhe essa chave com ninguém.
3. No OBS: *Configurações → Transmissão → Serviço: YouTube* e cole a chave.

## Toda vez que for transmitir

1. Deixe `npm run local` rodando.
2. No OBS, adicione uma fonte **Navegador** com a URL `http://localhost:3000/tv`,
   largura 1920 e altura 1080.
3. Clique em **Iniciar transmissão**.

## Cuidados

- A transmissão mostra nomes das IAs, orçamentos e resultados **simulados**. Não aparece saldo da
  Genial nem dados da conta, mas confira a tela antes de deixar a live pública.
- Deixe a live como **não listada** até ter certeza do que aparece.
- Resultado simulado não é recomendação de investimento; o rodapé do Modo TV já avisa isso.
