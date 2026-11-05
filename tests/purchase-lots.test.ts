import { expect, it } from "vitest";
import { purchaseLots } from "@/core/purchase-lots";

it("preserves different execution prices and separates brokerage from the paid unit price", () => {
  const make = (quantity: number, price: string, fee: string, side = "BUY") => ({ quantity, price, fee, side, executed_at: "2026-11-04T15:00:00Z" });
  const lots = purchaseLots([make(10, "18.1800", "1.00"), make(5, "18.18", "0.08"), make(2, "18.25", "0.99"), make(3, "18.25", "0.99", "SELL")]);
  expect(lots).toMatchObject([{ price: "18.18", quantity: 15, fees: "1.08", total: "273.78" }, { price: "18.25", quantity: 2, fees: "0.99", total: "37.49" }]);
});

it("does not merge execution prices merely because both round to the same displayed cent", () => {
  expect(purchaseLots(["10.001", "10.004"].map((price) => ({ side: "BUY", quantity: 1, price, fee: "0", executed_at: "2026-11-04T15:00:00Z" })))).toHaveLength(2);
});
