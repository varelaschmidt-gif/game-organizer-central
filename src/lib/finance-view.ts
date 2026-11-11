export type FinanceTone = "success" | "warning" | "danger" | "neutral";
export type FinanceStatus = { label: string; tone: FinanceTone };

export function todaySaoPaulo(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values["year"]}-${values["month"]}-${values["day"]}`;
}

export function formatBRL(cents: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format((Number.isFinite(cents) ? cents : 0) / 100);
}

export function financeStatus(
  dueDate: string,
  outstandingCents: number,
  status = "open",
  today = todaySaoPaulo(),
): FinanceStatus {
  if (status === "cancelled") return { label: "Cancelada", tone: "neutral" };
  if (outstandingCents <= 0) return { label: "Pago", tone: "success" };

  const due = Date.parse(`${dueDate}T00:00:00Z`);
  const current = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(due) || !Number.isFinite(current)) {
    return { label: "Em aberto", tone: "warning" };
  }

  const days = Math.round((due - current) / 86_400_000);
  if (days < 0) return { label: `Atraso · ${Math.abs(days)} dia(s)`, tone: "danger" };
  if (days === 0) return { label: "Vence hoje", tone: "warning" };
  if (days <= 7) return { label: `Vence em ${days} dia(s)`, tone: "warning" };
  return { label: "Em aberto", tone: "warning" };
}
