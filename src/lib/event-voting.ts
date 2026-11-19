import { supabase } from "@/integrations/supabase/client";

export type EventVotingPlayer = {
  id: string;
  name: string;
  nickname: string | null;
  position?: string | null;
};
export type EventVotingRating = { player_id: string; rating: number };
export type EventVotingRoster = {
  player_id: string;
  attended: boolean | null;
  status: string;
  players: (EventVotingPlayer & { group_id: string; venue_id: string }) | null;
};

export async function loadEventVotingRoster(eventId: string, groupId: string, venueId: string) {
  const rows: EventVotingRoster[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabase
      .from("attendances")
      .select("player_id,status,attended,players(id,name,nickname,position,group_id,venue_id)")
      .eq("event_id", eventId)
      .eq("group_id", groupId)
      .eq("status", "confirmed")
      .order("player_id")
      .range(from, from + 499);
    if (error) throw error;
    const page = (data ?? []) as EventVotingRoster[];
    if (
      page.some(
        (row) =>
          !row.players || row.players.group_id !== groupId || row.players.venue_id !== venueId,
      )
    ) {
      throw new Error("Há jogadores indisponíveis na lista. Atualize o evento antes de votar.");
    }
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}

export function votingSnapshot(ratings: EventVotingRating[]) {
  return ratings
    .map(({ player_id, rating }) => ({ player_id, rating }))
    .sort((a, b) => a.player_id.localeCompare(b.player_id));
}

export function votingScore(playerId: string, bestId: string | null, worstId: string | null) {
  return playerId === bestId ? 5 : playerId === worstId ? 1 : 3;
}
