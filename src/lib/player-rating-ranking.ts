import type { Database } from "@/integrations/supabase/types";

type GeneratedRanking =
  Database["public"]["Functions"]["get_court_player_ranking"]["Returns"][number];
// SQL RETURNS TABLE metadata cannot express nullable fields. No score/rank
// exists for a player without an eligible participation; nickname is optional.
export type PlayerRatingRank = Omit<GeneratedRanking, "average" | "rank" | "nickname"> & {
  average: number | null;
  rank: number | null;
  nickname: string | null;
};

// Explicit allowlist of backends where the ranking migration was applied.
// Never probe an unknown backend for a function that might not be installed.
export function isPlayerRatingRankingEnabled(url = import.meta.env["VITE_SUPABASE_URL"]): boolean {
  return [
    "https://iuwgpfhvauyhxfzlxlbu.supabase.co",
    "https://owneaksnqdgpilnhjzwp.supabase.co",
  ].includes(url?.replace(/\/+$/, "") ?? "");
}

export const RANKING_PAGE_SIZE = 50;
