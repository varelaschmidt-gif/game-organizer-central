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

// Migration is installed only on this independent test copy. Never probe or
// enable the new RPC on production before separate deployment authorization.
export function isPlayerRatingRankingEnabled(url = import.meta.env["VITE_SUPABASE_URL"]): boolean {
  return url?.replace(/\/+$/, "") === "https://iuwgpfhvauyhxfzlxlbu.supabase.co";
}

export const RANKING_PAGE_SIZE = 50;
