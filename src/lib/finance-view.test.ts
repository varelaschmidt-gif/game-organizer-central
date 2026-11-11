import { describe, expect, it } from "vitest";
import { financeStatus, formatBRL, todaySaoPaulo } from "./finance-view";

describe("finance view helpers", () => {
  it("formats integer cents as Brazilian currency", () => {
    expect(formatBRL(2050)).toBe("R$ 20,50");
  });

  it("shows paid only when no amount remains", () => {
    expect(financeStatus("2026-11-01", 0, "open", "2026-11-11")).toEqual({ label: "Pago", tone: "success" });
  });

  it("keeps partial balance overdue after the due date", () => {
    expect(financeStatus("2026-11-10", 2500, "open", "2026-11-11")).toEqual({ label: "Atraso · 1 dia(s)", tone: "danger" });
  });

  it("starts the reminder countdown seven days before the due date", () => {
    expect(financeStatus("2026-11-18", 1000, "open", "2026-11-11")).toEqual({ label: "Vence em 7 dia(s)", tone: "warning" });
  });

  it("shows due today, open, and cancelled states", () => {
    expect(financeStatus("2026-11-11", 1000, "open", "2026-11-11").label).toBe("Vence hoje");
    expect(financeStatus("2026-11-25", 1000, "open", "2026-11-11").label).toBe("Em aberto");
    expect(financeStatus("2026-11-01", 1000, "cancelled", "2026-11-11")).toEqual({ label: "Cancelada", tone: "neutral" });
  });

  it("formats the current São Paulo date as an ISO day", () => {
    expect(todaySaoPaulo(new Date("2026-11-11T14:00:00Z"))).toBe("2026-11-11");
  });
});
