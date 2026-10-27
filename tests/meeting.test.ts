import { describe, expect, it } from "vitest";
import { lineSeconds, meetingClock, meetingDue, meetingMinutes, type MeetingAgent } from "@/core/meeting";

const range = { low: 40, high: 60, buyBelow: 42, sellAbove: 58.8 };
const agent = (over: Partial<MeetingAgent>): MeetingAgent => ({ agentId: "a", name: "Ana", ticker: "ITUB4", price: 50, closes: [52, 51, 50],
  holding: 0, cost: 0, range, history: { samples: 4, upShare: 0.75, average: 0.05 }, consensus: null, ...over });

describe("end-of-day team meeting", () => {
  it("meets on trading days right after the close (17:05 São Paulo), not on weekends or holidays", () => {
    expect(meetingDue(new Date("2026-10-26T20:05:00Z"))).toMatchObject({ due: true, gathering: true, day: "2026-10-26" });
    expect(meetingDue(new Date("2026-10-26T20:04:00Z")).due).toBe(false);
    expect(meetingDue(new Date("2026-10-26T19:00:00Z")).due).toBe(false);
    expect(meetingDue(new Date("2026-10-25T21:00:00Z")).due).toBe(false); // Sunday
    expect(meetingDue(new Date("2026-10-12T21:00:00Z")).due).toBe(false); // holiday
  });

  it("each agent speaks from its real numbers", () => {
    const m = meetingMinutes("2026-10-26", [
      agent({}),
      agent({ agentId: "b", name: "Gabriel", ticker: "LREN3", price: 40.6, closes: [45, 43, 41, 40] }),
      agent({ agentId: "c", name: "Thiago", ticker: "CYRE3", price: 39.5, closes: [45, 43, 41, 40] }),
      agent({ agentId: "d", name: "Maria", ticker: "PETR4", price: 59, holding: 2, cost: 84 }),
      agent({ agentId: "e", name: "João", ticker: "VALE3", price: 41, history: { samples: 6, upShare: 0.33, average: -0.01 } }),
    ], { deposited: 100, free: 16 });
    const said = Object.fromEntries(m.lines.filter((l) => l.agentId !== "BOSS").map((l) => [l.name, l.text]));
    expect(said.Ana).toContain("acima da faixa de compra");
    expect(said.Gabriel).toContain("virou para cima depois da queda");
    expect(said.Thiago).toContain("ainda caindo");
    expect(said.Maria).toContain("Tenho 2 na Genial");
    expect(said["João"]).toContain("não vale comprar");
    expect(m.summary[0]).toContain("R$ 16,00 livres de R$ 100,00");
    expect(m.suggestions.join(" ")).toContain("João (VALE3)");
    // The boss opens, gives each one its turn, says who gets the money first, evaluates and closes.
    expect(m.lines[0]).toMatchObject({ agentId: "BOSS", name: "Chefe" });
    expect(m.lines[0].text).toContain("Vamos à reunião de hoje");
    const boss = m.lines.filter((l) => l.agentId === "BOSS").map((l) => l.text).join(" ");
    expect(boss).toContain("Gabriel, e a LREN3?");
    expect(boss).toContain("1º LREN3");
    expect(boss).toContain("Maria: posição");
    expect(m.lines.at(-1)?.text).toContain("Reunião encerrada");
  });

  it("checks the rule: buying at the first touch of the buy zone vs today", () => {
    const fell = meetingMinutes("2026-10-26", [agent({ price: 38, closes: [45, 41, 40] })], { deposited: 100, free: 100 });
    expect(fell.lessons[0]).toContain("Esperar a virada evitou");
    const rose = meetingMinutes("2026-10-26", [agent({ price: 46, closes: [45, 41, 44] })], { deposited: 100, free: 100 });
    expect(rose.lessons[0]).toContain("deixou essa alta passar");
  });

  it("whoever traded today tells it first, with what it expects (owner, 27/10/2026)", () => {
    const beatriz = agent({ agentId: "b", name: "Beatriz", ticker: "EQTL3", price: 35.36, holding: 6, cost: 215.26, closes: [48.9, 34.84],
      range: { low: 34.23, high: 50.75, buyBelow: 35.94, sellAbove: 49.74 }, trades: [{ side: "BUY", quantity: 6, price: 35.7, value: 215.26 }] });
    const m = meetingMinutes("2026-10-27", [agent({}), beatriz], { deposited: 500, free: 284.74, analyses: 40, buys: 1, sells: 0 });
    const texts = m.lines.map((l) => `${l.name}: ${l.text}`);
    expect(texts[1]).toBe("Chefe: Beatriz, você operou hoje. Conta pra gente.");
    expect(texts[2]).toContain("Hoje comprei 6 ações da EQTL3 a R$ 35,70 cada (total R$ 215,26 com as taxas)");
    expect(texts[3]).toBe("Chefe: E o que você espera com isso?");
    expect(texts[4]).toContain("a partir de R$ 49,74");
    expect(texts.join(" ")).toContain("Supervisora: Meu relatório: hoje foram 40 análises, 1 compra(s)");
  });

  it("lasts as long as the conversation takes, the same moment on every screen", () => {
    const m = meetingMinutes("2026-10-27", [agent({}), agent({ agentId: "b", name: "Bia" })], { deposited: 100, free: 100 });
    const minutes = { ...m, created_at: "2026-10-27T20:05:30Z" };
    const total = m.lines.reduce((s, l) => s + lineSeconds(l.text), 0);
    expect(meetingClock(new Date("2026-10-27T20:06:00Z"), minutes).phase).toBe("GATHERING");
    expect(meetingClock(new Date("2026-10-27T20:06:31Z"), minutes)).toMatchObject({ phase: "TALKING", index: 0 });
    expect(meetingClock(new Date(Date.parse("2026-10-27T20:06:30Z") + total * 1000 + 1000), minutes).phase).toBe("DONE");
    // Before the minutes exist the team already waits in the room; the day before's minutes do not count.
    expect(meetingClock(new Date("2026-10-27T20:06:00Z"), { ...minutes, day: "2026-10-26" }).phase).toBe("GATHERING");
    expect(meetingClock(new Date("2026-10-27T19:00:00Z"), null).phase).toBe("NONE");
  });
});
