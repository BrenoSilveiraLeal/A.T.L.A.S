import { describe, expect, it } from "vitest";
import { meetingDue, meetingMinutes, type MeetingAgent } from "@/core/meeting";

const range = { low: 40, high: 60, buyBelow: 42, sellAbove: 58.8 };
const agent = (over: Partial<MeetingAgent>): MeetingAgent => ({ agentId: "a", name: "Ana", ticker: "ITUB4", price: 50, closes: [52, 51, 50],
  holding: 0, cost: 0, range, history: { samples: 4, upShare: 0.75, average: 0.05 }, consensus: null, ...over });

describe("end-of-day team meeting", () => {
  it("meets on trading days after 17:10 São Paulo, not on weekends or holidays", () => {
    expect(meetingDue(new Date("2026-10-26T20:15:00Z"))).toMatchObject({ due: true, live: true, day: "2026-10-26" });
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
    const said = Object.fromEntries(m.lines.map((l) => [l.name, l.text]));
    expect(said.Ana).toContain("acima da faixa de compra");
    expect(said.Gabriel).toContain("virou para cima depois da queda");
    expect(said.Thiago).toContain("ainda caindo");
    expect(said.Maria).toContain("Tenho 2 na Genial");
    expect(said["João"]).toContain("não vale comprar");
    expect(m.summary[0]).toContain("R$ 16,00 livres de R$ 100,00");
    expect(m.suggestions.join(" ")).toContain("João (VALE3)");
    // The boss opens with who gets the money first and evaluates each agent.
    expect(m.lines[0]).toMatchObject({ agentId: "BOSS", name: "Chefe" });
    expect(m.lines[0].text).toContain("1º LREN3");
    expect(m.lines.filter((l) => l.agentId === "BOSS").map((l) => l.text).join(" ")).toContain("Maria: posição");
  });

  it("checks the rule: buying at the first touch of the buy zone vs today", () => {
    const fell = meetingMinutes("2026-10-26", [agent({ price: 38, closes: [45, 41, 40] })], { deposited: 100, free: 100 });
    expect(fell.lessons[0]).toContain("Esperar a virada evitou");
    const rose = meetingMinutes("2026-10-26", [agent({ price: 46, closes: [45, 41, 44] })], { deposited: 100, free: 100 });
    expect(rose.lessons[0]).toContain("deixou essa alta passar");
  });
});
