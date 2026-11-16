import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { CourtPlayerRatingRanking } from "@/components/court-player-rating-ranking";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { errMsg, useActiveCourt, useActiveGroup } from "@/lib/groups";
import { isPlayerRatingRankingEnabled } from "@/lib/player-rating-ranking";

export const Route = createFileRoute("/_authenticated/jogadores_/ranking")({
  head: () => ({ meta: [{ title: "Ranking dos jogadores | Rei da Quadra" }] }),
  component: PlayerRankingPage,
});

function PlayerRankingPage() {
  const active = useActiveGroup();
  const court = useActiveCourt(active.group?.id);
  let content;
  if (active.isLoading || court.isLoading) {
    content = <LoadingState />;
  } else if (active.isError || court.isError) {
    content = (
      <ErrorState
        message={errMsg(active.error || court.error)}
        onRetry={() => {
          void active.refetch();
          void court.refetch();
        }}
      />
    );
  } else if (!active.group || !court.venue) {
    content = (
      <EmptyState
        title="Selecione uma quadra"
        description="Escolha a quadra para consultar as médias dos jogadores."
        action={
          <Button asChild>
            <Link to="/quadras">Ir para quadras</Link>
          </Button>
        }
      />
    );
  } else if (!isPlayerRatingRankingEnabled()) {
    content = (
      <EmptyState
        title="Ranking indisponível"
        description="O ranking ainda não está disponível nesta quadra."
      />
    );
  } else {
    content = <CourtPlayerRatingRanking venueId={court.venue.id} />;
  }
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <Button asChild variant="ghost" className="-ml-3">
        <Link to="/jogadores">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar para jogadores
        </Link>
      </Button>
      <header className="space-y-1">
        <h1 className="text-3xl font-bold">Ranking dos jogadores</h1>
        <p className="text-sm text-muted-foreground">
          {court.venue?.name ?? "Médias de avaliação por quadra"}
        </p>
      </header>
      {content}
    </div>
  );
}
