import { describe, expect, it } from "vitest";
import { isPlayerRatingRankingEnabled } from "./player-rating-ranking";

describe("ranking deployment boundary", () => {
  it("enables only the production and test backends with the migration installed", () => {
    expect(isPlayerRatingRankingEnabled("https://iuwgpfhvauyhxfzlxlbu.supabase.co")).toBe(true);
    expect(isPlayerRatingRankingEnabled("https://iuwgpfhvauyhxfzlxlbu.supabase.co/")).toBe(true);
    expect(isPlayerRatingRankingEnabled("https://owneaksnqdgpilnhjzwp.supabase.co")).toBe(true);
    expect(isPlayerRatingRankingEnabled("https://production.example")).toBe(false);
    expect(
      isPlayerRatingRankingEnabled("https://iuwgpfhvauyhxfzlxlbu.supabase.co.evil.example"),
    ).toBe(false);
    expect(isPlayerRatingRankingEnabled("")).toBe(false);
  });
});
