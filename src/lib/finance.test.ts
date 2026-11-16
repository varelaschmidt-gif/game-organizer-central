import { describe, expect, it } from "vitest";
import {
  assertPaymentWithinBalance,
  canCloseFinancialPeriod,
  cashBalanceCents,
  chargeBalanceCents,
  getChargeDisplayStatus,
  getEligibleEventParticipantIds,
  parseMoneyToCents,
  splitCentsEqually,
  suggestedPerPlayerCents,
  summarizeMovementsByCategory,
  validateCustomShares,
} from "./finance";

describe("financial money rules", () => {
  it("parses Brazilian money values as integer cents", () => {
    expect(parseMoneyToCents("R$ 1.234,56")).toBe(123456);
    expect(parseMoneyToCents("20,5")).toBe(2050);
    expect(parseMoneyToCents("10.20")).toBe(1020);
    expect(parseMoneyToCents("10,999")).toBeNull();
  });

  it("tracks partial payment until the full charge is settled", () => {
    expect(chargeBalanceCents(10000, [3000])).toBe(7000);
    expect(chargeBalanceCents(10000, [3000, 7000])).toBe(0);
    expect(() => assertPaymentWithinBalance(7000, 7001)).toThrow();
  });

  it("keeps an overdue charge overdue after a partial payment", () => {
    expect(getChargeDisplayStatus(4000, 6000, "2026-11-10", "2026-11-11")).toBe("overdue");
    expect(getChargeDisplayStatus(0, 10000, "2026-11-10", "2026-11-11")).toBe("paid");
    expect(getChargeDisplayStatus(10000, 0, "2026-11-18", "2026-11-11")).toBe("due_soon");
    expect(getChargeDisplayStatus(10000, 0, "2026-12-10", "2026-11-11")).toBe("open");
    expect(getChargeDisplayStatus(0, 0, "2026-11-10", "2026-11-11", true)).toBe("cancelled");
  });

  it("splits rateios in cents with no remainder lost", () => {
    const shares = splitCentsEqually(10001, 3);
    expect(shares).toEqual([3334, 3334, 3333]);
    expect(shares.reduce((sum, value) => sum + value, 0)).toBe(10001);
    expect(validateCustomShares(10001, [2000, 4000, 4001])).toBe(true);
    expect(validateCustomShares(10001, [2000, 4000, 4000])).toBe(false);
  });

  it("selects only distinct, confirmed players who were marked present for event rateios", () => {
    expect(
      getEligibleEventParticipantIds({
        attendances: [
          {
            player_id: "monthly-1",
            status: "confirmed",
            attended: true,
            players: { participation_type: "mensalista" },
          },
          {
            player_id: "monthly-1",
            status: "confirmed",
            attended: true,
            players: { participation_type: "mensalista" },
          },
          {
            player_id: "absent",
            status: "confirmed",
            attended: false,
            players: { participation_type: "avulso" },
          },
          {
            player_id: "guest",
            status: "confirmed",
            attended: true,
            players: { participation_type: "convidado" },
          },
          {
            player_id: "waitlisted",
            status: "waitlist",
            attended: true,
            players: { participation_type: "avulso" },
          },
        ],
      }),
    ).toEqual(["monthly-1"]);
  });

  it("uses the actual monthly roster for suggestions and treats capacity as preview only", () => {
    expect(suggestedPerPlayerCents(100000, 20)).toBe(5000);
    expect(suggestedPerPlayerCents(100000, 15)).toBe(6667);
    expect(suggestedPerPlayerCents(100000, 0)).toBeNull();
  });

  it("calculates cash only from opening balance and signed real movements", () => {
    expect(cashBalanceCents(10000, [5000, 2000, -3500])).toBe(13500);
    // An unpaid charge is intentionally absent from the movement list.
    expect(cashBalanceCents(0, [])).toBe(0);
  });

  it("summarizes actual cash by category and excludes unpaid charges", () => {
    expect(
      summarizeMovementsByCategory([
        { kind: "opening_balance", direction: "in", amountCents: 10000 },
        {
          kind: "charge_payment",
          direction: "in",
          amountCents: 5000,
          chargeCategory: "Mensalidade",
        },
        {
          kind: "expense_payment",
          direction: "out",
          amountCents: 2500,
          expenseCategory: "Aluguel",
        },
        { kind: "manual_adjustment", direction: "out", amountCents: 200 },
      ]),
    ).toEqual([
      { category: "Ajuste manual", incomeCents: 0, expenseCents: 200 },
      { category: "Aluguel", incomeCents: 0, expenseCents: 2500 },
      { category: "Mensalidade", incomeCents: 5000, expenseCents: 0 },
      { category: "Saldo inicial", incomeCents: 10000, expenseCents: 0 },
    ]);
  });

  it("allows closing only a completed month", () => {
    expect(canCloseFinancialPeriod("2026-10-31", "2026-11-01")).toBe(true);
    expect(canCloseFinancialPeriod("2026-11-30", "2026-11-11")).toBe(false);
  });
});
