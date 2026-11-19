import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  isPlayerRatingRankingEnabled,
  RANKING_PAGE_SIZE,
  type PlayerRatingRank,
} from "@/lib/player-rating-ranking";
import { PlayerRatingRanking } from "@/components/player-rating-ranking";
import { Button } from "@/components/ui/button";

export function CourtPlayerRatingRanking({ venueId }: { venueId: string }) {
  if (!isPlayerRatingRankingEnabled()) return null;
  return <CourtRanking key={venueId} venueId={venueId} />;
}

function CourtRanking({ venueId }: { venueId: string }) {
  const [page, setPage] = useState(0);
  const ranking = useQuery({
    queryKey: ["court-rating-avg", venueId, "ranking", page],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc("get_court_player_ranking", { _venue_id: venueId })
        .order("rank", { ascending: true, nullsFirst: false })
        .order("player_id")
        .range(page * RANKING_PAGE_SIZE, (page + 1) * RANKING_PAGE_SIZE);
      if (error) throw error;
      return (data ?? []) as PlayerRatingRank[];
    },
    refetchInterval: 60_000,
  });
  const lastPlayers = useQuery({
    queryKey: ["court-rating-avg", venueId, "last-three"],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc("get_court_player_ranking", { _venue_id: venueId })
        .select("player_id")
        .gt("events_count", 0)
        .order("average", { ascending: true, nullsFirst: false })
        .order("player_id")
        .limit(3);
      if (error) throw error;
      return new Set((data ?? []).map(({ player_id }) => player_id));
    },
    refetchInterval: 60_000,
  });
  const rows = ranking.data?.slice(0, RANKING_PAGE_SIZE) ?? [];
  const hasNext = (ranking.data?.length ?? 0) > RANKING_PAGE_SIZE;
  return (
    <div id="ranking" className="min-w-0 scroll-mt-24 space-y-4">
      <PlayerRatingRanking
        rows={rows}
        {...(!lastPlayers.isError && lastPlayers.data ? { lastPlayerIds: lastPlayers.data } : {})}
        loading={ranking.isPending}
        error={ranking.isError}
        onRetry={() => void ranking.refetch()}
      />
      {!ranking.isError && (page > 0 || hasNext) && (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            disabled={page === 0 || ranking.isFetching}
            onClick={() => setPage((p) => p - 1)}
          >
            Anterior
          </Button>
          <span className="text-sm">Página {page + 1}</span>
          <Button
            variant="outline"
            disabled={ranking.isFetching || !hasNext}
            onClick={() => setPage((p) => p + 1)}
          >
            Próxima
          </Button>
        </div>
      )}
    </div>
  );
}
