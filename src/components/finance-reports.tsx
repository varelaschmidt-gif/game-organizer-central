import type { FinanceSummary } from "@/lib/finance-client";
import { useState } from "react";
import { financialCsv } from "@/lib/finance-report";
import { formatBRL, todaySaoPaulo } from "@/lib/finance-view";

type Charge = {
  id: string;
  player_id: string;
  kind: string;
  description: string;
  amount_cents: number;
  paid_cents: number;
  outstanding_cents: number;
  due_date: string;
  status: string;
};
type Entry = {
  id: string;
  player_id: string | null;
  entry_type: string;
  amount_cents: number;
  occurred_on: string;
  method: string | null;
  notes: string | null;
  category: string | null;
  created_by: string;
  created_at: string;
};
type Expense = {
  description: string;
  category: string;
  amount_cents: number;
  incurred_on: string;
  cancelled_at?: string | null;
};
function download(rows: Array<Record<string, unknown>>, name: string) {
  const url = URL.createObjectURL(
    new Blob(["\uFEFF" + financialCsv(rows)], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function FinanceReports({
  charges,
  ledger,
  expenses,
  names,
  month,
  manager,
  summary,
}: {
  charges: Charge[];
  ledger: Entry[];
  expenses: Expense[];
  names: Map<string, string>;
  month: string;
  manager: boolean;
  summary?: FinanceSummary;
}) {
  const [player, setPlayer] = useState("");
  const rows = charges.filter((c) => !player || c.player_id === player);
  const movements = ledger.filter(
    (l) => (!player || l.player_id === player) && l.occurred_on.startsWith(month),
  );
  const overdue = new Map<string, number>();
  for (const c of charges)
    if (c.status === "open" && c.due_date < todaySaoPaulo() && Number(c.outstanding_cents) > 0)
      overdue.set(c.player_id, (overdue.get(c.player_id) ?? 0) + Number(c.outstanding_cents));
  const ledgerRows = movements.map((l) => ({
    data: l.occurred_on,
    jogador: l.player_id ? names.get(l.player_id) || l.player_id : "",
    tipo: l.entry_type,
    categoria: l.category,
    centavos: l.amount_cents,
    forma: l.method,
    observacoes: l.notes,
    responsavel: l.created_by,
    registrado_em: l.created_at,
  }));
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="font-semibold">
        {manager ? "Relatórios e extrato por jogador" : "Histórico de recebimentos e estornos"}
      </h2>
      {manager && (
        <label className="flex flex-wrap items-center gap-2 text-sm">
          Jogador
          <select
            aria-label="Jogador do extrato"
            value={player}
            onChange={(e) => setPlayer(e.target.value)}
            className="rounded border bg-background p-2"
          >
            <option value="">Todos</option>
            {[...names].map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="flex flex-wrap gap-2 text-sm">
        {manager && (
          <button
            className="rounded border p-2"
            onClick={() =>
              download(
                [
                  ...Object.entries(summary ?? {})
                    .filter(([, value]) => typeof value === "number")
                    .map(([concept, value]) => ({ conceito: concept, centavos: value })),
                  ...Object.entries(summary?.by_category ?? {}).map(([category, value]) => ({
                    conceito: category,
                    centavos: value,
                  })),
                ],
                `relatorio-mensal-${month}.csv`,
              )
            }
          >
            Exportar relatório mensal
          </button>
        )}
        <button
          className="rounded border p-2"
          onClick={() => download(ledgerRows, `movimentacoes-${month}.csv`)}
        >
          Exportar movimentos de {month}
        </button>
        <button
          className="rounded border p-2"
          onClick={() =>
            download(
              rows.map((c) => ({
                jogador: names.get(c.player_id) || c.player_id,
                tipo: c.kind,
                descricao: c.description,
                cobrado_centavos: c.amount_cents,
                pago_centavos: c.paid_cents,
                saldo_centavos: c.outstanding_cents,
                vencimento: c.due_date,
                situacao: c.status,
              })),
              "extrato-cobrancas.csv",
            )
          }
        >
          Exportar extrato de cobranças
        </button>
        {manager && (
          <button
            className="rounded border p-2"
            onClick={() =>
              download(
                expenses
                  .filter((e) => e.incurred_on.startsWith(month))
                  .map((e) => ({
                    descricao: e.description,
                    categoria: e.category,
                    centavos: e.amount_cents,
                    data: e.incurred_on,
                    cancelada: !!e.cancelled_at,
                  })),
                `despesas-${month}.csv`,
              )
            }
          >
            Exportar despesas do mês
          </button>
        )}
      </div>
      {manager && (
        <details>
          <summary className="cursor-pointer font-medium">Inadimplentes ({overdue.size})</summary>
          {[...overdue].map(([id, total]) => (
            <p key={id} className="py-1 text-sm">
              {names.get(id) || "Jogador"}: {formatBRL(total)}
            </p>
          ))}
          {overdue.size === 0 && <p className="text-sm">Nenhuma cobrança vencida com saldo.</p>}
        </details>
      )}
      {player && (
        <div className="space-y-1 text-sm">
          {rows.map((c) => (
            <p key={c.id}>
              {c.description} · {c.due_date} · cobrado {formatBRL(c.amount_cents)} · recebido{" "}
              {formatBRL(c.paid_cents)} · saldo {formatBRL(c.outstanding_cents)}
              {c.status === "cancelled" ? " · Cancelada" : ""}
            </p>
          ))}
        </div>
      )}
      <details>
        <summary className="cursor-pointer font-medium">
          Movimentos efetivos de {month} ({movements.length})
        </summary>
        {movements.map((l) => (
          <article key={l.id} className="mt-2 border-t py-2 text-sm">
            <p>
              {l.occurred_on} · {l.entry_type} · {formatBRL(l.amount_cents)} · {l.method || "—"}
            </p>
            <p>{l.notes}</p>
            {manager && (
              <p className="text-xs text-muted-foreground">
                Responsável: {l.created_by} · registro{" "}
                {new Date(l.created_at).toLocaleString("pt-BR")}
              </p>
            )}
          </article>
        ))}
        {!movements.length && <p className="text-sm">Sem movimentações neste mês.</p>}
      </details>
    </section>
  );
}
