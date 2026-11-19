import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ formed: false, role: "admin", status: "scheduled" }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options, useSearch: () => ({}) }),
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/groups", () => ({
  useActiveGroup: () => ({ group: { id: "g", role: state.role } }),
  useActiveCourt: () => ({ venue: { id: "v", name: "Court" } }),
}));
vi.mock("@/components/start-event-voting", () => ({
  StartEventVoting: ({ status }: { status: string }) => (
    <button>{status === "done" ? "Abrir votação" : "Iniciar votação"}</button>
  ),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({}),
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data:
      queryKey[0] === "events"
        ? [
            {
              id: "e",
              title: "Game",
              status: state.status,
              starts_at: "2099-11-19T19:00:00Z",
              teams_count: 2,
              players_per_team: 6,
            },
          ]
        : queryKey[0] === "event-teams" && state.formed
          ? [
              {
                id: "t",
                name: "Time 1",
                event_team_players: [{ player_id: "p", players: { name: "Player" } }],
              },
            ]
          : [],
    isSuccess: true,
    isFetching: false,
  }),
}));
import { Route } from "@/routes/_authenticated/times";
const Page = Route.options.component as React.ComponentType;
beforeEach(() => {
  state.formed = false;
  state.role = "admin";
  state.status = "scheduled";
});
afterEach(cleanup);
describe("voting entry in Teams", () => {
  it("shows start voting only after teams with players have been saved", () => {
    const view = render(<Page />);
    expect(screen.queryByRole("button", { name: "Iniciar votação" })).not.toBeInTheDocument();
    state.formed = true;
    view.rerender(<Page />);
    expect(screen.getByRole("button", { name: "Iniciar votação" })).toBeInTheDocument();
  });
  it("does not offer administrative voting to a player", () => {
    state.formed = true;
    state.role = "player";
    render(<Page />);
    expect(screen.queryByRole("button", { name: "Iniciar votação" })).not.toBeInTheDocument();
  });
  it("reopens a closed event while blocking redraw and additions in the UI", () => {
    state.formed = true;
    state.status = "done";
    render(<Page />);
    expect(screen.getByRole("button", { name: "Abrir votação" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tirar times/ })).toBeDisabled();
    expect(screen.queryByText("Cadastrar jogador avulso")).not.toBeInTheDocument();
  });
});
