import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RatingSection } from "@/components/event-player-ratings";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  invalidate: vi.fn(),
  error: false,
  pending: false,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock("@/lib/player-rating-ranking", () => ({ isPlayerRatingRankingEnabled: () => true }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    const ratings = queryKey[0] === "event-ratings";
    return {
      data: ratings
        ? [{ player_id: "p1", rating: 5 }]
        : [{ player_id: "p2", average: 0, count: 0 }],
      isError: ratings && mocks.error,
      isPending: ratings && mocks.pending,
      isFetching: false,
      isSuccess: !ratings || (!mocks.error && !mocks.pending),
    };
  },
}));
const rows = [
  { player_id: "p1", players: { name: "Ana" } },
  { player_id: "p2", players: { name: "Bia" } },
];
beforeEach(() => {
  mocks.error = false;
  mocks.pending = false;
  mocks.rpc.mockReset().mockResolvedValue({ error: null });
  mocks.invalidate.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);
const show = (isAdmin = true) =>
  render(<RatingSection eventId="event-a" venueId="court-a" rows={rows} isAdmin={isAdmin} />);

describe("event player evaluations", () => {
  it("keeps the current top recipient selected and blocks a second five-star recipient", () => {
    show();
    expect(screen.getByRole("button", { name: "5 estrelas para Ana" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "5 estrelas para Ana" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "5 estrelas para Bia" })).toBeDisabled();
    expect(screen.getByText("0.00 (0 participações)", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "3 estrelas para Bia" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
  it("does not allow members to edit", () => {
    show(false);
    screen.getAllByRole("button").forEach((button) => expect(button).toBeDisabled());
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("blocks editing while evaluations load or fail", () => {
    mocks.error = true;
    show();
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível carregar as avaliações");
    expect(screen.getByRole("button", { name: "4 estrelas para Bia" })).toBeDisabled();
    cleanup();
    mocks.error = false;
    mocks.pending = true;
    show();
    expect(screen.getByRole("button", { name: "4 estrelas para Bia" })).toBeDisabled();
  });
  it("sends the existing authorized RPC and refreshes evaluations and ranking", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "4 estrelas para Bia" }));
    await waitFor(() => expect(mocks.invalidate).toHaveBeenCalledTimes(2));
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("set_player_rating", {
      _event_id: "event-a",
      _player_id: "p2",
      _rating: 4,
    });
    expect(mocks.invalidate).toHaveBeenCalledWith({ queryKey: ["court-rating-avg", "court-a"] });
  });
  it("releases controls and refreshes after an uncertain transport failure", async () => {
    mocks.rpc.mockRejectedValue(new Error("Offline"));
    show();
    fireEvent.click(screen.getByRole("button", { name: "4 estrelas para Bia" }));
    await waitFor(() => expect(mocks.invalidate).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "4 estrelas para Bia" })).toBeEnabled(),
    );
  });
});
