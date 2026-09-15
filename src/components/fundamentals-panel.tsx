"use client";

import { useState } from "react";
import { Search, ArrowUpRight } from "lucide-react";
import type { CvmFundamentals, CvmMetricName } from "@/core/fundamentals";
import { formatBrl, formatDecimal } from "@/core/format";

const labels: Record<CvmMetricName, string> = {
  revenue: "Receita de vendas",
  netIncome: "Lucro ou prejuízo do período",
  cash: "Caixa e equivalentes",
  currentBorrowings: "Empréstimos e financiamentos · curto prazo",
  noncurrentBorrowings: "Empréstimos e financiamentos · longo prazo",
  equity: "Patrimônio líquido",
};

function limitationText(code: string) {
  const explanations: Record<string, string> = {
    LATEST_RETRIEVED_REVISION_ONLY:
      "Foi utilizada a versão mais recente encontrada no arquivo consultado.",
    PUBLICATION_TIMESTAMP_UNKNOWN_NO_HISTORICAL_POINT_IN_TIME:
      "A data de publicação não foi comprovada para reconstruir o que era conhecido no passado.",
    BORROWINGS_ARE_REPORTED_LOANS_NOT_ALL_FINANCIAL_LIABILITIES:
      "Empréstimos e financiamentos não abrangem necessariamente toda a dívida financeira.",
    NO_TICKER_MAPPING_OR_TRADE_AUTHORIZATION:
      "O relatório não estabelece vínculo automático com um ticker nem autoriza negociação.",
    MISSING_ACCOUNT: "rubrica não encontrada nesta versão e escopo",
    AMBIGUOUS_ACCOUNT:
      "mais de uma rubrica encontrada; valor não consolidado automaticamente",
    UNSUPPORTED_ACCOUNT_MEANING:
      "a descrição da conta não corresponde à rubrica esperada",
    UNSUPPORTED_CURRENCY_OR_SCALE: "moeda ou escala não suportada",
    INVALID_PERIOD: "período contábil inconsistente",
    INVALID_AMOUNT: "valor não pôde ser validado",
  };
  if (explanations[code]) return explanations[code];
  const [metric, reason] = code.split(":");
  return `${labels[metric as CvmMetricName] ?? "Rubrica"}: ${explanations[reason] ?? "evidência insuficiente"}.`;
}

export function FundamentalsPanel({ connected }: { connected: boolean }) {
  const [report, setReport] = useState<CvmFundamentals | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function lookup(form: HTMLFormElement) {
    const input = new FormData(form);
    const query = new URLSearchParams({
      cvmCode: String(input.get("cvmCode")),
      year: String(input.get("year")),
      scope: String(input.get("scope")),
    });
    setLoading(true);
    setError("");
    setReport(null);
    try {
      const response = await fetch(`/api/atlas/fundamentals?${query}`);
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "Consulta CVM indisponível.");
      setReport(body);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Não foi possível consultar a CVM.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel form-panel">
      <div className="section-heading">
        <h2>Fundamentos · CVM</h2>
        <span className="status-label neutral">DFP ANUAL</span>
      </div>
      <p>
        Consulte demonstrações financeiras padronizadas pelo código oficial da
        companhia. A consulta mantém separados os balanços consolidado e
        individual.
      </p>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          void lookup(event.currentTarget);
        }}
      >
        <label>
          Código CVM
          <input
            name="cvmCode"
            inputMode="numeric"
            pattern="[0-9]{1,6}"
            maxLength={6}
            required
          />
        </label>
        <label>
          Exercício
          <input
            name="year"
            type="number"
            min={2010}
            max={new Date().getUTCFullYear()}
            step={1}
            required
          />
        </label>
        <label>
          Demonstração
          <select name="scope" required>
            <option value="CONSOLIDATED">Consolidada</option>
            <option value="INDIVIDUAL">Individual</option>
          </select>
        </label>
        <button disabled={!connected || loading}>
          <Search size={16} />
          {loading ? "Consultando CVM…" : "Consultar fundamentos"}
        </button>
      </form>
      <p className="muted">
        Confirme o código no cadastro oficial da CVM. O ticker não é convertido
        automaticamente. Há limite de quatro novas consultas à fonte por dia;
        resultados em cache podem ser consultados por sete dias.
      </p>
      {loading && (
        <p role="status">
          Lendo o arquivo público de demonstrações. Isso pode levar alguns
          segundos.
        </p>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {report && (
        <div className="fundamentals-result">
          <h3>{report.document.companyName}</h3>
          <p>
            CVM {report.document.cvmCode} · CNPJ {report.document.cnpj} ·
            Referência {report.document.referenceDate} · Versão{" "}
            {report.document.version} ·{" "}
            {report.scope === "CONSOLIDATED" ? "Consolidado" : "Individual"}
          </p>
          <p className="muted">
            Recepção registrada na CVM: {report.document.receivedDate}.{" "}
            Consultado em{" "}
            {new Date(report.retrievedAt).toLocaleString("pt-BR", {
              timeZone: "America/Sao_Paulo",
            })}{" "}
            · São Paulo.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Rubrica</th>
                  <th>Valor em BRL</th>
                  <th>Conta, unidade e período originais</th>
                </tr>
              </thead>
              <tbody>
                {(Object.keys(labels) as CvmMetricName[]).map((key) => {
                  const metric = report.metrics[key];
                  return (
                    <tr key={key}>
                      <th scope="row">{labels[key]}</th>
                      <td>{formatBrl(metric?.value)}</td>
                      <td>
                        {metric
                          ? `${metric.evidence.accountCode} · ${metric.evidence.reportedValue} ${metric.evidence.scale}`
                          : "Rubrica ausente ou não compatível"}
                        {metric && (
                          <div className="muted">
                            {metric.evidence.periodStart
                              ? `${metric.evidence.periodStart} a `
                              : "Em "}
                            {metric.evidence.periodEnd}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <th scope="row">Margem líquida</th>
                  <td>
                    {report.derived.netMarginPercent === null
                      ? "—"
                      : `${formatDecimal(report.derived.netMarginPercent)}%`}
                  </td>
                  <td>Lucro / receita, no mesmo período e escopo</td>
                </tr>
                <tr>
                  <th scope="row">
                    Empréstimos e financiamentos líquidos de caixa
                  </th>
                  <td>{formatBrl(report.derived.netBorrowings)}</td>
                  <td>
                    Curto prazo + longo prazo − caixa; não representa toda a
                    dívida financeira
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="notice">
            Esta é a versão recuperada agora. A data de publicação não foi
            comprovada; o relatório não é elegível para backtest point-in-time
            nem autoriza negociação. Campos não comprovados ficam sem valor.
          </div>
          <a
            href={report.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-link"
          >
            Arquivo original CVM · ODbL <ArrowUpRight size={14} />
          </a>
          <details>
            <summary>Rastreabilidade e limites do relatório</summary>
            <p>Documento {report.document.documentId}. SHA-256 do arquivo:</p>
            <p className="evidence-hash">{report.archiveSha256}</p>
            <ul>
              {report.limitations.map((item, index) => (
                <li key={`${item}:${index}`}>{limitationText(item)}</li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </section>
  );
}
