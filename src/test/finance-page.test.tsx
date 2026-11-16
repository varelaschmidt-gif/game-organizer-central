import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ manager: true, rpc: vi.fn(), today: "2026-11-16" }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}));
vi.mock("@/lib/groups", () => ({
  useActiveGroup: () => ({
    group: { id: "g", role: state.manager ? "admin" : "player" },
    can: () => state.manager,
    isLoading: false,
  }),
  useActiveCourt: () => ({ venue: { id: "v", name: "Quadra de teste" }, isLoading: false }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "u" } } }) },
    rpc: (name: string, args: unknown) => state.rpc(name, args),
    from: (table: string) => {
      const charge = {
        id: "c",
        venue_id: "v",
        group_id: "g",
        player_id: "p",
        kind: "monthly",
        description: "Mensalidade",
        amount_cents: 10000,
        paid_cents: 0,
        outstanding_cents: 10000,
        due_date: "2026-11-20",
        status: "open",
        expense_id: null,
      };
      const player = {
        id: "p",
        name: "Jogador teste",
        nickname: null,
        participation_type: "mensalista",
        status: "active",
      };
      const rows =
        table === "players" ? [player] : table === "finance_charge_balances" ? [charge] : [];
      const query: Record<string, unknown> = {};
      for (const name of ["select", "eq", "order"]) query[name] = () => query;
      query["range"] = async () => ({ data: rows, error: null });
      query["maybeSingle"] = async () => ({
        data:
          table === "players"
            ? player
            : table === "finance_settings"
              ? {
                  venue_id: "v",
                  monthly_fee_cents: 10000,
                  opening_balance_cents: 0,
                  opening_balance_date: "2026-01-01",
                }
              : null,
        error: null,
      });
      return query;
    },
  },
}));

import { Route } from "@/routes/_authenticated/financeiro";
const Page = Route.options.component as React.ComponentType;
function mount() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
    >
      <Page />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  state.manager = true;
  state.rpc.mockReset();
  state.rpc.mockImplementation(async (name: string) => ({
    data:
      name === "finance_get_instructions"
        ? { finance_version: 16 }
        : name === "finance_summary"
          ? { balance_cents: 0 }
          : null,
    error: null,
  }));
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("financial page permissions and money entry", () => {
  it("opens the settings section from the navigation link", async () => {
    window.history.replaceState(null, "", "/financeiro#configuracoes");
    mount();
    await screen.findByRole("heading", { name: "Configurações financeiras desta quadra" });
    expect(screen.getByLabelText("Seção do financeiro")).toHaveValue("config");
  });
  it("gives a player the individual statement without administrative payment controls", async () => {
    state.manager = false;
    mount();
    await screen.findByText("Sua situação");
    expect(screen.queryByLabelText("Valor recebido")).not.toBeInTheDocument();
    expect(screen.queryByText("Nova cobrança manual")).not.toBeInTheDocument();
    expect(state.rpc.mock.calls.some(([name]) => name === "finance_summary")).toBe(false);
  });
  it("rejects invalid precision before making a payment and sends exact cents only once", async () => {
    mount();
    await screen.findByRole("heading", { name: "Financeiro" });
    fireEvent.change(screen.getByLabelText("Seção do financeiro"), {
      target: { value: "cobrancas" },
    });
    fireEvent.change(screen.getByLabelText("Valor recebido"), { target: { value: "40,001" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar" }));
    await screen.findByRole("alert");
    expect(state.rpc.mock.calls.filter(([name]) => name === "finance_record_payment")).toHaveLength(
      0,
    );
    fireEvent.change(screen.getByLabelText("Valor recebido"), { target: { value: "40,00" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar" }));
    fireEvent.click(screen.getByRole("button", { name: "Registrar" }));
    await waitFor(() =>
      expect(
        state.rpc.mock.calls.filter(([name]) => name === "finance_record_payment"),
      ).toHaveLength(1),
    );
    const call = state.rpc.mock.calls.find(([name]) => name === "finance_record_payment");
    expect(call?.[1]).toMatchObject({ _charge_id: "c", _amount_cents: 4000, _method: "pix" });
  });
  it("shows the backend rejection instead of a false success", async () => {
    state.rpc.mockImplementation(async (name: string) =>
      name === "finance_record_payment"
        ? { data: null, error: { message: "Mês fechado; reabra o período" } }
        : { data: name === "finance_get_instructions" ? { finance_version: 16 } : {}, error: null },
    );
    mount();
    await screen.findByRole("heading", { name: "Financeiro" });
    fireEvent.change(screen.getByLabelText("Seção do financeiro"), {
      target: { value: "cobrancas" },
    });
    fireEvent.change(screen.getByLabelText("Valor recebido"), { target: { value: "40,00" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Mês fechado; reabra o período");
  });
});
