import { useRef, useState } from "react";
import { Star, Trophy, Footprints, ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import {
  votingScore,
  votingSnapshot,
  type EventVotingPlayer,
  type EventVotingRating,
} from "@/lib/event-voting";

export function VotingStars({ score }: { score: number }) {
  return (
    <span
      className="inline-flex gap-0.5"
      aria-label={`${score} ${score === 1 ? "estrela" : "estrelas"}`}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          aria-hidden="true"
          className={`h-4 w-4 ${n <= score ? "fill-current" : "opacity-20"}`}
        />
      ))}
    </span>
  );
}

type Props = {
  players: EventVotingPlayer[];
  ratings: EventVotingRating[];
  onSave: (
    best: string,
    worst: string,
    expectedPlayers: string[],
    expectedRatings: EventVotingRating[],
  ) => Promise<void>;
  onCancel: () => void;
};

export function EventVotingWizard({ players, ratings, onSave, onCancel }: Props) {
  const [step, setStep] = useState<"best" | "worst">("best");
  const [best, setBest] = useState<string | null>(null);
  const [worst, setWorst] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [snapshot] = useState(() => ({
    players: players.map((p) => p.id).sort(),
    ratings: votingSnapshot(ratings),
  }));
  const saving = useRef(false);
  const isBest = step === "best";
  const bestPlayer = players.find((p) => p.id === best);
  const worstPlayer = players.find((p) => p.id === worst);
  const selected = isBest ? best : worst;
  function choose(id: string) {
    if (busy || (!isBest && id === best)) return;
    if (isBest) {
      setBest(id);
      if (worst === id) setWorst(null);
    } else setWorst(id);
  }
  async function save() {
    if (!best || !worst || best === worst || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      await onSave(best, worst, snapshot.players, snapshot.ratings);
      setConfirmation(false);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Não foi possível salvar. Confira a votação e tente novamente.",
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="space-y-5">
      <header
        className={`rounded-2xl border p-5 sm:p-7 ${isBest ? "border-amber-500/30 bg-gradient-to-br from-amber-500/15 to-background" : "border-rose-500/30 bg-gradient-to-br from-rose-500/15 to-background"}`}
      >
        <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Etapa {isBest ? 1 : 2} de 2
        </div>
        {isBest ? (
          <Trophy className="mb-3 h-8 w-8 text-amber-500" />
        ) : (
          <Footprints className="mb-3 h-8 w-8 text-rose-500" />
        )}
        <h2 className="text-2xl font-bold sm:text-3xl">
          {isBest ? "Craque do dia" : "Pereba da partida"}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {isBest
            ? "Todos os presentes começam com 3 estrelas. Escolha quem merece 5 hoje."
            : "Agora escolha quem recebe 1 estrela. O craque já escolhido não pode ser o pereba."}
        </p>
      </header>
      <div
        role="radiogroup"
        aria-label={isBest ? "Escolha o craque do dia" : "Escolha o pereba da partida"}
        className="grid gap-3 sm:grid-cols-2"
      >
        {players.map((player) => {
          const disabled = busy || (!isBest && player.id === best);
          const score = votingScore(player.id, best, isBest ? null : worst);
          return (
            <button
              type="button"
              role="radio"
              aria-checked={selected === player.id}
              disabled={disabled}
              key={player.id}
              onClick={() => choose(player.id)}
              className={`flex items-center justify-between gap-3 rounded-xl border p-4 text-left transition-colors disabled:cursor-not-allowed ${selected === player.id ? (isBest ? "border-amber-500 bg-amber-500/10" : "border-rose-500 bg-rose-500/10") : "border-border bg-card hover:bg-muted/50"}`}
            >
              <span>
                <span className="block font-semibold">{player.nickname || player.name}</span>
                <span className="text-xs text-muted-foreground">
                  {!isBest && player.id === best
                    ? "Craque do dia · 5 estrelas"
                    : player.position || "Presente neste evento"}
                </span>
              </span>
              <span
                className={
                  score === 5
                    ? "text-amber-500"
                    : score === 1
                      ? "text-rose-500"
                      : "text-muted-foreground"
                }
              >
                <VotingStars score={score} />
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" disabled={busy} onClick={isBest ? onCancel : () => setStep("best")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {isBest ? "Sair da votação" : "Voltar ao craque"}
        </Button>
        <Button
          disabled={!selected || busy || players.length < 2}
          onClick={() => (isBest ? setStep("worst") : setConfirmation(true))}
        >
          {isBest ? "Continuar para o pereba" : "Concluir votação"}
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        O evento já está encerrado. Suas escolhas só são salvas ao confirmar as duas etapas; sair
        não altera as avaliações salvas.
      </p>
      <AlertDialog
        open={confirmation}
        onOpenChange={(open) => {
          if (!busy) {
            setConfirmation(open);
            setError("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Salvar votação?</AlertDialogTitle>
            <AlertDialogDescription>
              {bestPlayer?.nickname || bestPlayer?.name} recebe 5 estrelas;{" "}
              {worstPlayer?.nickname || worstPlayer?.name} recebe 1. Os demais presentes ficam com 3
              no cálculo.
              {snapshot.ratings.length > 0 &&
                " As avaliações anteriores deste evento serão substituídas."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Revisar escolhas</AlertDialogCancel>
            <Button disabled={busy} onClick={() => void save()}>
              {busy ? "Salvando…" : "Salvar votação"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
