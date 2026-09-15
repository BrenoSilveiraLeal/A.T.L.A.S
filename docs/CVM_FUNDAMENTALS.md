# Fundamentos anuais CVM: implementação e evidências

Verificação em **15/09/2026**. Status: **DFP anual implementado e verificado localmente com arquivo público real**. ITR trimestral, séries históricas de revisões conhecidas em cada instante, mapeamento CVM ↔ ticker e integração dos fundamentos à decisão dos agentes continuam **PENDING**.

## Fonte oficial e contrato

O [catálogo DFP da CVM](https://dados.cvm.gov.br/dataset/cia_aberta-doc-dfp) publica balanços e demonstrações, reapresentações semanais e histórico desde 2010. O [metadado oficial do conjunto](https://dados.cvm.gov.br/api/3/action/package_show?id=cia_aberta-doc-dfp) confirmou `license_id=odc-odbl`; o resultado preserva a atribuição CVM e a licença ODbL. Uma consulta bem-sucedida não constitui SLA ou validação contábil independente.

O adaptador usa exclusivamente o [diretório oficial DFP](https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/DFP/DADOS/), construindo `dfp_cia_aberta_{ano}.zip` a partir de ano inteiro validado. Não recebe URL do usuário e não segue redirecionamentos.

```ts
fetchCvmFundamentals({
  cvmCode: string, // 1 a 6 dígitos; normalizado para seis, sem inferir ticker
  year: number, // de 2010 até o ano corrente
  scope: "CONSOLIDATED" | "INDIVIDUAL",
}): Promise<CvmFundamentals>
```

O resultado inclui companhia/CNPJ/código CVM, data de referência, versão, identificador do documento, `receivedDate`, `receivedAtRaw`, instante de recuperação, SHA-256 do ZIP e URL da fonte. Cada métrica contém valor decimal em BRL e evidência: arquivo, código e descrição da conta, valor original, moeda, escala, período, escopo e versão. Métrica ausente ou incompatível é `null`, acompanhada de motivo em `limitations`.

O [dicionário oficial DFP](https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/DFP/META/meta_dfp_cia_aberta_txt.zip), baixado e conferido, define `DT_RECEB` como **data**, não horário de publicação, e `VL_CONTA` como decimal de precisão 29 e escala 10. O parser aceita essa representação textual, aplica a escala antes de exigir a precisão exata do ATLAS e preserva o original. Não converte valores financeiros por `Number`, nem arredonda fatos para fazer caber.

## Seleção contábil

O índice `dfp_cia_aberta_{ano}.csv` identifica a companhia explicitamente solicitada. Seleciona-se a referência mais recente daquele ano e, nessa referência, a maior versão disponível. Somente o mesmo CNPJ/código CVM, versão, referência, escopo e linhas `ORDEM_EXERC=ÚLTIMO` com fim do exercício igual à referência são aceitos. Lacunas não são preenchidas usando reapresentação anterior ou escopo diferente.

São processados apenas o índice e os CSVs BPA, BPP e DRE do escopo escolhido. Não há fallback automático do consolidado para o individual.

| Métrica | Demonstração / conta | Significado exigido |
| --- | --- | --- |
| `revenue` | DRE / 3.01 | Receita de venda de bens e/ou serviços |
| `netIncome` | DRE / 3.11 | Lucro/prejuízo do período, consolidado quando aplicável |
| `cash` | BPA / 1.01.01 | Caixa e equivalentes de caixa |
| `currentBorrowings` | BPP / 2.01.04 | Empréstimos e financiamentos circulantes |
| `noncurrentBorrowings` | BPP / 2.02.01 | Empréstimos e financiamentos não circulantes |
| `equity` | BPP / 2.03 | Patrimônio líquido, consolidado quando aplicável |

O mapeamento exige **código, descrição reconhecida e conta fixa**. Comparação da descrição normaliza somente acentos, espaços e caixa das letras. Uma instituição financeira pode usar a mesma numeração para outra rubrica: nessa situação, não se atribui o significado de receita industrial por aproximação. Linhas duplicadas da rubrica são consideradas ambíguas, não somadas.

Conversão aceita apenas `MOEDA=REAL` e escalas `UNIDADE` ou `MIL`. Valores ausentes, expoentes, separadores decimais inesperados, moeda/escala desconhecida e precisão incompatível não viram zero.

Os cálculos derivados são determinísticos:

- `netMarginPercent`: lucro do período ÷ receita × 100, exigindo mesma data inicial e receita positiva.
- `borrowings`: empréstimos circulantes + não circulantes, exigindo ambas as rubricas.
- `netBorrowings`: empréstimos − caixa, exigindo as três rubricas.
- `borrowingsToEquity`: empréstimos ÷ patrimônio líquido, exigindo patrimônio positivo.

`borrowings` representa as rubricas declaradas de empréstimos e financiamentos; não equivale automaticamente à totalidade das obrigações financeiras. A margem usa lucro do período, que no consolidado pode incluir participação de não controladores. Não são produzidos EBITDA, dívida total ajustada, ROE anualizado, múltiplos, dividend yield, preço justo ou sinal de compra.

## Disponibilidade temporal

`DT_REFER` indica o fechamento contábil; `DT_RECEB` informa a data de recebimento pela CVM. Nenhum deles é convertido em um horário fictício de publicação. Por isso `publishedAt=null`, `pointInTimeEligible=false` e `executionEligible=false` em todos os resultados.

O arquivo corrente pode conter reapresentações posteriores ao período analisado. A função `assertCvmObservedBy` rejeita qualquer tentativa de utilizar o resultado antes de `retrievedAt`. Ela não certifica o instante histórico de publicação. Backtests que precisem conhecer o que estava disponível em cada data necessitam de um arquivo histórico imutável de observações e revisões, ainda pendente.

Datas inválidas, futuras e recebimento anterior ao fechamento são recusados. Não há parâmetro `asOf` retroativo no adaptador de consulta atual.

## Limites operacionais

- Uma requisição HTTPS GET, timeout de 40 segundos, sem retentativas automáticas de arquivos grandes e sem credenciais.
- Máximo de 24 MiB recebidos, também verificado durante leitura por chunks; MIME ZIP/binário obrigatório.
- ZIP clássico com até 256 entradas; sem criptografia, ZIP64, caminhos, nomes duplicados, spans sobrepostos ou divergência de cabeçalho local/central.
- Até 768 MiB de tamanho total declarado e 96 MiB por CSV selecionado. A descompressão impõe limite de saída e confere tamanho e CRC-32.
- Somente um CSV selecionado descomprimido/decodificado por vez; sem extração no filesystem e sem construir uma árvore com todas as empresas.
- Até 1 milhão de linhas por CSV, 32 KiB por linha, 16 KiB por célula e 10 mil fatos retidos da companhia selecionada.
- Parser Latin1 delimitado por ponto e vírgula, com campos entre aspas, escapes, quebras internas e aspas literais dentro de campos não delimitados, conforme observado na fonte.

O chamador deve usar cache compartilhado e limitar consultas. O módulo não baixa o ZIP a cada ciclo de agente. O runtime de implantação ainda precisa ter conectividade HTTPS com a CVM e orçamento de memória/tempo adequado. Os limites recusam arquivos maiores; não prometem acomodar qualquer crescimento futuro do conjunto.

## Validação executada

`npm test -- tests/fundamentals.test.ts`: **38 testes aprovados, 1 teste de rede opt-in ignorado**. Cobertura inclui versões, identidades, escopos, períodos, precisão de dez casas da CVM, moedas, escalas, rubricas ambíguas, divisão por zero, incompatibilidade temporal, limites de resposta, CRC, descompressão, criptografia, nomes de arquivo, aspas e CSV inválido. As amostras sintéticas estão somente nos testes.

`npx eslint src/providers/cvm.ts src/core/fundamentals.ts tests/fundamentals.test.ts`: aprovado sem avisos. Os três arquivos foram formatados com Prettier 3.6.2.

Smoke público executado em PowerShell:

```powershell
$env:ATLAS_CVM_PUBLIC_SMOKE='1'
npm test -- tests/fundamentals.test.ts -t 'actual public annual DFP'
```

Resultado: **1 aprovado, 38 ignorados pelo filtro**, duração total de 2,75 segundos. Consumiu o ZIP anual 2025 diretamente da CVM, selecionou código CVM `009512`, escopo consolidado, e confirmou receita com evidência no CSV DRE. O índice real identificado contém referência `2025-12-31`, versão `1`, documento `155122` e recebimento `2026-03-05`. Esses valores são evidência da execução, não defaults ou dados embutidos no produto.

Tentativas anteriores encontraram reset da conexão TLS. A tentativa posterior conseguiu baixar o arquivo e expôs duas diferenças reais do formato, corrigidas com regressões: aspas literais em descrições não delimitadas e `VL_CONTA` com dez casas decimais. O smoke acima passou após as correções. Isso valida o caminho observado de uma companhia/ano/escopo; não certifica toda a cobertura histórica, disponibilidade futura ou adequação para execução de ordens.
