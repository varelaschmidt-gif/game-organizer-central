import { useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { loadEventVotingRoster, type EventVotingRoster } from "@/lib/event-voting";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
} from "@/components/ui/alert-dialog";

type Props = {
  eventId: string;
  title: string;
  status: string;
  groupId: string;
  venueId: string;
  disabled?: boolean;
};
export function StartEventVoting({ eventId, title, status, groupId, venueId, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const roster = useQuery({
    queryKey: ["event-voting-roster", eventId],
    enabled: open && status === "scheduled",
    queryFn: () => loadEventVotingRoster(eventId, groupId, venueId),
  });
  async function start(presentIds: string[]) {
    if (sending.current || presentIds.length < 2) return;
    sending.current = true;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("start_event_voting", {
        _event_id: eventId,
        _present_ids: presentIds,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      setOpen(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["events"] }),
        qc.invalidateQueries({ queryKey: ["event", eventId] }),
        qc.invalidateQueries({ queryKey: ["attendance", eventId] }),
        qc.invalidateQueries({ queryKey: ["event-voting-roster", eventId] }),
        qc.invalidateQueries({ queryKey: ["court-rating-avg", venueId] }),
      ]);
      await navigate({ to: "/times/votacao/$eventId", params: { eventId } });
    } catch {
      toast.error(
        "Não foi possível confirmar o início. Atualize o evento antes de tentar novamente.",
      );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  if (status === "done")
    return (
      <Button asChild variant="outline" disabled={disabled}>
        <Link to="/times/votacao/$eventId" params={{ eventId }}>
          Abrir votação
        </Link>
      </Button>
    );
  if (status !== "scheduled") return null;
  return (
    <>
      <Button disabled={disabled || busy} onClick={() => setOpen(true)}>
        Iniciar votação
      </Button>
      <AlertDialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <AlertDialogContent className="max-h-[90dvh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>Iniciar votação · {title}</AlertDialogTitle>
            <AlertDialogDescription>
              Confirme quem esteve presente. Esta ação encerra o evento agora, mesmo antes do
              horário previsto, e mantém os times salvos. Quem não for marcado ficará como ausente e
              não entrará na média.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {roster.isPending ? (
            <p role="status">Carregando participantes…</p>
          ) : roster.isError ? (
            <div role="alert">
              <p>Não foi possível carregar os participantes.</p>
              <Button onClick={() => void roster.refetch()}>Tentar novamente</Button>
            </div>
          ) : (
            <PresencePicker
              rows={roster.data}
              busy={busy}
              onCancel={() => setOpen(false)}
              onStart={(ids) => void start(ids)}
            />
          )}
          {(roster.isPending || roster.isError) && (
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function PresencePicker({
  rows,
  busy,
  onStart,
  onCancel,
}: {
  rows: EventVotingRoster[];
  busy: boolean;
  onStart: (ids: string[]) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState(() =>
    rows.filter((row) => row.attended === true).map((row) => row.player_id),
  );
  const ids = selected.filter((id) => rows.some((row) => row.player_id === id));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">Presentes: {ids.length}</p>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => setSelected(rows.map((row) => row.player_id))}
        >
          Marcar todos como presentes
        </Button>
      </div>
      <fieldset disabled={busy} className="max-h-72 space-y-2 overflow-y-auto">
        <legend className="sr-only">Confirmar presença dos jogadores</legend>
        {rows.map((row) => (
          <label
            key={row.player_id}
            className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm"
          >
            <input
              type="checkbox"
              checked={ids.includes(row.player_id)}
              onChange={(e) =>
                setSelected((current) =>
                  e.target.checked
                    ? [...current, row.player_id]
                    : current.filter((id) => id !== row.player_id),
                )
              }
            />
            <span>
              {row.players?.nickname || row.players?.name}
              <span className="block text-xs text-muted-foreground">
                {row.attended === true
                  ? "Presença já registrada"
                  : row.attended === false
                    ? "Ausência registrada; marque somente se compareceu"
                    : "Presença ainda não registrada"}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      {ids.length < 2 && (
        <p className="text-sm text-muted-foreground">
          Confirme pelo menos dois presentes para escolher um craque e um pereba diferentes.
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" disabled={busy} onClick={onCancel}>
          Cancelar
        </Button>
        <Button disabled={busy || ids.length < 2} onClick={() => onStart(ids)}>
          {busy ? "Encerrando…" : "Encerrar evento e iniciar votação"}
        </Button>
      </div>
    </div>
  );
}
