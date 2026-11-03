import marketHours from "../../../config/b3-market-hours.json";

/** Keep the official WIN schedule shared by live-session gates, analysis, backfills, and backtests. */
type CloseTime = "18:00" | "18:25";
const winHours = marketHours.win as {
  defaultClose: CloseTime;
  expiryClose: CloseTime;
  regularCloseChanges: Array<{ effectiveDate: string; close: CloseTime }>;
};

export function winSessionClose(date: string, expiresOn: string | null = null): "18:00" | "18:25" {
  if (date === expiresOn) return winHours.expiryClose;
  let close: CloseTime = winHours.defaultClose;
  for (const change of winHours.regularCloseChanges) {
    if (date < change.effectiveDate) break;
    close = change.close;
  }
  return close;
}
