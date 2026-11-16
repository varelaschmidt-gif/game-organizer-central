import { describe, expect, it } from "vitest";
import { financialCsv, readAllFinanceRows, requireMoneyCents } from "./finance-report";

describe("financial reports and trusted amounts", () => {
  it("uses exact cents and rejects rounding and malformed amounts", () => {
    expect(requireMoneyCents("1.234,56")).toBe(123456);
    expect(requireMoneyCents("0,29")).toBe(29);
    expect(() => requireMoneyCents("1.005")).toThrow();
    expect(() => requireMoneyCents("abc")).toThrow();
  });
  it("loads all pages including an exact multiple and preserves their order", async () => {
    const source = Array.from({ length: 1000 }, (_, id) => ({ id }));
    const calls: number[] = [];
    const result = await readAllFinanceRows(async (from, to) => {
      calls.push(from);
      return { data: source.slice(from, to + 1), error: null };
    });
    expect(result.data).toEqual(source);
    expect(calls).toEqual([0, 500, 1000]);
  });
  it("fails the report when any page fails instead of returning partial totals", async () => {
    await expect(
      readAllFinanceRows(
        async (from) =>
          from === 0 ? { data: [1, 2], error: null } : { data: null, error: new Error("offline") },
        2,
      ),
    ).rejects.toThrow("offline");
  });
  it("escapes separators, quotes, newlines and formulas in exported user text", () => {
    const csv = financialCsv([
      { nome: '=HYPERLINK("x")', descricao: 'bola; "nova"\nlinha', cents: 123 },
    ]);
    expect(csv).toContain('"\'=HYPERLINK(""x"")"');
    expect(csv).toContain('"bola; ""nova""\nlinha"');
    expect(csv).toContain('"123"');
    expect(financialCsv([])).toBe("");
    expect(financialCsv([{ centavos: -100 }])).toContain('"-100"');
  });
});
