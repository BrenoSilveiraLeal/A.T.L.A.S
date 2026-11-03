/** Human-readable points for the active futures chart; money uses separate BRL formatting. */
export function formatInstrumentPrice(ticker: string, value: number): string {
  const decimals = ticker.startsWith("WIN") ? 0 : ticker.startsWith("WDO") ? 1 : 2;
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}
