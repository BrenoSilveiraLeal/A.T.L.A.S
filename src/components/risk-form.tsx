"use client";
const fields: [string, string, string, boolean][] = [
  [
    "maxPositionPerAgent",
    "Posição máxima por agente (R$)",
    "Limita a exposição de cada subcarteira.",
    false,
  ],
  [
    "maxPortfolioExposure",
    "Exposição máxima da carteira (R$)",
    "Capital total que pode ficar exposto ao mercado.",
    false,
  ],
  [
    "maxOrderValue",
    "Valor máximo por ordem (R$)",
    "Teto financeiro de uma ordem.",
    false,
  ],
  [
    "maxDailyLoss",
    "Perda máxima diária (R$)",
    "Ao atingir o limite, novas propostas são bloqueadas.",
    false,
  ],
  [
    "maxWeeklyLoss",
    "Perda máxima semanal (R$)",
    "Limite acumulado no período semanal definido.",
    false,
  ],
  [
    "maxDrawdownBps",
    "Drawdown máximo (pontos-base)",
    "Queda em relação ao pico. 100 pontos-base = 1%.",
    false,
  ],
  [
    "minCashReserve",
    "Reserva mínima de caixa (R$)",
    "Caixa que deve permanecer livre após a compra.",
    false,
  ],
  [
    "maxOpenPositions",
    "Máximo de posições abertas",
    "Número máximo de ativos com exposição.",
    true,
  ],
  [
    "maxSectorExposure",
    "Exposição máxima por setor (R$)",
    "Evita concentrar o capital em um setor.",
    false,
  ],
  [
    "maxCorrelatedExposure",
    "Exposição correlacionada máxima (R$)",
    "Limita ativos que tendem a se mover juntos.",
    false,
  ],
  [
    "maxOrdersPerMinute",
    "Ordens por minuto",
    "Inclui ordens já reservadas e enviadas.",
    true,
  ],
  ["maxOrdersPerDay", "Ordens por dia", "Teto de atividade no dia.", true],
  [
    "maxSlippageBps",
    "Slippage máximo (pontos-base)",
    "Desvio permitido em relação ao bid/ask de referência.",
    false,
  ],
  [
    "newsEmergencyThreshold",
    "Limiar de notícia crítica (0 a 1)",
    "Acima deste valor, o risco bloqueia propostas.",
    false,
  ],
  [
    "maxQuoteAgeMs",
    "Idade máxima da cotação (ms)",
    "Máximo 60.000 ms. Não converte dado atrasado em tempo real.",
    true,
  ],
  [
    "maxBrokerSnapshotAgeMs",
    "Idade máxima da conta (ms)",
    "Máximo 60.000 ms desde a consulta da corretora.",
    true,
  ],
  [
    "maxClockSkewMs",
    "Tolerância de relógio (ms)",
    "Máximo 5.000 ms de diferença tolerada.",
    true,
  ],
];
export function RiskForm({
  enabled,
  busy,
  save,
}: {
  enabled: boolean;
  busy: boolean;
  save: (path: string, body: object) => Promise<void>;
}) {
  return (
    <section className="panel form-panel">
      <h2>Defina um perfil de risco</h2>
      <p>
        Todos os limites precisam ser definidos pelo proprietário. Salvar um
        perfil não habilita execução; a vinculação e homologação live permanecem
        pendentes.
      </p>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const limits = Object.fromEntries(
            fields.map(([key, , , integer]) => [
              key,
              integer ? Number(f.get(key)) : String(f.get(key)),
            ]),
          );
          void save("risk", { name: f.get("name"), limits });
        }}
      >
        <label>
          Nome do perfil
          <input name="name" minLength={2} maxLength={80} required />
        </label>
        {fields.map(([key, label, help, integer]) => (
          <label key={key} title={help}>
            {label}
            <input
              name={key}
              inputMode={integer ? "numeric" : "decimal"}
              pattern={integer ? "[0-9]+" : "[0-9]+([.][0-9]+)?"}
              required
            />
            <small>{help}</small>
          </label>
        ))}
        <button disabled={!enabled || busy}>Salvar novo perfil</button>
      </form>
    </section>
  );
}
