import { describe, expect, it } from "vitest";
import { formatBrl, formatDecimal } from "@/core/format";

describe("exact financial display", () => {
  it("preserves cents beyond Number safe precision", () => {
    expect(formatBrl("123456789012345678.91")).toBe(
      "R$ 123.456.789.012.345.678,91",
    );
    expect(formatBrl("-99999999999999999.995")).toBe(
      "R$ -100.000.000.000.000.000,00",
    );
  });
  it("does not turn unavailable or malformed values into zero", () => {
    for (const value of [
      null,
      undefined,
      "",
      "NaN",
      "Infinity",
      "0x12",
      "1e20",
      {},
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(formatBrl(value)).toBe("—");
    }
    expect(formatBrl("0.0000000000")).toBe("R$ 0,00");
    expect(formatDecimal("1234.5678", 4)).toBe("1.234,5678");
  });
});
