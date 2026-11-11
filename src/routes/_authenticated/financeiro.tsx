import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { Download, RefreshCw, Wallet } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCourt, useActiveGroup } from "@/lib/groups";
import { EmptyState, LoadingState } from "@/components/states";
import { financeStatus, formatBRL, todaySaoPaulo } from "@/lib/finance-view";

export const Route = createFileRoute("/_authenticated/financeiro")({
  head: () => ({ meta: [{ title: "Financeiro | Rei da Quadra" }] }),
  component: FinancePage,
});

type Charge = {
  id: string; venue_id: string; group_id: string; player_id: string; kind: string;
  description: string; amount_cents: number; paid_cents: number; outstanding_cents: number;
  due_date: string; period: string | null; event_id: string | null; status: string;
};
type Player = { id: string; name: string; nickname: string | null; position: string | null; participation_type: string; is_event_guest?: boolean; status?: string };
type FinanceSettingsForm = {
  cost: string; capacity: string; monthlyFee: string; dailyFee: string; dueDay: string;
  pixType: string; pixKey: string; pixName: string; instructions: string;
  openingBalance: string; openingDate: string;
};
type FinanceData = {
  instructions: any; settings: any; summary: any; charges: Charge[]; players: Player[];
  expenses: any[]; ledger: any[]; closings: any[]; events: any[];
};
type FormEvent = React.FormEvent<HTMLFormElement>;

const db = supabase as any;
const today = todaySaoPaulo();
const currentMonth = today.slice(0, 7);

function newKey() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}
function cents(value: string) {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}
function idempotencyKey() {
  return newKey();
}
function isoDay() {
  return todaySaoPaulo();
}
function Panel({ title, children, className = "" }: { title?: string; children: React.ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-border bg-card p-4 shadow-sm md:p-5 ${className}`}>
    {title && <h2 className="mb-4 font-display text-lg font-bold">{title}</h2>}
    {children}
  </section>;
}
function Field({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return <label className="grid gap-1.5 text-sm text-muted-foreground">{label}
    <input {...props} className={`min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-foreground ${props.className ?? ""}`} />
  </label>;
}
function SelectField({ label, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1.5 text-sm text-muted-foreground">{label}
    <select {...props} className={`min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-foreground ${props.className ?? ""}`}>{children}</select>
  </label>;
}
function TextField({ label, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  return <label className="grid gap-1.5 text-sm text-muted-foreground">{label}
    <textarea {...props} className={`min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-foreground ${props.className ?? ""}`} />
  </label>;
}
function PrimaryButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${props.className ?? ""}`}>{children}</button>;
}
function SecondaryButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50 ${props.className ?? ""}`}>{children}</button>;
}
function monthStart(month: string) { return month ? `${month}-01` : today; }
function monthEnd(month: string) { const [y = 1970, m = 1] = month.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); }
function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function exportCsv(rows: Array<Record<string, unknown>>, fileName: string) {
  if (!rows.length) { toast.info("Não há dados para exportar."); return; }
  const keys = Object.keys(rows[0]);
  const csv = [keys.join(";"), ...rows.map((row) => keys.map((key) => {
    const value = String(row[key] ?? "").replaceAll('"', '""');
    return `"${value}"`;
  }).join(";"))].join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = fileName; anchor.click(); URL.revokeObjectURL(url);
}

function FinancePage() {
  const { group, can, isLoading: groupLoading } = useActiveGroup();
  const court = useActiveCourt(group?.id);
  const qc = useQueryClient();
  const manager = can("finance");
  const admin = group?.role === "admin";
  const [tab, setTab] = useState(manager ? "resumo" : "extrato");
  const [month, setMonth] = useState(currentMonth);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [settingsForm, setSettingsForm] = useState<FinanceSettingsForm>({ cost: "", capacity: "", monthlyFee: "", dailyFee: "", dueDay: "10", pixType: "", pixKey: "", pixName: "", instructions: "", openingBalance: "", openingDate: isoDay() });
  const [settingsInitialized, setSettingsInitialized] = useState(false);
  const [chargeForm, setChargeForm] = useState({ playerId: "", description: "", amount: "", dueDate: isoDay(), kind: "manual", eventId: "" });
  const [expenseForm, setExpenseForm] = useState({ description: "", category: "", incurredOn: isoDay(), dueOn: "", amount: "", notes: "", paidOn: "" });
  const [splitForm, setSplitForm] = useState({ expenseId: "", target: "monthly", mode: "equal", dueDate: isoDay(), eventId: "", playerIds: [] as string[] });
  const [dailyForm, setDailyForm] = useState({ eventId: "", amount: "" });
  const [paymentInputs, setPaymentInputs] = useState<Record<string, { amount: string; method: string; date: string; notes: string }>>({});
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({});
  const [chargeFilter, setChargeFilter] = useState("all");
  const [chargeSearch, setChargeSearch] = useState("");
  const [adjustmentForm, setAdjustmentForm] = useState({ amount: "", date: isoDay(), reason: "" });
  const [periodReason, setPeriodReason] = useState("");
  const [requestKeys, setRequestKeys] = useState<Record<string, string>>({});
  function getRequestKey(scope: string) {
    const existing = requestKeys[scope];
    if (existing) return existing;
    const created = idempotencyKey();
    setRequestKeys((current) => ({ ...current, [scope]: created }));
    return created;
  }
  function renewRequestKey(scope: string) {
    setRequestKeys((current) => ({ ...current, [scope]: idempotencyKey() }));
  }
  useEffect(() => { setTab(manager ? "resumo" : "extrato"); }, [manager]);

  const selfPlayer = useQuery({
    queryKey: ["finance-self-player", group?.id, court.venue?.id],
    enabled: !!group && !!court.venue,
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return null;
      const { data, error } = await db.from("players").select("id,name,nickname,position,participation_type,is_event_guest,status")
        .eq("group_id", group!.id).eq("venue_id", court.venue!.id).eq("user_id", userData.user.id).maybeSingle();
      if (error) throw error;
      return data as Player | null;
    },
  });

  const finance = useQuery<FinanceData>({
    queryKey: ["finance-data", group?.id, court.venue?.id, manager, selfPlayer.data?.id, month],
    enabled: !!group && !!court.venue && (!manager ? selfPlayer.isFetched : true),
    queryFn: async () => {
      const venueId = court.venue!.id;
      const instructionResult = await db.rpc("finance_get_instructions", { _venue_id: venueId });
      if (instructionResult.error) throw instructionResult.error;
      const instructions = instructionResult.data ?? {};
      if (!manager) {
        const playerId = selfPlayer.data?.id;
        if (!playerId) return { instructions, settings: null, summary: null, charges: [], players: [], expenses: [], ledger: [], closings: [], events: [] };
      }
      const chargeQuery = db.from("finance_charge_balances").select("*").eq("venue_id", venueId).order("due_date", { ascending: true });
      if (!manager) chargeQuery.eq("player_id", selfPlayer.data!.id);
      const [chargeResult, playersResult, settingsResult, summaryResult, expensesResult, ledgerResult, closingResult, eventResult] = await Promise.all([
        chargeQuery,
        manager ? db.from("players").select("id,name,nickname,position,participation_type,is_event_guest").eq("group_id", group!.id).eq("venue_id", venueId).order("name") : Promise.resolve({ data: [], error: null }),
        manager ? db.from("finance_settings").select("*").eq("venue_id", venueId).maybeSingle() : Promise.resolve({ data: null, error: null }),
        manager ? db.rpc("finance_summary", { _venue_id: venueId, _from: monthStart(month), _to: monthEnd(month) }) : Promise.resolve({ data: null, error: null }),
        manager ? db.from("finance_expenses").select("*").eq("venue_id", venueId).order("incurred_on", { ascending: false }) : Promise.resolve({ data: [], error: null }),
        manager ? db.from("finance_ledger").select("*").eq("venue_id", venueId).order("occurred_on", { ascending: false }).limit(250) : Promise.resolve({ data: [], error: null }),
        manager ? db.from("finance_month_closings").select("*").eq("venue_id", venueId).order("period", { ascending: false }).limit(12) : Promise.resolve({ data: [], error: null }),
        manager ? db.from("events").select("id,title,starts_at,daily_fee_cents,status").eq("group_id", group!.id).eq("venue_id", venueId).order("starts_at", { ascending: false }).limit(50) : Promise.resolve({ data: [], error: null }),
      ]);
      for (const result of [chargeResult, playersResult, settingsResult, summaryResult, expensesResult, ledgerResult, closingResult, eventResult]) {
        if (result.error) throw result.error;
      }
      const settings = settingsResult.data;
      return {
        instructions, settings, summary: summaryResult.data, charges: chargeResult.data ?? [],
        players: playersResult.data ?? [], expenses: expensesResult.data ?? [], ledger: ledgerResult.data ?? [],
        closings: closingResult.data ?? [], events: eventResult.data ?? [],
      } as FinanceData;
    },
  });

  const settingsData = finance.data?.settings;
  useEffect(() => {
    if (!settingsData || settingsInitialized) return;
    setSettingsForm({
      cost: (Number(settingsData.monthly_court_cost_cents ?? 0) / 100).toFixed(2),
      capacity: String(settingsData.monthly_capacity ?? 0),
      monthlyFee: (Number(settingsData.monthly_fee_cents ?? 0) / 100).toFixed(2),
      dailyFee: (Number(settingsData.daily_fee_cents ?? 0) / 100).toFixed(2),
      dueDay: String(settingsData.due_day ?? 10), pixType: settingsData.pix_key_type ?? "",
      pixKey: settingsData.pix_key ?? "", pixName: settingsData.pix_receiver_name ?? "",
      instructions: settingsData.payment_instructions ?? "",
      openingBalance: (Number(settingsData.opening_balance_cents ?? 0) / 100).toFixed(2),
      openingDate: settingsData.opening_balance_date ?? isoDay(),
    });
    setSettingsInitialized(true);
  }, [settingsData, settingsInitialized]);
  const instructions = finance.data?.instructions ?? {};
  const charges = finance.data?.charges ?? [];
  const players = finance.data?.players ?? [];
  const names = useMemo(() => new Map(players.map((p) => [p.id, p.nickname || p.name])), [players]);
  const monthlyCount = players.filter((p) => p.status === "active" && p.participation_type === "mensalista" && p.is_event_guest !== true).length;
  const cost = Number(finance.data?.settings?.monthly_court_cost_cents ?? 0);
  const activeShare = monthlyCount > 0 ? Math.ceil(cost / monthlyCount) : null;
  const capacity = Number(finance.data?.settings?.monthly_capacity ?? 0);
  const capacityShare = capacity > 0 ? Math.ceil(cost / capacity) : null;

  async function mutate(action: () => Promise<unknown>, success: string, refresh = true) {
    setBusy(true); setMessage("");
    try {
      await action();
      toast.success(success);
      if (refresh) await qc.invalidateQueries({ queryKey: ["finance-data"] });
      return true;
    } catch (error) {
      const text = error instanceof Error ? error.message : "Não foi possível concluir a ação.";
      setMessage(text);
      toast.error(text);
      return false;
    } finally { setBusy(false); }
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    if (!court.venue) return;
    const payload = {
      monthly_court_cost_cents: cents(settingsForm.cost ?? "0"),
      monthly_capacity: Number(settingsForm.capacity ?? "0"),
      monthly_fee_cents: cents(settingsForm.monthlyFee ?? "0"),
      daily_fee_cents: cents(settingsForm.dailyFee ?? "0"),
      due_day: Number(settingsForm.dueDay ?? "10"),
      pix_key_type: settingsForm.pixType || null,
      pix_key: settingsForm.pixKey || null,
      pix_receiver_name: settingsForm.pixName || null,
      payment_instructions: settingsForm.instructions || null,
      opening_balance_cents: cents(settingsForm.openingBalance ?? "0"),
      opening_balance_date: settingsForm.openingDate || isoDay(),
    };
    const ok = await mutate(async () => {
      const { error } = await db.rpc("finance_save_settings", { _venue_id: court.venue!.id, _s: payload });
      if (error) throw error;
    }, "Configurações financeiras salvas.");
    
  }

  async function createManualCharge(event: FormEvent) {
    event.preventDefault();
    if (!court.venue || !chargeForm.playerId) return;
    const key = getRequestKey("charge-create");
    const ok = await mutate(async () => {
      const { error } = await db.rpc("finance_create_charge", {
        _venue_id: court.venue!.id, _player_id: chargeForm.playerId, _kind: chargeForm.kind,
        _description: chargeForm.description, _amount_cents: chargeForm.amount ? cents(chargeForm.amount) : null,
        _due_date: chargeForm.dueDate, _event_id: chargeForm.kind === "daily" ? chargeForm.eventId || null : null, _idempotency_key: key,
      });
      if (error) throw error;
    }, "Cobrança criada.");
    if (ok) { setChargeForm({ playerId: "", description: "", amount: "", dueDate: isoDay(), kind: "manual", eventId: "" }); renewRequestKey("charge-create"); }
  }

  async function recordPayment(charge: Charge) {
    const input = paymentInputs[charge.id];
    if (!input) return;
    const key = getRequestKey(`charge-payment:${charge.id}`);
    const ok = await mutate(async () => {
      const { error } = await db.rpc("finance_record_payment", {
        _charge_id: charge.id, _amount_cents: cents(input.amount), _method: input.method,
        _received_on: input.date, _notes: input.notes || null, _idempotency_key: key,
      });
      if (error) throw error;
    }, "Pagamento registrado.");
    if (ok) { setPaymentInputs((v) => ({ ...v, [charge.id]: { amount: "", method: "pix", date: isoDay(), notes: "" } })); renewRequestKey(`charge-payment:${charge.id}`); }
  }

  async function addExpense(event: FormEvent) {
    event.preventDefault();
    if (!court.venue) return;
    const key = getRequestKey("expense-create");
    const ok = await mutate(async () => {
      const { data: id, error } = await db.rpc("finance_record_expense", {
        _venue_id: court.venue!.id, _description: expenseForm.description,
        _category: expenseForm.category, _incurred_on: expenseForm.incurredOn,
        _due_on: expenseForm.dueOn || null, _amount_cents: cents(expenseForm.amount),
        _paid_on: expenseForm.paidOn || null, _notes: expenseForm.notes || null, _idempotency_key: key,
      });
      if (error) throw error;
      if (splitForm.target && splitForm.target !== "none") {
        const { error: splitError } = await db.rpc("finance_split_expense", {
          _expense_id: id, _target: splitForm.target, _mode: splitForm.mode,
          _player_ids: splitForm.target === "selected" ? splitForm.playerIds : null,
          _amounts: splitForm.mode === "custom" ? splitForm.playerIds.map((id) => cents(customAmounts[id] ?? "0")) : null, _event_id: splitForm.target === "event" ? splitForm.eventId || null : null,
          _due_date: splitForm.dueDate,
        });
        if (splitError) throw splitError;
      }
    }, "Despesa registrada.");
    if (ok) {
      setExpenseForm({ description: "", category: "", incurredOn: isoDay(), dueOn: "", amount: "", notes: "", paidOn: "" });
      setSplitForm({ expenseId: "", target: "monthly", mode: "equal", dueDate: isoDay(), eventId: "", playerIds: [] });
      setCustomAmounts({});
      renewRequestKey("expense-create");
    }
  }

  async function setEventDailyFee(event: FormEvent) {
    event.preventDefault();
    if (!dailyForm.eventId) return;
    const ok = await mutate(async () => {
      const { error } = await db.rpc("finance_set_event_daily_fee", {
        _event_id: dailyForm.eventId, _cents: cents(dailyForm.amount),
      });
      if (error) throw error;
    }, "Diária do evento atualizada.");
    if (ok) setDailyForm({ eventId: "", amount: "" });
  }

  async function markExpensePaid(expenseId: string) {
    const ok = await mutate(async () => {
      const { error } = await db.rpc("finance_pay_expense", { _expense_id: expenseId, _paid_on: isoDay(), _idempotency_key: getRequestKey(`expense-payment:${expenseId}`) });
      if (error) throw error;
    }, "Despesa marcada como paga.");
    if (ok) renewRequestKey(`expense-payment:${expenseId}`);
  }

  async function adjustBalance(event: FormEvent) {
    event.preventDefault();
    if (!court.venue) return;
    const ok = await mutate(async () => {
      const { error } = await db.rpc("finance_adjust_balance", { _venue_id: court.venue!.id, _amount_cents: cents(adjustmentForm.amount), _occurred_on: adjustmentForm.date, _reason: adjustmentForm.reason, _idempotency_key: getRequestKey("cash-adjustment") });
      if (error) throw error;
    }, "Ajuste auditável registrado.");
    if (ok) { setAdjustmentForm({ amount: "", date: isoDay(), reason: "" }); renewRequestKey("cash-adjustment"); }
  }

  async function reverseEntry(entryId: string) {
    const reason = window.prompt("Motivo do estorno (mínimo 3 caracteres):");
    if (!reason) return;
    const key = getRequestKey(`ledger-reversal:${entryId}`);
    const ok = await mutate(async () => {
      const { error } = await db.rpc("finance_reverse_entry", { _entry_id: entryId, _reason: reason, _idempotency_key: key });
      if (error) throw error;
    }, "Estorno registrado.");
    if (ok) renewRequestKey(`ledger-reversal:${entryId}`);
  }

  const filteredCharges = charges.filter((c) => {
    const state = financeStatus(c.due_date, Number(c.outstanding_cents ?? 0), c.status);
    const matchStatus = chargeFilter === "all" || (chargeFilter === "overdue" && state.tone === "danger" && c.outstanding_cents > 0) || (chargeFilter === "open" && state.tone === "warning" && c.outstanding_cents > 0) || (chargeFilter === "paid" && c.outstanding_cents <= 0);
    const matchSearch = !chargeSearch || `${names.get(c.player_id) ?? ""} ${c.description}`.toLowerCase().includes(chargeSearch.toLowerCase());
    return matchStatus && matchSearch;
  });

  const activeTabs: [string, string][] = manager
    ? [["resumo", "Resumo"], ["cobrancas", "Cobranças"], ["despesas", "Despesas"], ["config", "Configurações"]]
    : [["extrato", "Meu extrato"]];

  if (groupLoading || court.isLoading || selfPlayer.isLoading) return <LoadingState />;
  if (!group) return <EmptyState title="Você ainda não participa de uma quadra" />;
  if (!court.venue) return <EmptyState title="Selecione uma quadra para ver o financeiro" />;
  if (finance.isLoading) return <LoadingState />;
  if (finance.error) return <div className="mx-auto max-w-3xl space-y-5">
    <h1 className="font-display text-3xl font-bold">Financeiro</h1>
    <Panel title="Módulo aguardando ativação do banco">
      <p className="text-sm text-muted-foreground">O código e a migration foram preparados, mas a migration ainda não foi aplicada ao banco desta aplicação. Depois da revisão e aprovação da mudança no banco, esta área carregará os dados da quadra.</p>
      <p className="mt-3 text-xs text-muted-foreground">{finance.error instanceof Error ? finance.error.message : "Banco de dados indisponível"}</p>
    </Panel>
  </div>;

  if (!manager && !selfPlayer.data) return <EmptyState title="Seu perfil ainda não está vinculado a esta quadra" description="Peça ao administrador para vincular seu cadastro de jogador." />;

  const settings = finance.data?.settings;
  const instruction = instructions;
  const overdueCount = charges.filter((c) => c.status === "open" && c.outstanding_cents > 0 && c.due_date < today).length;
  const outstandingTotal = charges.reduce((sum, c) => sum + Number(c.outstanding_cents ?? 0), 0);
  const paidTotal = charges.reduce((sum, c) => sum + Number(c.paid_cents ?? 0), 0);
  const expenses = finance.data?.expenses ?? [];
  const ledger = finance.data?.ledger ?? [];
  const expensePendingTotal = expenses.reduce((sum, expense) => {
    const paid = -ledger.filter((entry) => entry.expense_id === expense.id && ["expense", "expense_reversal"].includes(entry.entry_type)).reduce((total, entry) => total + Number(entry.amount_cents), 0);
    return sum + Math.max(0, Number(expense.amount_cents) - paid);
  }, 0);
  const currentClosing = (finance.data?.closings ?? []).find((item: any) => item.period === monthStart(month));
  const managerTabs = () => <div className="flex w-full gap-1 overflow-x-auto rounded-lg border border-border bg-muted/40 p-1">
    {activeTabs.map(([key, label]) => <button key={key} onClick={() => setTab(key)} className={`shrink-0 rounded-md px-3 py-2 text-sm font-medium ${tab === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-background"}`}>{label}</button>)}
  </div>;
  const playerStatement = () => <div className="space-y-4">
    <Panel title="Sua situação">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="font-semibold">{selfPlayer.data?.nickname || selfPlayer.data?.name}</p><p className="text-sm text-muted-foreground">{charges.length} cobranças no histórico</p></div>
        {overdueCount > 0
          ? <span className="rounded-full bg-destructive/15 px-3 py-1 text-sm font-semibold text-destructive">Atraso · {overdueCount} cobrança(s)</span>
          : outstandingTotal === 0
            ? <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-sm font-semibold text-emerald-600">Pago</span>
            : <span className="rounded-full bg-amber-500/15 px-3 py-1 text-sm font-semibold text-amber-600">{financeStatus(charges[0]?.due_date ?? today, Number(charges[0]?.outstanding_cents ?? 0), charges[0]?.status).label}</span>}
      </div>
      {instruction.pix_key && <div className="mt-4 rounded-lg bg-muted/50 p-3 text-sm">
        <p className="font-semibold">Pagamento por Pix para {instruction.pix_receiver_name || "o administrador"}</p>
        <p className="mt-1 break-all">Chave: {instruction.pix_key}</p>
        {instruction.payment_instructions && <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{instruction.payment_instructions}</p>}
        <p className="mt-2 text-xs text-muted-foreground">O pagamento é conferido manualmente pelo administrador. O aplicativo ainda não gera cobrança Pix.</p>
      </div>}
    </Panel>
    <Panel title="Cobranças e pagamentos">
      <ChargeList charges={charges} names={names} manager={false} paymentInputs={paymentInputs} setPaymentInputs={setPaymentInputs} onPayment={recordPayment} busy={busy} />
    </Panel>
  </div>;

  return <div className="mx-auto max-w-6xl space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="flex items-center gap-2"><Wallet className="h-6 w-6 text-primary" /><h1 className="font-display text-3xl font-bold">Financeiro</h1></div>
        <p className="mt-1 text-sm text-muted-foreground">{court.venue.name} · caixa e cobranças desta quadra</p></div>
      {manager && <label className="text-sm text-muted-foreground">Mês de referência<input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="ml-2 min-h-10 rounded-md border border-input bg-background px-3 text-foreground" /></label>}
    </div>
    {managerTabs()}
    {message && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{message}</div>}
    {tab === "extrato" && playerStatement()}
    {tab === "resumo" && manager && <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi title="Saldo atual" value={formatBRL(Number(finance.data?.summary?.balance_cents ?? 0))} />
        <Kpi title="A receber" value={formatBRL(Number(finance.data?.summary?.receivable_cents ?? 0))} />
        <Kpi title="Em atraso" value={formatBRL(Number(finance.data?.summary?.overdue_cents ?? 0))} tone="danger" />\n        <Kpi title="Despesas pendentes" value={formatBRL(expensePendingTotal)} />
        <Kpi title="Movimento no mês" value={`+${formatBRL(Number(finance.data?.summary?.period_in_cents ?? 0))} / −${formatBRL(Math.abs(Number(finance.data?.summary?.period_out_cents ?? 0))) }`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Mensalidades">
          <p className="text-sm text-muted-foreground">Gerar cobranças abertas apenas para mensalistas ativos no mês atual. A operação pode ser repetida sem duplicar cobranças.</p>
          <p className="mt-2 text-2xl font-bold">{players.filter((p) => p.participation_type === "mensalista" && p.is_event_guest !== true).length} mensalistas ativos</p>
          <p className="text-sm">Valor atual por pessoa: {formatBRL(Number(settings?.monthly_fee_cents ?? 0))}</p>
          <PrimaryButton disabled={busy || !settings?.monthly_fee_cents} className="mt-4" onClick={() => mutate(async () => {
            const { data, error } = await db.rpc("finance_generate_monthly", { _venue_id: court.venue!.id, _period: monthStart(currentMonth) });
            if (error) throw error;
            toast.info(`${data ?? 0} cobrança(s) nova(s)`);
          }, "Geração mensal concluída.")}><RefreshCw className="h-4 w-4" /> Gerar cobranças do mês</PrimaryButton>
        </Panel>
        <Panel title="Resumo por categoria">\n        <div className="flex flex-wrap gap-2">{Object.entries((finance.data?.summary?.by_category ?? {}) as Record<string, number>).length ? Object.entries(finance.data?.summary?.by_category ?? {}).map(([category, value]) => <span key={category} className="rounded-full bg-muted px-3 py-1 text-sm">{category}: {formatBRL(Number(value))}</span>) : <p className="text-sm text-muted-foreground">Sem movimentações no período.</p>}</div>\n      </Panel>\n      <Panel title="Situação das cobranças">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Cobranças</p><p className="text-xl font-bold">{charges.length}</p></div>
            <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Jogadores em atraso</p><p className="text-xl font-bold text-destructive">{new Set(charges.filter((c) => c.status === "open" && c.outstanding_cents > 0 && c.due_date < today).map((c) => c.player_id)).size}</p></div>
            <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Recebido no período</p><p className="font-bold">{formatBRL(Number(finance.data?.summary?.period_in_cents ?? 0))}</p></div>
            <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Despesas pagas</p><p className="font-bold">{formatBRL(Math.abs(Number(finance.data?.summary?.period_out_cents ?? 0)))}</p></div>
          </div>
        </Panel>
      </div>
      <Panel title="Cobranças recentes">
        <ChargeList charges={charges.slice(0, 8)} names={names} manager={false} paymentInputs={paymentInputs} setPaymentInputs={setPaymentInputs} onPayment={recordPayment} busy={busy} />
        <SecondaryButton className="mt-3" onClick={() => setTab("cobrancas")}>Ver todas as cobranças</SecondaryButton>
      </Panel>
      <Panel title="Fechamento mensal">
        <p className="text-sm text-muted-foreground">Receitas e despesas são consideradas pela data real em que foram pagas. Só meses encerrados podem ser fechados.</p>\n        {currentClosing && <p className="mt-2 text-sm">Situação de {month}: <strong>{currentClosing.status === "closed" ? "Fechado" : "Reaberto"}</strong> · {currentClosing.closed_at ? new Date(currentClosing.closed_at).toLocaleString("pt-BR") : ""}{currentClosing.reopen_reason ? ` · Motivo da reabertura: ${currentClosing.reopen_reason}` : ""}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <PrimaryButton disabled={busy || month >= currentMonth} onClick={() => mutate(async () => {
            const { error } = await db.rpc("finance_close_month", { _venue_id: court.venue!.id, _period: monthStart(month) });
            if (error) throw error;
          }, "Mês fechado.")}>Fechar {month}</PrimaryButton>
          {admin && <div className="flex min-w-64 flex-1 gap-2">
            <input value={periodReason} onChange={(e) => setPeriodReason(e.target.value)} placeholder="Motivo para reabrir" className="min-h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm" />
            <SecondaryButton disabled={busy || !periodReason.trim()} onClick={() => mutate(async () => {
              const { error } = await db.rpc("finance_reopen_month", { _venue_id: court.venue!.id, _period: monthStart(month), _reason: periodReason });
              if (error) throw error;
            }, "Mês reaberto.")}>Reabrir</SecondaryButton>
          </div>}
        </div>
      </Panel>
    </div>}
    {tab === "cobrancas" && manager && <div className="space-y-4">
      <Panel title="Nova cobrança manual">
        <form onSubmit={createManualCharge} className="grid gap-3 md:grid-cols-2 lg:grid-cols-6">
          <SelectField label="Jogador" required value={chargeForm.playerId} onChange={(e) => setChargeForm({ ...chargeForm, playerId: e.target.value })}>
            <option value="">Selecionar</option>{players.filter((p) => p.status === "active" && !p.is_event_guest && p.participation_type !== "convidado" && (chargeForm.kind !== "daily" || p.participation_type === "avulso")).map((p) => <option key={p.id} value={p.id}>{p.nickname || p.name}</option>)}
          </SelectField>
          <SelectField label="Tipo" value={chargeForm.kind} onChange={(e) => setChargeForm({ ...chargeForm, kind: e.target.value, description: e.target.value === "daily" ? "Diária" : chargeForm.description })}><option value="manual">Cobrança manual</option><option value="daily">Diária de avulso</option></SelectField>\n          {chargeForm.kind === "daily" && <SelectField label="Evento" required value={chargeForm.eventId} onChange={(e) => setChargeForm({ ...chargeForm, eventId: e.target.value })}><option value="">Selecionar</option>{(finance.data?.events ?? []).map((e: any) => <option key={e.id} value={e.id}>{e.title} · {new Date(e.starts_at).toLocaleDateString("pt-BR")}</option>)}</SelectField>}
          <Field label="Descrição" required value={chargeForm.description} onChange={(e) => setChargeForm({ ...chargeForm, description: e.target.value })} />
          <Field label={chargeForm.kind === "daily" ? "Valor (R$), vazio usa a diária do evento" : "Valor (R$)"} inputMode="decimal" required={chargeForm.kind === "manual"} value={chargeForm.amount} onChange={(e) => setChargeForm({ ...chargeForm, amount: e.target.value })} />
          <Field label="Vencimento" type="date" required value={chargeForm.dueDate} onChange={(e) => setChargeForm({ ...chargeForm, dueDate: e.target.value })} />
          <PrimaryButton disabled={busy} type="submit">Criar cobrança</PrimaryButton>
        </form>
      </Panel>
      <Panel title="Cobranças e inadimplência">
        <div className="mb-3 grid gap-2 md:grid-cols-[1fr_200px_auto]">
          <input value={chargeSearch} onChange={(e) => setChargeSearch(e.target.value)} placeholder="Buscar jogador ou cobrança" className="min-h-10 rounded-md border border-input bg-background px-3 text-sm" />
          <select value={chargeFilter} onChange={(e) => setChargeFilter(e.target.value)} className="min-h-10 rounded-md border border-input bg-background px-3 text-sm"><option value="all">Todas</option><option value="overdue">Em atraso</option><option value="open">Em aberto</option><option value="paid">Pagas</option></select>
          <SecondaryButton onClick={() => exportCsv(filteredCharges.map((c) => ({ jogador: names.get(c.player_id) || c.player_id, tipo: c.kind, descricao: c.description, valor: formatBRL(c.amount_cents), pago: formatBRL(c.paid_cents), saldo: formatBRL(c.outstanding_cents), vencimento: c.due_date, situacao: financeStatus(c.due_date, c.outstanding_cents, c.status).label })), `cobrancas-${court.venue.name}.csv`)}><Download className="h-4 w-4" /> Exportar CSV</SecondaryButton>
        </div>
        <ChargeList charges={filteredCharges} names={names} manager paymentInputs={paymentInputs} setPaymentInputs={setPaymentInputs} onPayment={recordPayment} busy={busy} />
      </Panel>
      <Panel title="Diária por evento">
        <form onSubmit={setEventDailyFee} className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <SelectField label="Evento" required value={dailyForm.eventId} onChange={(e) => setDailyForm({ ...dailyForm, eventId: e.target.value })}>
            <option value="">Selecionar evento</option>{(finance.data?.events ?? []).filter((e: any) => e.status === "scheduled").map((e: any) => <option key={e.id} value={e.id}>{e.title} · {new Date(e.starts_at).toLocaleDateString("pt-BR")}</option>)}
          </SelectField>
          <Field label="Diária de avulso (R$)" inputMode="decimal" required value={dailyForm.amount} onChange={(e) => setDailyForm({ ...dailyForm, amount: e.target.value })} />
          <PrimaryButton disabled={busy} type="submit">Salvar diária</PrimaryButton>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">Mensalistas não pagam diária; convidados são isentos. O avulso precisa estar pago para confirmar presença.</p>
      </Panel>
    </div>}
    {tab === "despesas" && manager && <div className="space-y-4">
      <Panel title="Lançar despesa">
        <form onSubmit={addExpense} className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Descrição" required value={expenseForm.description} onChange={(e) => setExpenseForm({ ...expenseForm, description: e.target.value })} />
            <Field label="Categoria" required value={expenseForm.category} onChange={(e) => setExpenseForm({ ...expenseForm, category: e.target.value })} />
            <Field label="Valor total (R$)" required inputMode="decimal" value={expenseForm.amount} onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })} />
            <Field label="Data da despesa" type="date" required value={expenseForm.incurredOn} onChange={(e) => setExpenseForm({ ...expenseForm, incurredOn: e.target.value })} />
            <Field label="Vencimento do rateio" type="date" value={splitForm.dueDate} onChange={(e) => setSplitForm({ ...splitForm, dueDate: e.target.value })} />
            <Field label="Data de pagamento (opcional)" type="date" value={expenseForm.paidOn} onChange={(e) => setExpenseForm({ ...expenseForm, paidOn: e.target.value })} />
          </div>
          <TextField label="Observações" value={expenseForm.notes} onChange={(e) => setExpenseForm({ ...expenseForm, notes: e.target.value })} />
          <div className="grid gap-3 rounded-lg border border-border p-3 md:grid-cols-3">
            <SelectField label="Rateio" value={splitForm.target} onChange={(e) => setSplitForm({ ...splitForm, target: e.target.value })}>
              <option value="none">Sem rateio</option><option value="monthly">Mensalistas ativos</option><option value="selected">Jogadores selecionados</option><option value="event">Quem compareceu a evento</option>
            </SelectField>
            <SelectField label="Divisão" value={splitForm.mode} onChange={(e) => setSplitForm({ ...splitForm, mode: e.target.value })}>
              <option value="equal">Valores iguais</option><option value="custom" disabled={splitForm.target !== "selected"}>Valores personalizados</option>
            </SelectField>
            {splitForm.target === "event" && <SelectField label="Evento" value={splitForm.eventId} onChange={(e) => setSplitForm({ ...splitForm, eventId: e.target.value })}>
              <option value="">Selecionar</option>{(finance.data?.events ?? []).map((e: any) => <option key={e.id} value={e.id}>{e.title} · {new Date(e.starts_at).toLocaleDateString("pt-BR")}</option>)}
            </SelectField>}
          </div>
          {splitForm.target === "selected" && <div className="max-h-44 overflow-auto rounded-lg border border-border p-3">
            <p className="mb-2 text-sm font-semibold">Jogadores elegíveis para o rateio</p>
            {players.filter((p) => !p.is_event_guest && p.participation_type !== "convidado").map((p) => <label key={p.id} className="flex items-center gap-2 py-1 text-sm">
              <input type="checkbox" checked={splitForm.playerIds.includes(p.id)} onChange={(e) => setSplitForm({ ...splitForm, playerIds: e.target.checked ? [...splitForm.playerIds, p.id] : splitForm.playerIds.filter((id) => id !== p.id) })} />
              {p.nickname || p.name}
              {splitForm.mode === "custom" && <input aria-label={`Valor da parcela de ${p.nickname || p.name}`} inputMode="decimal" placeholder="R$ da parcela" value={customAmounts[p.id] ?? ""} onChange={(e) => setCustomAmounts({ ...customAmounts, [p.id]: e.target.value })} className="ml-auto w-28 rounded-md border border-input bg-background px-2 py-1" />}
            </label>)}
          </div>}
          <PrimaryButton disabled={busy} type="submit">Salvar despesa{splitForm.target !== "none" ? " e rateio" : ""}</PrimaryButton>
        </form>
      </Panel>
      <Panel title="Despesas e parcelas">
        <div className="mb-3 flex justify-end"><SecondaryButton onClick={() => exportCsv(expenses.map((e) => ({ descricao: e.description, categoria: e.category, data: e.incurred_on, vencimento: e.due_on ?? "", total: formatBRL(e.amount_cents), dividido: e.split_at ? "Sim" : "Não" })), `despesas-${court.venue.name}.csv`)}><Download className="h-4 w-4" /> Exportar CSV</SecondaryButton></div>
        {expenses.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma despesa cadastrada.</p> : <div className="space-y-2">
          {expenses.map((e: any) => {
            const paid = -ledger.filter((l: any) => l.expense_id === e.id && ["expense", "expense_reversal"].includes(l.entry_type)).reduce((sum: number, l: any) => sum + Number(l.amount_cents), 0);
            return <article key={e.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap justify-between gap-2"><div><p className="font-semibold">{e.description}</p><p className="text-sm text-muted-foreground">{e.category} · {e.incurred_on}{e.split_at ? " · Rateada" : ""} · {paid >= e.amount_cents ? "Paga" : "Pendente"}</p></div><p className="font-bold">{formatBRL(e.amount_cents)}</p></div>
              {paid < e.amount_cents && <SecondaryButton className="mt-2" disabled={busy} onClick={() => markExpensePaid(e.id)}>Registrar pagamento integral</SecondaryButton>}
            </article>;
          })}
        </div>}
      </Panel>
      <Panel title="Ajuste auditável do caixa"><form onSubmit={adjustBalance} className="grid gap-2 md:grid-cols-[1fr_1fr_2fr_auto]"><Field label="Valor (R$), positivo ou negativo" inputMode="decimal" required value={adjustmentForm.amount} onChange={(e) => setAdjustmentForm({ ...adjustmentForm, amount: e.target.value })} /><Field label="Data" type="date" required value={adjustmentForm.date} onChange={(e) => setAdjustmentForm({ ...adjustmentForm, date: e.target.value })} /><Field label="Motivo" required minLength={3} value={adjustmentForm.reason} onChange={(e) => setAdjustmentForm({ ...adjustmentForm, reason: e.target.value })} /><PrimaryButton disabled={busy} type="submit">Registrar ajuste</PrimaryButton></form></Panel>
      <Panel title="Movimentações do caixa"><LedgerList rows={ledger} players={names} onReverse={reverseEntry} /></Panel>
    </div>}
    {tab === "config" && manager && <div className="space-y-4">
      <Panel title="Configurações financeiras desta quadra">
        <form onSubmit={saveSettings} className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Custo mensal da quadra (R$)" inputMode="decimal" value={settingsForm.cost ?? ""} onChange={(e) => setSettingsForm({ ...settingsForm, cost: e.target.value })} />
            <Field label="Capacidade de mensalistas" type="number" min="0" value={settingsForm.capacity ?? ""} onChange={(e) => setSettingsForm({ ...settingsForm, capacity: e.target.value })} />
            <Field label="Valor mensal efetivo por jogador (R$)" inputMode="decimal" value={settingsForm.monthlyFee ?? ""} onChange={(e) => setSettingsForm({ ...settingsForm, monthlyFee: e.target.value })} />
          </div>
          <div className="grid gap-3 rounded-lg bg-muted/40 p-3 text-sm md:grid-cols-2">
            <div>Custo dividido pelos {monthlyCount} mensalistas ativos: <strong>{activeShare == null ? "—" : formatBRL(activeShare)}</strong></div>
            <div>Custo dividido pela capacidade ({capacity || 0}): <strong>{capacityShare == null ? "—" : formatBRL(capacityShare)}</strong></div>
          </div>
          <p className="text-xs text-muted-foreground">Esses valores são apenas referências. O valor efetivo é escolhido pelo administrador e mudanças afetam cobranças futuras, sem alterar o histórico.</p>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Diária padrão de avulso (R$)" inputMode="decimal" value={settingsForm.dailyFee ?? ""} onChange={(e) => setSettingsForm({ ...settingsForm, dailyFee: e.target.value })} />
            <Field label="Dia do vencimento (1 a 28)" type="number" min="1" max="28" value={settingsForm.dueDay ?? ""} onChange={(e) => setSettingsForm({ ...settingsForm, dueDay: e.target.value })} />
            <Field label="Chave Pix" value={settingsForm.pixKey ?? ""} onChange={(e) => setSettingsForm({ ...settingsForm, pixKey: e.target.value })} />
            <SelectField label="Tipo da chave Pix" value={settingsForm.pixType ?? ""} onChange={(e) => setSettingsForm({ ...settingsForm, pixType: e.target.value })}>
              <option value="">Não definido</option><option value="cpf">CPF</option><option value="cnpj">CNPJ</option><option value="email">E-mail</option><option value="telefone">Telefone</option><option value="aleatoria">Aleatória</option>
            </SelectField>
            <Field label="Nome do recebedor" value={settingsForm.pixName ?? ""} onChange={(e) => setSettingsForm({ ...settingsForm, pixName: e.target.value })} />
          </div>
          <TextField label="Instruções para pagamento" value={settingsForm.instructions ?? ""} onChange={(e) => setSettingsForm({ ...settingsForm, instructions: e.target.value })} />
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Saldo inicial do caixa (R$)" inputMode="decimal" disabled={Boolean(settings)} value={settingsForm.openingBalance ?? ""} onChange={(e) => setSettingsForm({ ...settingsForm, openingBalance: e.target.value })} />
            <Field label="Data de referência do saldo" type="date" disabled={Boolean(settings)} value={settingsForm.openingDate ?? ""} onChange={(e) => setSettingsForm({ ...settingsForm, openingDate: e.target.value })} />
          </div>
          {settings && <p className="text-xs text-muted-foreground">O saldo inicial já foi definido e fica bloqueado para edição. Use Ajuste no caixa para correções auditáveis.</p>}
          <PrimaryButton disabled={busy} type="submit">Salvar configurações</PrimaryButton>
        </form>
      </Panel>
      <Panel title="Mensalidades e datas">
        <p className="text-sm text-muted-foreground">O botão de geração aparece no resumo e cria cobranças uma única vez para o mês atual. A geração automática depende de uma rotina mensal configurada no banco, ainda não confirmada. Até lá, use o botão de forma recorrente.</p>
      </Panel>
    </div>}
  </div>;
}

function Kpi({ title, value, tone = "normal" }: { title: string; value: string; tone?: string }) {
  return <div className="rounded-xl border border-border bg-card p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">{title}</p><p className={`mt-1 break-words text-lg font-bold md:text-2xl ${tone === "danger" ? "text-destructive" : ""}`}>{value}</p></div>;
}

function ChargeList({ charges, names, manager, paymentInputs, setPaymentInputs, onPayment, busy }: {
  charges: Charge[]; names: Map<string, string>; manager: boolean;
  paymentInputs: Record<string, { amount: string; method: string; date: string; notes: string }>;
  setPaymentInputs: React.Dispatch<React.SetStateAction<Record<string, { amount: string; method: string; date: string; notes: string }>>>;
  onPayment: (charge: Charge) => void; busy: boolean;
}) {
  if (!charges.length) return <p className="py-3 text-sm text-muted-foreground">Nenhuma cobrança encontrada.</p>;
  return <div className="space-y-3">
    {charges.map((c) => {
      const state = financeStatus(c.due_date, Number(c.outstanding_cents ?? 0), c.status);
      const input = paymentInputs[c.id] ?? { amount: "", method: "pix", date: isoDay(), notes: "" };
      return <article key={c.id} className="rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0"><p className="font-semibold">{manager ? names.get(c.player_id) || "Jogador" : "Cobrança"} · {c.description}</p><p className="text-xs text-muted-foreground">Vencimento {new Date(c.due_date + "T00:00:00").toLocaleDateString("pt-BR")} · {c.kind}</p></div>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${state.tone === "danger" ? "bg-destructive/15 text-destructive" : state.tone === "success" ? "bg-emerald-500/15 text-emerald-600" : "bg-amber-500/15 text-amber-600"}`}>{state.label}</span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
          <div><span className="block text-xs text-muted-foreground">Cobrado</span><strong>{formatBRL(c.amount_cents)}</strong></div>
          <div><span className="block text-xs text-muted-foreground">Pago</span><strong>{formatBRL(c.paid_cents)}</strong></div>
          <div><span className="block text-xs text-muted-foreground">Em aberto</span><strong>{formatBRL(c.outstanding_cents)}</strong></div>
        </div>
        {manager && c.status === "open" && c.outstanding_cents > 0 && <div className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto]">
          <input aria-label="Valor recebido" inputMode="decimal" placeholder="Valor recebido (R$)" value={input.amount} onChange={(e) => setPaymentInputs((v) => ({ ...v, [c.id]: { ...input, amount: e.target.value } }))} className="min-h-10 rounded-md border border-input bg-background px-3 text-sm" />
          <select aria-label="Forma de pagamento" value={input.method} onChange={(e) => setPaymentInputs((v) => ({ ...v, [c.id]: { ...input, method: e.target.value } }))} className="min-h-10 rounded-md border border-input bg-background px-3 text-sm">
            <option value="pix">Pix conferido</option><option value="dinheiro">Dinheiro</option><option value="transferencia">Transferência</option><option value="outro">Outro</option>
          </select>
          <input aria-label="Data do recebimento" type="date" max={isoDay()} value={input.date} onChange={(e) => setPaymentInputs((v) => ({ ...v, [c.id]: { ...input, date: e.target.value } }))} className="min-h-10 rounded-md border border-input bg-background px-3 text-sm" />
          <button disabled={busy} onClick={() => onPayment(c)} className="min-h-10 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">Registrar</button>
        </div>}
      </article>;
    })}
  </div>;
}

function LedgerList({ rows, players, onReverse }: { rows: any[]; players: Map<string, string>; onReverse: (id: string) => void }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">Nenhuma movimentação ainda.</p>;
  return <div className="space-y-2">{rows.map((row) => <article key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3">
    <div><p className="font-medium">{row.category || row.entry_type} {row.player_id ? `· ${players.get(row.player_id) || "Jogador"}` : ""}</p><p className="text-xs text-muted-foreground">{row.occurred_on} · {row.notes || row.method || "—"}</p></div>
    <div className="flex items-center gap-2"><strong className={row.amount_cents < 0 ? "text-destructive" : "text-emerald-600"}>{formatBRL(row.amount_cents)}</strong>{["payment", "expense"].includes(row.entry_type) && <SecondaryButton onClick={() => onReverse(row.id)}>Estornar</SecondaryButton>}</div>
  </article>)}</div>;
}
