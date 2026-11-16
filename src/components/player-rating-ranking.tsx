import { Button } from "@/components/ui/button";
import type { PlayerRatingRank } from "@/lib/player-rating-ranking";
export type { PlayerRatingRank } from "@/lib/player-rating-ranking";

type Props = {
  rows: PlayerRatingRank[];
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
};

export function PlayerRatingRanking({ rows, loading, error, onRetry }: Props) {
  return (
    <section aria-label="Ranking dos jogadores" className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="text-xl font-semibold">Ranking de avaliações</h2>
      <p className="text-sm text-muted-foreground">
        Média de 1 a 5 estrelas das participações confirmadas e marcadas como presentes em eventos
        finalizados. Sem avaliação, a participação recebe 3 estrelas no cálculo. Faltas não entram.
        Médias iguais compartilham a posição.
      </p>
      <p className="text-sm text-muted-foreground">
        Dívida com mais de 10 dias de atraso zera a pontuação. Após regularizar, uma nova média
        começa com as próximas participações; as notas anteriores ficam apenas no histórico.
      </p>
      {error ? (
        <div role="alert" className="space-y-2">
          <p>Não foi possível carregar o ranking.</p>
          {onRetry && <Button onClick={onRetry}>Tentar novamente</Button>}
        </div>
      ) : loading ? (
        <p role="status">Carregando ranking…</p>
      ) : !rows.length ? (
        <p>Nenhum jogador disponível nesta quadra.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              Médias e quantidade de participações consideradas por jogador
            </caption>
            <thead>
              <tr className="border-b">
                <th scope="col" className="p-2">
                  Posição
                </th>
                <th scope="col" className="p-2">
                  Jogador
                </th>
                <th scope="col" className="p-2">
                  Média
                </th>
                <th scope="col" className="p-2">
                  Participações
                </th>
                <th scope="col" className="p-2">
                  Avaliações recebidas
                </th>
                <th scope="col" className="p-2">
                  Notas padrão (3)
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.player_id} className="border-b last:border-0">
                  <td className="p-2">{row.rank ?? "—"}</td>
                  <th scope="row" className="p-2 font-medium">
                    {row.nickname || row.name}
                    <span className="block text-xs font-normal text-muted-foreground">
                      {row.blocked
                        ? "Pontuação zerada"
                        : row.restarted
                          ? row.events_count
                            ? "Nova média após reinício"
                            : "Aguardando nova participação após reinício"
                          : row.average === null
                            ? "Sem participação válida"
                            : ""}
                    </span>
                  </th>
                  <td className="whitespace-nowrap p-2">
                    {row.average === null
                      ? "—"
                      : `${row.average.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / 5`}
                  </td>
                  <td className="p-2">{row.events_count}</td>
                  <td className="p-2">{row.explicit_count}</td>
                  <td className="p-2">{row.default_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
