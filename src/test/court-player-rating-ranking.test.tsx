import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CourtPlayerRatingRanking } from "@/components/court-player-rating-ranking";

const mocks = vi.hoisted(() => ({
  enabled: true,
  rpc: vi.fn(),
  range: vi.fn(),
  order: vi.fn(),
  gt: vi.fn(),
  limit: vi.fn(),
}));
vi.mock("@/lib/player-rating-ranking", async (original) => ({
  ...(await original<object>()),
  isPlayerRatingRankingEnabled: () => mocks.enabled,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));

beforeEach(() => {
  mocks.enabled = true;
  mocks.rpc.mockReset().mockReturnValue({ order: mocks.order, gt: mocks.gt });
  mocks.order
    .mockReset()
    .mockReturnValue({ order: mocks.order, range: mocks.range, limit: mocks.limit });
  mocks.gt.mockReset().mockReturnValue({ order: mocks.order });
  mocks.limit.mockReset().mockResolvedValue({ data: [], error: null });
  mocks.range.mockReset().mockImplementation((from: number) =>
    Promise.resolve({
      data: Array.from({ length: from === 0 ? 51 : 1 }, (_, n) => ({
        player_id: `p${from + n}`,
        name: `Player ${from + n}`,
        nickname: null,
        average: 3,
        rank: 1,
        events_count: 1,
        explicit_count: 0,
        default_count: 1,
        blocked: false,
        restarted: false,
      })),
      error: null,
    }),
  );
});
afterEach(cleanup);
function show(venueId = "court-a") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <CourtPlayerRatingRanking venueId={venueId} />
    </QueryClientProvider>,
  );
}

describe("court ranking integration", () => {
  it("does not query or display ranking on an uninstalled backend", () => {
    mocks.enabled = false;
    show();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("requests one extra row for pagination, without truncating the ranking", async () => {
    show();
    await screen.findByRole("heading", { name: "Player 0" });
    expect(mocks.rpc).toHaveBeenCalledWith("get_court_player_ranking", { _venue_id: "court-a" });
    expect(mocks.gt).toHaveBeenCalledTimes(2);
    expect(mocks.gt).toHaveBeenCalledWith("events_count", 0);
    expect(mocks.order).toHaveBeenCalledWith("average", { ascending: true, nullsFirst: false });
    expect(mocks.order).toHaveBeenCalledWith("average", { ascending: false, nullsFirst: false });
    expect(mocks.range).toHaveBeenCalledWith(0, 50);
    expect(screen.queryByRole("heading", { name: "Player 50" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await screen.findByRole("heading", { name: "Player 50" });
    expect(mocks.gt).toHaveBeenCalledTimes(2);
    expect(mocks.range).toHaveBeenCalledWith(50, 100);
    expect(screen.getByRole("button", { name: "Próxima" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Anterior" })).toBeEnabled();
  });
  it("reports the backend failure and lets the user retry", async () => {
    mocks.range.mockResolvedValueOnce({ data: null, error: new Error("Failed request") });
    show();
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível carregar");
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await waitFor(() => expect(screen.getByRole("list")).toBeInTheDocument());
  });
});
