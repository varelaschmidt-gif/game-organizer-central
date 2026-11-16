import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { financeRpc } from "@/lib/finance-client";
import { readAllFinanceRows, requireMoneyCents } from "@/lib/finance-report";
import { formatBRL } from "@/lib/finance-view";

type Player = {
  id: string;
  name: string;
  nickname: string | null;
  participation_type: string;
  status?: string;
  is_event_guest?: boolean;
};
type Terms = {
  player_id: string;
  monthly_fee_cents: number | null;
  due_day: number | null;
  reason: string;
  updated_by: string;
  updated_at: string;
};
const db = supabase;

export function FinancePlayerTerms({
  venueId,
  players,
  supported,
}: {
  venueId: string;
  players: Player[];
  supported: boolean;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ player: "", amount: "", day: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const terms = useQuery({
    queryKey: ["finance-player-terms", venueId],
    enabled: supported,
    queryFn: async () => {
      const query = db
        .from("finance_player_terms")
        .select("*")
        .eq("venue_id", venueId)
        .order("player_id");
      const { data } = await readAllFinanceRows((from, to) => query.range(from, to));
      return data as Terms[];
    },
  });
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="font-semibold">Condições mensais por jogador</h2>
      <p className="text-sm text-muted-foreground">
        Campos vazios usam o padrão da quadra; valor zero isenta as próximas mensalidades. Cobranças
        já emitidas permanecem iguais. Toda alteração exige justificativa.
      </p>
      {!supported ? (
        <p className="text-sm">Disponível após a atualização financeira autorizada.</p>
      ) : (
        <>
          {terms.isError && (
            <p role="alert">Não foi possível consultar as condições individuais.</p>
          )}
          <form
            className="grid gap-3 md:grid-cols-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              setBusy(true);
              setMessage("");
              try {
                const { error } = await financeRpc("finance_save_player_terms", {
                  _player_id: form.player,
                  _monthly_fee_cents: form.amount === "" ? null : requireMoneyCents(form.amount),
                  _due_day: form.day === "" ? null : Number(form.day),
                  _reason: form.reason,
                });
                if (error) throw error;
                await qc.invalidateQueries({ queryKey: ["finance-player-terms", venueId] });
                setForm({ player: "", amount: "", day: "", reason: "" });
                setMessage("Condição salva para emissões futuras.");
              } catch (error) {
                setMessage(
                  error && typeof error === "object" && "message" in error
                    ? String(error.message)
                    : "Não foi possível salvar.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="grid gap-1 text-sm">
              Mensalista
              <select
                required
                className="rounded border bg-background p-2"
                value={form.player}
                onChange={(e) => {
                  const old = terms.data?.find((t) => t.player_id === e.target.value);
                  setForm({
                    player: e.target.value,
                    amount:
                      old?.monthly_fee_cents == null
                        ? ""
                        : (old.monthly_fee_cents / 100).toFixed(2),
                    day: old?.due_day == null ? "" : String(old.due_day),
                    reason: "",
                  });
                }}
              >
                <option value="">Selecione</option>
                {players
                  .filter(
                    (p) =>
                      p.status === "active" &&
                      p.participation_type === "mensalista" &&
                      !p.is_event_guest,
                  )
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nickname || p.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              Mensalidade específica (R$)
              <input
                className="rounded border bg-background p-2"
                inputMode="decimal"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </label>
            <label className="grid gap-1 text-sm">
              Vencimento específico
              <input
                className="rounded border bg-background p-2"
                type="number"
                min="1"
                max="28"
                value={form.day}
                onChange={(e) => setForm({ ...form, day: e.target.value })}
              />
            </label>
            <label className="grid gap-1 text-sm">
              Justificativa
              <input
                className="rounded border bg-background p-2"
                required
                minLength={3}
                maxLength={500}
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
              />
            </label>
            <button
              disabled={busy || terms.isError}
              className="rounded bg-primary p-2 text-primary-foreground"
            >
              Salvar condição
            </button>
          </form>
          {message && (
            <p role="status" className="text-sm">
              {message}
            </p>
          )}
          {terms.data?.map((t) => (
            <p key={t.player_id} className="text-sm">
              {players.find((p) => p.id === t.player_id)?.name || "Jogador"} ·{" "}
              {t.monthly_fee_cents == null ? "Valor padrão" : formatBRL(t.monthly_fee_cents)} ·{" "}
              {t.due_day == null ? "Vencimento padrão" : `Dia ${t.due_day}`} · {t.reason}
            </p>
          ))}
        </>
      )}
    </section>
  );
}
