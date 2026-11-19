import { ChevronDown, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PlayerRatingRank } from "@/lib/player-rating-ranking";

export type { PlayerRatingRank } from "@/lib/player-rating-ranking";

type Props = {
  rows: PlayerRatingRank[];
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
};

const averageFormat = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function RatingScore({ average }: { average: number | null }) {
  if (average === null)
    return (
      <span aria-label="Sem média" className="text-muted-foreground">
        —
      </span>
    );
  const label = averageFormat.format(average);
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap"
      aria-label={`Média ${label} de 5`}
    >
      <span className="inline-flex gap-px text-amber-400" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((star) => (
          <span key={star} className="relative block size-3 sm:size-3.5">
            <Star className="size-full opacity-35" />
            <span
              className="absolute inset-y-0 left-0 overflow-hidden"
              style={{ width: `${Math.max(0, Math.min(1, average - star)) * 100}%` }}
            >
              <Star className="size-3 fill-current sm:size-3.5" />
            </span>
          </span>
        ))}
      </span>
      <span className="text-xs font-bold tabular-nums sm:text-sm">{label}</span>
    </span>
  );
}

function ratingStatus(row: PlayerRatingRank) {
  if (row.blocked) return "Pontuação zerada";
  if (row.restarted)
    return row.events_count
      ? "Nova média após reinício"
      : "Aguardando nova participação após reinício";
  if (row.average === null) return "Sem participação válida";
  return null;
}

export function PlayerRatingRanking({ rows, loading, error, onRetry }: Props) {
  return (
    <section aria-label="Classificação completa" className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-lg font-bold">Classificação completa</h2>
        <span className="text-xs text-muted-foreground">Média de 0 a 5 estrelas</span>
      </div>
      {error ? (
        <div role="alert" className="space-y-2 rounded-xl border border-destructive/30 p-3">
          <p>Não foi possível carregar o ranking.</p>
          {onRetry && (
            <Button size="sm" onClick={onRetry}>
              Tentar novamente
            </Button>
          )}
        </div>
      ) : loading ? (
        <p role="status">Carregando ranking…</p>
      ) : !rows.length ? (
        <p className="text-sm text-muted-foreground">Nenhum jogador disponível nesta quadra.</p>
      ) : (
        <ul className="grid gap-2" aria-label="Médias e contagens por jogador">
          {rows.map((row) => {
            const status = ratingStatus(row);
            return (
              <li
                key={row.player_id}
                className="min-w-0 space-y-2 rounded-xl border bg-card px-3 py-2.5"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="shrink-0 text-xs tabular-nums text-muted-foreground"
                    aria-label={row.rank === null ? "Sem posição" : `Posição ${row.rank}`}
                  >
                    {row.rank === null ? "—" : `${row.rank}º`}
                  </span>
                  <h3 className="min-w-0 flex-1 break-words text-sm font-semibold">
                    {row.nickname || row.name}
                  </h3>
                  <RatingScore average={row.average} />
                </div>
                {status && <p className="text-xs text-muted-foreground">{status}</p>}
                <dl className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <div className="inline-flex gap-1">
                    <dt>Participações</dt>
                    <dd className="font-semibold tabular-nums text-foreground">
                      {row.events_count}
                    </dd>
                  </div>
                  <div className="inline-flex gap-1">
                    <dt>Avaliações</dt>
                    <dd className="font-semibold tabular-nums text-foreground">
                      {row.explicit_count}
                    </dd>
                  </div>
                  <div className="inline-flex gap-1">
                    <dt>Notas padrão (3)</dt>
                    <dd className="font-semibold tabular-nums text-foreground">
                      {row.default_count}
                    </dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ul>
      )}
      <details className="group rounded-xl border bg-card px-3 py-2 text-xs text-muted-foreground">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-medium text-foreground [&::-webkit-details-marker]:hidden">
          Como a média é calculada{" "}
          <ChevronDown aria-hidden="true" className="size-4 group-open:rotate-180" />
        </summary>
        <p className="mt-2">
          A média usa participações confirmadas com presença registrada em eventos finalizados. Cada
          avaliação vale de 1 a 5 estrelas. Sem avaliação, a participação recebe nota 3. Faltas não
          entram. Médias iguais compartilham a posição.
        </p>
        <p className="mt-2">
          Dívidas com mais de 10 dias de atraso zeram a pontuação. Após regularizar, a nova média
          começa com as próximas participações. As notas anteriores ficam no histórico.
        </p>
      </details>
    </section>
  );
}
