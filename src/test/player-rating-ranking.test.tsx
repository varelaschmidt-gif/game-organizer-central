import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlayerRatingRanking, type PlayerRatingRank } from "@/components/player-rating-ranking";

afterEach(cleanup);
const row = (values: Partial<PlayerRatingRank> = {}): PlayerRatingRank => ({
  player_id: "p1",
  name: "Ana",
  nickname: null,
  average: 4,
  events_count: 2,
  explicit_count: 1,
  default_count: 1,
  blocked: false,
  restarted: false,
  rank: 1,
  ...values,
});

describe("player rating ranking presentation", () => {
  it("distinguishes actual evaluations from default scores without inventing votes", () => {
    render(<PlayerRatingRanking rows={[row()]} />);
    const cells = within(screen.getByRole("row", { name: /Ana/ })).getAllByRole("cell");
    expect(cells.map((c) => c.textContent)).toEqual(["1", "4,00 / 5", "2", "1", "1"]);
    expect(screen.getByText(/Faltas não entram/)).toBeInTheDocument();
  });
  it("shows a zeroed score and a restart without restoring the historical average", () => {
    render(
      <PlayerRatingRanking
        rows={[
          row({ average: 0, blocked: true, events_count: 0, explicit_count: 0, default_count: 0 }),
          row({
            player_id: "p2",
            name: "Bia",
            average: 0,
            restarted: true,
            events_count: 0,
            explicit_count: 0,
            default_count: 0,
          }),
        ]}
      />,
    );
    expect(screen.getByText("Pontuação zerada")).toBeInTheDocument();
    expect(screen.getByText("Aguardando nova participação após reinício")).toBeInTheDocument();
    expect(screen.getAllByText("0,00 / 5")).toHaveLength(2);
  });
  it("does not give a rating to a player who has never participated", () => {
    render(
      <PlayerRatingRanking
        rows={[
          row({ average: null, rank: null, events_count: 0, explicit_count: 0, default_count: 0 }),
        ]}
      />,
    );
    expect(screen.getByText("Sem participação válida")).toBeInTheDocument();
    expect(screen.queryByText("3,00 / 5")).not.toBeInTheDocument();
  });
  it("hides stale scores on error and offers retry", () => {
    const retry = vi.fn();
    render(<PlayerRatingRanking rows={[row()]} error onRetry={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível carregar");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
  it("distinguishes loading and an empty court", () => {
    const view = render(<PlayerRatingRanking rows={[]} loading />);
    expect(screen.getByRole("status")).toHaveTextContent("Carregando");
    view.rerender(<PlayerRatingRanking rows={[]} />);
    expect(screen.getByText("Nenhum jogador disponível nesta quadra.")).toBeInTheDocument();
  });
});
