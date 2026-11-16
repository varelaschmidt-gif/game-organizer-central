export type ChargeDisplayStatus =
  "paid" | "due_soon" | "open" | "partial" | "overdue" | "cancelled";

export function parseMoneyToCents(input: string | number): number | null {
  const raw = String(input)
    .trim()
    .replace(/^R\$\s*/i, "")
    .replace(/\s/g, "");
  if (!raw) return null;
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  const signed = negative ? -cents : cents;
  const result = Number(signed);
  return Number.isSafeInteger(result) ? result : null;
}

export function formatCents(cents: number) {
  if (!Number.isSafeInteger(cents)) throw new Error("Valor em centavos inválido");
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

export function suggestedPerPlayerCents(totalCents: number, playerCount: number) {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) throw new Error("Total inválido");
  if (!Number.isInteger(playerCount) || playerCount < 1) return null;
  return Math.round(totalCents / playerCount);
}

export function splitCentsEqually(totalCents: number, count: number) {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) throw new Error("Total inválido");
  if (!Number.isInteger(count) || count < 1)
    throw new Error("Quantidade de participantes inválida");
  const base = Math.floor(totalCents / count);
  const remainder = totalCents % count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

export function validateCustomShares(totalCents: number, shares: number[]) {
  if (
    !Number.isSafeInteger(totalCents) ||
    totalCents < 0 ||
    shares.some((value) => !Number.isSafeInteger(value) || value < 0)
  )
    return false;
  return shares.reduce((sum, value) => sum + value, 0) === totalCents;
}

export function getEligibleEventParticipantIds(
  event:
    | {
        attendances?: Array<{
          player_id: string;
          status: string;
          attended: boolean | null;
          players?:
            | { participation_type?: string | null; is_event_guest?: boolean | null }
            | Array<{ participation_type?: string | null; is_event_guest?: boolean | null }>
            | null;
        }>;
      }
    | null
    | undefined,
) {
  return [
    ...new Set(
      (event?.attendances ?? []).flatMap((attendance) => {
        const player = Array.isArray(attendance.players)
          ? attendance.players[0]
          : attendance.players;
        if (
          attendance.status !== "confirmed" ||
          attendance.attended !== true ||
          player?.participation_type === "convidado" ||
          player?.is_event_guest
        )
          return [];
        return [attendance.player_id];
      }),
    ),
  ];
}

export function chargeBalanceCents(amountCents: number, paymentsCents: number[]) {
  if (
    !Number.isSafeInteger(amountCents) ||
    amountCents < 0 ||
    paymentsCents.some((value) => !Number.isSafeInteger(value))
  ) {
    throw new Error("Valores financeiros inválidos");
  }
  return amountCents - paymentsCents.reduce((sum, value) => sum + value, 0);
}

export function assertPaymentWithinBalance(balanceCents: number, paymentCents: number) {
  if (
    !Number.isSafeInteger(balanceCents) ||
    !Number.isSafeInteger(paymentCents) ||
    paymentCents <= 0
  ) {
    throw new Error("Informe um pagamento válido em centavos");
  }
  if (paymentCents > balanceCents) throw new Error("O pagamento excede o saldo da cobrança");
}

export function getChargeDisplayStatus(
  balanceCents: number,
  receivedCents: number,
  dueDate: string,
  today: string,
  cancelled = false,
): ChargeDisplayStatus {
  if (cancelled) return "cancelled";
  if (balanceCents <= 0) return "paid";
  if (dueDate < today) return "overdue";
  if (receivedCents > 0) return "partial";
  const daysUntilDue = Math.round(
    (Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
  return daysUntilDue <= 7 ? "due_soon" : "open";
}

export function cashBalanceCents(openingBalanceCents: number, signedMovementsCents: number[]) {
  if (
    !Number.isSafeInteger(openingBalanceCents) ||
    signedMovementsCents.some((value) => !Number.isSafeInteger(value))
  ) {
    throw new Error("Movimentação financeira inválida");
  }
  return openingBalanceCents + signedMovementsCents.reduce((sum, value) => sum + value, 0);
}

export function summarizeMovementsByCategory(
  movements: Array<{
    kind: string;
    direction: "in" | "out";
    amountCents: number;
    chargeCategory?: string | null;
    expenseCategory?: string | null;
  }>,
) {
  const totals = new Map<string, { incomeCents: number; expenseCents: number }>();
  for (const movement of movements) {
    if (!Number.isSafeInteger(movement.amountCents) || movement.amountCents < 0)
      throw new Error("Movimentação financeira inválida");
    const category =
      movement.kind === "opening_balance"
        ? "Saldo inicial"
        : movement.kind === "manual_adjustment"
          ? "Ajuste manual"
          : (movement.expenseCategory ?? movement.chargeCategory ?? "Outros");
    const current = totals.get(category) ?? { incomeCents: 0, expenseCents: 0 };
    if (movement.direction === "in") current.incomeCents += movement.amountCents;
    else current.expenseCents += movement.amountCents;
    totals.set(category, current);
  }
  return [...totals.entries()]
    .map(([category, amounts]) => ({ category, ...amounts }))
    .sort((a, b) => a.category.localeCompare(b.category, "pt-BR"));
}

export function canCloseFinancialPeriod(periodEnd: string, today: string) {
  return periodEnd < today;
}
