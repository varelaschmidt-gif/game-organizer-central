import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StartEventVoting } from "@/components/start-event-voting";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), load: vi.fn(), navigate: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock("@/lib/event-voting", () => ({ loadEventVotingRoster: mocks.load }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  Link: ({ children }: { children: React.ReactNode }) => <a href="#voting">{children}</a>,
}));
beforeEach(() => {
  mocks.rpc.mockReset().mockResolvedValue({ error: null });
  mocks.navigate.mockReset();
  mocks.load.mockReset().mockResolvedValue(
    ["Ana", "Bia", "Caio"].map((name, i) => ({
      player_id: `p${i + 1}`,
      status: "confirmed",
      attended: i === 0 ? true : null,
      players: { id: `p${i + 1}`, name, nickname: null, group_id: "g", venue_id: "v" },
    })),
  );
});
afterEach(cleanup);
function show(status = "scheduled") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <StartEventVoting eventId="e" title="Pelada" groupId="g" venueId="v" status={status} />
    </QueryClientProvider>,
  );
}
describe("start evaluation from saved teams", () => {
  it("does not close an event until attendance is explicitly confirmed", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Iniciar votação" }));
    expect(await screen.findByRole("checkbox", { name: /Ana/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Bia/ })).not.toBeChecked();
    expect(
      screen.getByRole("button", { name: "Encerrar evento e iniciar votação" }),
    ).toBeDisabled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("closes with exactly the selected present IDs and opens the same event voting page", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Iniciar votação" }));
    await screen.findByRole("checkbox", { name: /Bia/ });
    fireEvent.click(screen.getByRole("checkbox", { name: /Bia/ }));
    fireEvent.click(screen.getByRole("button", { name: "Encerrar evento e iniciar votação" }));
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: "/times/votacao/$eventId",
        params: { eventId: "e" },
      }),
    );
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("start_event_voting", {
      _event_id: "e",
      _present_ids: ["p1", "p2"],
    });
  });
  it("keeps the confirmation open if closure fails", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "Evento cancelado" } });
    show();
    fireEvent.click(screen.getByRole("button", { name: "Iniciar votação" }));
    await screen.findByRole("checkbox", { name: /Bia/ });
    fireEvent.click(screen.getByRole("checkbox", { name: /Bia/ }));
    fireEvent.click(screen.getByRole("button", { name: "Encerrar evento e iniciar votação" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Encerrar evento e iniciar votação" }),
      ).toBeEnabled(),
    );
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it("reopens voting for a closed event without closing it a second time", () => {
    show("done");
    expect(screen.getByRole("link", { name: "Abrir votação" })).toBeInTheDocument();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.load).not.toHaveBeenCalled();
  });
});
