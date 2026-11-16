import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type Functions = Database["public"]["Functions"];
type NullableArgs<T> = { [K in keyof T]: T[K] | null };
type RpcResult<T> = PromiseLike<{
  data: T | null;
  error: { message: string; code: string; details: string; hint: string } | null;
}>;
// PostgreSQL nullable arguments are not represented by generated RPC argument types.
// Keep the compatibility conversion at this boundary instead of using an untyped client.
export const financeRpc = supabase.rpc.bind(supabase) as <N extends keyof Functions>(
  name: N,
  args: NullableArgs<Functions[N]["Args"]>,
) => RpcResult<Functions[N]["Returns"]>;

export type FinanceSettings = Database["public"]["Tables"]["finance_settings"]["Row"];
export type FinanceExpense = Database["public"]["Tables"]["finance_expenses"]["Row"];
export type FinanceEntry = Database["public"]["Tables"]["finance_ledger"]["Row"];
export type FinanceClosing = Omit<
  Database["public"]["Tables"]["finance_month_closings"]["Row"],
  "snapshot"
> & { snapshot: FinanceSummary };
export type FinanceEvent = Pick<
  Database["public"]["Tables"]["events"]["Row"],
  "id" | "title" | "starts_at" | "status" | "daily_fee_cents"
>;
export type FinanceInstructions = Partial<
  Pick<
    FinanceSettings,
    | "due_day"
    | "pix_key_type"
    | "pix_key"
    | "pix_receiver_name"
    | "payment_instructions"
    | "monthly_fee_cents"
    | "daily_fee_cents"
  >
> & { configured?: boolean; finance_version?: number };
export type FinanceSummary = {
  balance_cents?: number;
  opening_balance_cents?: number;
  receivable_cents?: number;
  overdue_cents?: number;
  period_in_cents?: number;
  period_out_cents?: number;
  period_adjust_cents?: number;
  period_starting_balance_cents?: number | null;
  period_ending_balance_cents?: number | null;
  period_receivable_cents?: number;
  period_overdue_cents?: number;
  period_expense_pending_cents?: number;
  expense_pending_cents?: number;
  by_category?: Record<string, number>;
};
