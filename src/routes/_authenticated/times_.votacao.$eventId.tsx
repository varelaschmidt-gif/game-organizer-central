import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { errMsg, myGroupsQuery } from "@/lib/groups";
import { loadEventVotingRoster, votingSnapshot } from "@/lib/event-voting";
import { EventVotingWizard, VotingStars } from "@/components/event-voting-wizard";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/times_/votacao/$eventId")({
  head: () => ({ meta: [{ title: "Votação do evento | Rei da Quadra" }] }),
  component: EventVotingPage,
});

function EventVotingPage() {
  const { eventId } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const groups = useQuery(myGroupsQuery);
  const [editing, setEditing] = useState(false);
  const [revision, setRevision] = useState(0);
  const event = useQuery({
    queryKey: ["event", eventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("id,title,group_id,venue_id,status")
        .eq("id", eventId)
        .single();
      if (error) throw error;
      return data;
    },
  });
  const roster = useQuery({
    queryKey: ["event-voting-roster", eventId],
    enabled: !!event.data,
    queryFn: () => loadEventVotingRoster(eventId, event.data!.group_id, event.data!.venue_id),
  });
  const ratings = useQuery({
    queryKey: ["event-ratings", eventId],
    enabled: !!event.data,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("event_player_ratings")
        .select("player_id,rating")
        .eq("event_id", eventId);
      if (error) throw error;
      return data ?? [];
    },
  });
  const teams = useQuery({
    queryKey: ["event-voting-teams", eventId],
    enabled: !!event.data,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("event_teams")
        .select("id,event_team_players(player_id)")
        .eq("event_id", eventId);
      if (error) throw error;
      return data ?? [];
    },
  });
  const back = (
    <Button asChild variant="outline">
      <Link to="/times" search={{ event: eventId }}>
        Voltar aos times
      </Link>
    </Button>
  );
  if (event.isPending || groups.isPending) return <LoadingState />;
  if (event.isError || groups.isError)
    return (
      <ErrorState
        message={errMsg(event.error || groups.error)}
        onRetry={() => {
          void event.refetch();
          void groups.refetch();
        }}
      />
    );
  if (!event.data) return <EmptyState title="Evento não encontrado" action={back} />;
  const current = event.data;
  const isAdmin = groups.data?.some((g) => g.id === current.group_id && g.role === "admin");
  const bodyLoading = roster.isPending || ratings.isPending || teams.isPending;
  const bodyError = roster.error || ratings.error || teams.error;
  const present = (roster.data ?? [])
    .filter((row) => row.attended === true)
    .map((row) => row.players!);
  async function save(
    best: string,
    worst: string,
    expectedPlayers: string[],
    expectedRatings: ReturnType<typeof votingSnapshot>,
  ) {
    const { error } = await supabase.rpc("complete_event_voting", {
      _event_id: eventId,
      _best_player_id: best,
      _worst_player_id: worst,
      _expected_player_ids: expectedPlayers,
      _expected_ratings: expectedRatings,
    });
    if (error) {
      if (error.code === "40001") {
        await Promise.all([roster.refetch(), ratings.refetch()]);
        setRevision((r) => r + 1);
        toast.error("A votação foi atualizada. Confira a lista e refaça suas escolhas.");
      }
      throw new Error(error.message);
    }
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["event-ratings", eventId] }),
      qc.invalidateQueries({ queryKey: ["court-rating-avg", current.venue_id] }),
    ]);
    setEditing(false);
    toast.success("Votação salva: craque com 5, pereba com 1 e demais presentes com 3.");
  }
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {back}
        <span className="text-sm text-muted-foreground">{current.title}</span>
      </div>
      <h1 className="text-3xl font-bold">Votação do evento</h1>
      {bodyLoading ? (
        <LoadingState />
      ) : bodyError ? (
        <ErrorState
          message={errMsg(bodyError)}
          onRetry={() => {
            void roster.refetch();
            void ratings.refetch();
            void teams.refetch();
          }}
        />
      ) : current.status !== "done" ? (
        <EmptyState
          title="Inicie a votação pela tela Times"
          description="Depois do sorteio, confirme os presentes e encerre o evento no botão Iniciar votação."
          action={back}
        />
      ) : !teams.data?.some((t) => t.event_team_players.length > 0) ? (
        <EmptyState title="Este evento ainda não possui times formados" action={back} />
      ) : present.length < 2 ? (
        <EmptyState
          title="São necessários pelo menos dois presentes"
          description="A votação precisa de jogadores diferentes para craque e pereba."
          action={back}
        />
      ) : isAdmin && (editing || ratings.data!.length === 0) ? (
        <EventVotingWizard
          key={`${eventId}:${revision}`}
          players={present}
          ratings={ratings.data!}
          onSave={save}
          onCancel={() => {
            void navigate({ to: "/times", search: { event: eventId } });
          }}
        />
      ) : (
        <section className="space-y-4 rounded-xl border bg-card p-4">
          <h2 className="text-xl font-semibold">
            {ratings.data!.length ? "Votação salva" : "Aguardando votação do administrador"}
          </h2>
          <div className="space-y-2">
            {present.map((player) => {
              const score = ratings.data!.find((r) => r.player_id === player.id)?.rating ?? 3;
              return (
                <div
                  key={player.id}
                  className="flex items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <span>
                    {player.nickname || player.name}
                    {score === 5 && (
                      <span className="ml-2 text-xs text-amber-500">Craque do dia</span>
                    )}
                    {score === 1 && (
                      <span className="ml-2 text-xs text-rose-500">Pereba da partida</span>
                    )}
                  </span>
                  <VotingStars score={score} />
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2">
            {isAdmin && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                Refazer votação
              </Button>
            )}
            <Button asChild>
              <Link to="/jogadores/ranking">Ver ranking dos jogadores</Link>
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
