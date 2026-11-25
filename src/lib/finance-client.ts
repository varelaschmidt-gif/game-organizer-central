import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";

type GeneratedFunctions = Database["public"]["Functions"];
type Functions = GeneratedFunctions & {
  finance_save_player_terms: {
    Args: { _player_id: string; _monthly_fee_cents: number | null; _due_day: number | null; _reason: string };
    Returns: undefined;
  };
  finance_record_expense_with_split: {
    Args: GeneratedFunctions["finance_record_expense"]["Args"] & {
      _target: string; _mode: string; _player_ids: string[] | null;
      _amounts: number[] | null; _event_id: string | null; _due_date: string;
    };
    Returns: string;
  };
  finance_cancel_expense: {
    Args: { _expense_id: string; _reason: string };
    Returns: undefined;
  };
};
export type FinancePlayerTermsRow = {
  player_id: string; venue_id: string; group_id: string;
  monthly_fee_cents: number | null; due_day: number | null;
  reason: string; updated_by: string; updated_at: string;
};
type FinanceDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables" | "Functions"> & {
    Tables: Database["public"]["Tables"] & {
      finance_player_terms: {
        Row: FinancePlayerTermsRow;
        Insert: FinancePlayerTermsRow;
        Update: Partial<FinancePlayerTermsRow>;
        Relationships: [];
      };
    };
    Functions: Functions;
  };
};
// Supplement generated types from the checked-in migrations; reuse the same client/session.
export const financeDb = supabase as unknown as SupabaseClient<FinanceDatabase>;
type NullableArgs<T> = { [K in keyof T]: T[K] | null };
type RpcResult<T> = PromiseLike<{
  data: T | null;
  error: { message: string; code: string; details: string; hint: string } | null;
}>;
// PostgreSQL nullable arguments are not represented by generated RPC argument types.
// Keep the compatibility conversion at this boundary instead of using an untyped client.
export const financeRpc = financeDb.rpc.bind(financeDb) as <N extends keyof Functions>(
  name: N,
  args: NullableArgs<Functions[N]["Args"]>,
) => RpcResult<Functions[N]["Returns"]>;

export type FinanceSettings = Database["public"]["Tables"]["finance_settings"]["Row"];
export type FinanceExpense = Database["public"]["Tables"]["finance_expenses"]["Row"] & {
  cancelled_at?: string | null;
  cancelled_by?: string | null;
  cancel_reason?: string | null;
};
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
