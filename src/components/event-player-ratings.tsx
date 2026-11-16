import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { isPlayerRatingRankingEnabled, type PlayerRatingRank } from "@/lib/player-rating-ranking";
import { Button } from "@/components/ui/button";

type Props = {
  eventId: string;
  venueId: string;
  rows: Array<{ player_id: string; players: { name: string; nickname?: string | null } | null }>;
  isAdmin: boolean;
};

export function RatingSection({ eventId, venueId, rows, isAdmin }: Props) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const ranked = isPlayerRatingRankingEnabled();
  const ratings = useQuery({
    queryKey: ["event-ratings", eventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("event_player_ratings")
        .select("player_id,rating")
        .eq("event_id", eventId);
      if (error) throw error;
      return data ?? [];
    },
  });
  const averages = useQuery({
    queryKey: ["court-rating-avg", venueId],
    queryFn: async () => {
      if (ranked) {
        const { data, error } = await supabase
          .rpc("get_court_player_ranking", { _venue_id: venueId })
          .in(
            "player_id",
            rows.map((r) => r.player_id),
          );
        if (error) throw error;
        return ((data ?? []) as PlayerRatingRank[]).map((r) => ({
          player_id: r.player_id,
          average: r.average,
          count: r.events_count,
        }));
      }
      const { data, error } = await supabase.rpc("get_court_rating_averages", {
        _venue_id: venueId,
      });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        player_id: r.player_id,
        average: r.average,
        count: r.ratings_count,
      }));
    },
  });
  const fiveHolder = ratings.data?.find((r) => r.rating === 5)?.player_id;
  const editable = isAdmin && !busy && ratings.isSuccess && !ratings.isFetching;
  async function refresh() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["event-ratings", eventId] }),
      qc.invalidateQueries({ queryKey: ["court-rating-avg", venueId] }),
    ]);
  }
  async function save(playerId: string, rating: number | null) {
    if (!editable) return;
    setBusy(true);
    try {
      const { error } =
        rating === null
          ? await supabase.rpc("remove_player_rating", { _event_id: eventId, _player_id: playerId })
          : await supabase.rpc("set_player_rating", {
              _event_id: eventId,
              _player_id: playerId,
              _rating: rating,
            });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success(rating === null ? "Nota removida" : "Nota salva");
      await refresh();
    } catch {
      toast.error(
        "Não foi possível confirmar a gravação. Confira as avaliações atualizadas antes de tentar novamente.",
      );
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="text-xl font-semibold">Avaliação do evento</h2>
      <p className="text-sm text-muted-foreground">
        {isAdmin
          ? "Dê de 1 a 5 estrelas para cada jogador presente. Apenas um jogador pode receber 5 estrelas por evento."
          : "As notas são atribuídas pelo administrador da quadra."}
      </p>
      {ranked && (
        <p className="text-sm text-muted-foreground">
          Sem avaliação explícita, a participação recebe 3 estrelas apenas no cálculo da média.
          Faltas não entram.
        </p>
      )}
      {ratings.isError && (
        <p role="alert" className="text-destructive">
          Não foi possível carregar as avaliações. Recarregue a página antes de avaliar.
        </p>
      )}
      {averages.isError && (
        <p role="alert" className="text-destructive">
          Não foi possível carregar as médias dos jogadores.
        </p>
      )}
      {rows.map((row) => {
        const name = row.players?.nickname || row.players?.name || "Jogador";
        const current = ratings.data?.find((r) => r.player_id === row.player_id)?.rating ?? 0;
        const avg = averages.data?.find((r) => r.player_id === row.player_id);
        return (
          <div
            key={row.player_id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
          >
            <div>
              <div className="font-medium">{name}</div>
              <div className="text-xs text-muted-foreground">
                {ranked ? "Média atual na quadra" : "Média das avaliações explícitas"}{" "}
                {averages.isError
                  ? "indisponível"
                  : averages.isPending
                    ? "carregando…"
                    : avg?.average != null
                      ? `${Number(avg.average).toFixed(2)} (${avg.count} ${ranked ? "participações" : "avaliações"})`
                      : "—"}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((n) => {
                const blocked = n === 5 && !!fiveHolder && fiveHolder !== row.player_id;
                return (
                  <button
                    key={n}
                    type="button"
                    aria-label={`${n} estrelas para ${name}`}
                    aria-pressed={n === current}
                    disabled={!editable || blocked}
                    title={blocked ? "Outro jogador já tem 5 estrelas" : undefined}
                    onClick={() => void save(row.player_id, n)}
                    className="disabled:cursor-not-allowed"
                  >
                    <Star
                      className={`h-6 w-6 ${n <= current ? "fill-primary text-primary" : "text-muted-foreground"} ${blocked ? "opacity-40" : ""}`}
                    />
                  </button>
                );
              })}
              {isAdmin && current > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!editable}
                  onClick={() => void save(row.player_id, null)}
                >
                  Remover
                </Button>
              )}
            </div>
          </div>
        );
      })}
      {!rows.length && (
        <p className="text-sm text-muted-foreground">Nenhum jogador com presença registrada.</p>
      )}
    </section>
  );
}
