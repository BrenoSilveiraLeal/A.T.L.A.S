import { describe, expect, it } from "vitest";
import { forecastOpinion, nearLowHistory, scoutGrade } from "@/core/forecast";

describe("forecasts", () => {
  it("analysts' consensus: for, against or neutral", () => {
    const itau = { targetMean: 49.54, targetLow: 30.5, targetHigh: 60, recommendation: "buy", analysts: 13 };
    expect(forecastOpinion(48.3, itau)).toMatchObject({ vote: "NEUTRO" }); // only +3%
    expect(forecastOpinion(40, itau)).toMatchObject({ vote: "A_FAVOR" });
    expect(forecastOpinion(48.3, { ...itau, recommendation: "sell" }).vote).toBe("CONTRA");
    expect(forecastOpinion(60, itau).text).toContain("13 analistas");
    expect(forecastOpinion(50, null).vote).toBe("NEUTRO");
  });

  it("history after coming near the 6-month low", () => {
    // A rise, a crash below the 6-month low, then a recovery.
    const closes = [...Array.from({ length: 126 }, (_, i) => 100 + i), 50, ...Array.from({ length: 70 }, (_, i) => 51 + i * 0.5)];
    const h = nearLowHistory(closes, 126, 2, 63)!;
    expect([h.samples, h.upShare]).toEqual([1, 1]);
    expect(h.average).toBeGreaterThan(0.5);
  });

  it("scout grades cheap, well-rated, profitable stocks as good", () => {
    expect(scoutGrade({ price: 21, low: 20, high: 30, upside: 0.3, recommendation: "buy", profitMargin: 0.1 }).good).toBe(true);
    expect(scoutGrade({ price: 29, low: 20, high: 30, upside: 0.3, recommendation: "buy", profitMargin: 0.1 }).good).toBe(false);
    expect(scoutGrade({ price: 21, low: 20, high: 30, upside: 0.3, recommendation: "buy", profitMargin: -0.1 }).warnings).toContain("empresa com prejuízo");
  });
});
