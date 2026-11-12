import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { CalendarDays, Check, Clock3, Copy, MapPin, Plus, Users, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useActiveGroup, useActiveCourt } from "@/lib/groups";
import { isMissingGuestSchema } from "@/lib/schema-compat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/events")({ component: EventsPage });
const db = supabase as any;
const empty = { title: "Pelada", date: "", start_time: "09:00", duration_minutes: "90", location: "", max_participants: "20", teams_count: "2", players_per_team: "10", goalkeepers_wanted: "2", deadline_hours: "24", waitlist_offer_minutes: "30", cancellation_rules: "", notes: "", occurrences: "1" };

function EventsPage() {
  const qc = useQueryClient();
  const groups = useActiveGroup();
  const group = groups.group;
  const court = useActiveCourt(group?.id);
  const [view, setView] = useState("list");
  const [period, setPeriod] = useState(new Date());
  const [form, setForm] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const auth = useQuery({ queryKey: ["event-current-user"], queryFn: async () => (await supabase.auth.getUser()).data.user?.id ?? null });

  const groupIds = (groups.data ?? []).map((item) => item.id);
  const roleByGroup = new Map((groups.data ?? []).map((item) => [item.id, item]));
  const memberVenues = useQuery({
    queryKey: ["event-calendar-venues", groupIds],
    enabled: groupIds.length > 0,
    queryFn: async () => {
      const { data, error } = await db.from("venues").select("id,name,group_id").in("group_id", groupIds);
      if (error) throw error;
      return data ?? [];
    },
  });
  const venueNames = useMemo(() => new Map((memberVenues.data ?? []).map((venue: any) => [venue.id, venue.name])), [memberVenues.data]);
  const events = useQuery({
    queryKey: ["events-calendar", groupIds],
    enabled: groupIds.length > 0,
    queryFn: async () => {
      const { data, error } = await db.from("events").select("*").in("group_id", groupIds).order("starts_at");
      if (error) throw error;
      return data ?? [];
    },
  });
  const eventRows = events.data ?? [];
  const eventIds = eventRows.map((event: any) => event.id);
  const rosters = useQuery({
    queryKey: ["event-rosters-calendar", groupIds, eventIds],
    enabled: groupIds.length > 0 && eventIds.length > 0,
    queryFn: async () => {
      const selection = "id,event_id,player_id,status,confirmed_at,waitlisted_at,offer_expires_at,created_at,players(id,name,nickname,position,goalkeeper_level,user_id,participation_type,is_event_guest,guest_responsible_player_id,guest_responsible:players!players_guest_responsible_player_id_fkey(name,nickname))";
      let { data, error } = await db.from("attendances").select(selection)
        .in("group_id", groupIds).in("event_id", eventIds);
      if (error && isMissingGuestSchema(error)) {
        ({ data, error } = await db.from("attendances").select("id,event_id,player_id,status,confirmed_at,waitlisted_at,offer_expires_at,created_at,players(id,name,nickname,position,goalkeeper_level,user_id)")
          .in("group_id", groupIds).in("event_id", eventIds));
      }
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 15000,
  });
  const myPlayers = useQuery({
    queryKey: ["event-players", groupIds, auth.data],
    enabled: groupIds.length > 0 && !!auth.data,
    queryFn: async () => {
      const { data, error } = await db.from("players").select("id,group_id,venue_id").in("group_id", groupIds).eq("user_id", auth.data);
      if (error) throw error;
      return data ?? [];
    },
  });

  const canManage = !!group && (group.role === "admin" || group.permissions.includes("events"));
  const playerByEvent = useMemo<Map<string, any>>(() => {
    const players = myPlayers.data ?? [];
    return new Map(eventRows.map((event: any) => [event.id, players.find((player: any) => player.group_id === event.group_id && player.venue_id === event.venue_id)]));
  }, [myPlayers.data, eventRows]);
  const canManageEvent = (event: any) => {
    const owner = roleByGroup.get(event.group_id);
    return !!owner && (owner.role === "admin" || owner.permissions.includes("events"));
  };
  const attendanceByEvent = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const row of rosters.data ?? []) map.set(row.event_id, [...(map.get(row.event_id) ?? []), row]);
    return map;
  }, [rosters.data]);
  const upcomingEvents = useMemo(() => eventRows.filter((e: any) => e.status === "scheduled" && new Date(e.starts_at) >= new Date()).sort((a: any, b: any) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()), [eventRows]);
  const closedEvents = useMemo(() => eventRows.filter((e: any) => e.status === "done" || e.status === "cancelled" || new Date(e.starts_at) < new Date()).sort((a: any, b: any) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime()), [eventRows]);
  const shown = useMemo(() => {
    if (view === "list") return upcomingEvents;
    if (view === "closed") return closedEvents;
    return upcomingEvents.filter((e: any) => {
      const d = new Date(e.starts_at);
      if (view === "month") return d.getMonth() === period.getMonth() && d.getFullYear() === period.getFullYear();
      const start = new Date(period); start.setDate(period.getDate() - ((period.getDay() + 6) % 7)); start.setHours(0, 0, 0, 0);
      const end = new Date(start); end.setDate(start.getDate() + 7);
      return d >= start && d < end;
    });
  }, [upcomingEvents, closedEvents, view, period]);
  const calendarDays = useMemo(() => getCalendarDays(view, period), [view, period]);

  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!group || !court.venue) return;
    setBusy("save"); const f = form; const deadline = Number(f.deadline_hours || 0);
    const template = { title: f.title, duration_minutes: Number(f.duration_minutes), location: f.location || court.venue.address, max_participants: Number(f.max_participants), teams_count: Number(f.teams_count), players_per_team: Number(f.players_per_team), goalkeepers_wanted: Number(f.goalkeepers_wanted), deadline_hours: deadline, waitlist_offer_minutes: f.waitlist_offer_minutes, cancellation_rules: f.cancellation_rules, notes: f.notes, timezone: "America/Sao_Paulo" };
    let error: any = null;
    if (Number(f.occurrences) > 1 && new Date(`${f.date}T12:00:00`).getDay() !== 0) { setBusy(null); toast.error("Para criar recorrência semanal, escolha um domingo."); return; }
    if (Number(f.occurrences) > 1) {
      const result = await db.rpc("create_event_series", { _group_id: group.id, _venue_id: court.venue.id, _first_date: f.date, _occurrences: Number(f.occurrences), _start_time: f.start_time, _template: template }); error = result.error;
    } else {
      const starts = new Date(`${f.date}T${f.start_time}:00-03:00`).toISOString();
      const result = await db.from("events").insert({ group_id: group.id, venue_id: court.venue.id, title: f.title, starts_at: starts, duration_minutes: Number(f.duration_minutes), location: f.location || court.venue.address || null, max_participants: Number(f.max_participants), teams_count: Number(f.teams_count), players_per_team: Number(f.players_per_team), goalkeepers_wanted: Number(f.goalkeepers_wanted), confirm_deadline: deadline ? new Date(new Date(starts).getTime() - deadline * 3600000).toISOString() : null, waitlist_offer_minutes: Number(f.waitlist_offer_minutes) || null, cancellation_rules: f.cancellation_rules || null, notes: f.notes || null, created_by: auth.data }); error = result.error;
    }
    setBusy(null);
    if (error) toast.error(error.message); else { toast.success(Number(f.occurrences) > 1 ? "Série de jogos criada" : "Jogo criado"); setForm(null); await qc.invalidateQueries({ queryKey: ["events", group.id] }); }
  }
  async function duplicate(e: any) {
    const start = new Date(e.starts_at); start.setDate(start.getDate() + 7);
    const { error } = await db.from("events").insert({ ...Object.fromEntries(Object.entries(e).filter(([k]) => !["id", "created_at", "updated_at", "series_id"].includes(k))), series_id: null, starts_at: start.toISOString(), created_by: auth.data });
    if (error) toast.error(error.message); else { toast.success("Jogo duplicado para a semana seguinte"); qc.invalidateQueries({ queryKey: ["events-calendar"] }); }
  }
  async function cancelEvent(e: any) {
    if (!confirm("Cancelar este jogo?")) return;
    const { error } = await db.from("events").update({ status: "cancelled" }).eq("id", e.id).eq("group_id", e.group_id);
    if (error) toast.error(error.message); else { toast.success("Jogo cancelado"); qc.invalidateQueries({ queryKey: ["events-calendar"] }); }
  }
  async function rsvp(e: any, action: "rsvp_confirm" | "rsvp_cancel") {
    const player = playerByEvent.get(e.id);
    if (!player?.id) { toast.error("Sua conta ainda não está vinculada a esta quadra. Peça ao administrador para aprovar sua entrada."); return; }
    setBusy(e.id);
    const { data, error } = await db.rpc(action, { _event_id: e.id, _player_id: player.id });
    setBusy(null);
    if (error) toast.error(error.message);
    else {
      toast.success(action === "rsvp_cancel" ? "Presença cancelada" : data === "waitlist" ? "Você entrou na lista de espera" : "Presença confirmada");
      await Promise.all([qc.invalidateQueries({ queryKey: ["event-rosters-calendar"] }), qc.invalidateQueries({ queryKey: ["attendance", e.id] }), qc.invalidateQueries({ queryKey: ["events-calendar"] })]);
    }
  }

  if (!group) return <div className="space-y-3"><h1 className="text-3xl font-bold">Eventos</h1><p className="text-muted-foreground">Crie sua quadra gratuitamente ou aceite um convite para ver a agenda.</p><Button asChild><Link to="/dashboard">Ir para início</Link></Button></div>;
  return <div className="mx-auto max-w-7xl space-y-6">
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="text-3xl font-bold">Eventos</h1><p className="text-sm text-muted-foreground">Agenda de todas as suas quadras</p></div>{canManage && court.venue && <Button className="w-full sm:w-auto" onClick={() => setForm({ ...empty, date: new Date().toISOString().slice(0, 10), location: court.venue!.address ?? "" })}><Plus className="mr-2 h-4 w-4" />Novo evento</Button>}</header>
    <div className="space-y-3"><select aria-label="Visualização da agenda" className="min-h-11 w-full rounded-xl border bg-card px-3 text-sm font-medium sm:w-60" value={view} onChange={(e) => setView(e.target.value)}><option value="list">Lista</option><option value="week">Semana</option><option value="month">Mês</option><option value="closed">Encerrados</option></select>{(view === "week" || view === "month") && <div className="flex items-center gap-2"><Button size="sm" variant="outline" onClick={() => { const d = new Date(period); d.setDate(d.getDate() - (view === "month" ? 30 : 7)); setPeriod(d); }}>‹</Button><strong className="min-w-0 flex-1 text-center">{period.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}</strong><Button size="sm" variant="outline" onClick={() => { const d = new Date(period); d.setDate(d.getDate() + (view === "month" ? 30 : 7)); setPeriod(d); }}>›</Button></div>}</div>
    {view === "list" || view === "closed" ? <div className="grid gap-3">{shown.map((e: any) => <EventCard key={e.id} event={e} venueName={venueNames.get(e.venue_id)} rows={attendanceByEvent.get(e.id) ?? []} rosterLoading={rosters.isLoading} rosterError={rosters.isError} playerId={playerByEvent.get(e.id)?.id} canManage={canManageEvent(e)} busy={busy === e.id} onRsvp={(action: "rsvp_confirm" | "rsvp_cancel") => rsvp(e, action)} duplicate={() => duplicate(e)} cancel={() => cancelEvent(e)} />)}{!shown.length && <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{view === "closed" ? "Nenhum evento encerrado ainda." : "Nenhum evento futuro agendado."}</div>}</div> : <><div className="space-y-2 sm:hidden">{shown.map((e: any) => { const rows = attendanceByEvent.get(e.id) ?? []; const reserved = rows.filter((r: any) => ["confirmed", "offered"].includes(r.status)).length; const free = Math.max(0, Number(e.max_participants) - reserved); return <Link key={e.id} to="/events/$eventId" params={{ eventId: e.id }} className="flex items-center justify-between gap-3 rounded-xl border bg-card p-3"><span className="min-w-0"><strong className="block truncate">{e.title}</strong><span className="block truncate text-xs text-muted-foreground">{new Date(e.starts_at).toLocaleString("pt-BR", { dateStyle: "medium", timeStyle: "short" })} · {venueNames.get(e.venue_id) ?? e.location}</span></span><span className="shrink-0 text-right text-xs"><strong className="block">{free} vagas</strong><span className="text-muted-foreground">{reserved}/{e.max_participants}</span></span></Link>; })}</div><div className="hidden sm:grid grid-cols-7 gap-px overflow-hidden rounded-xl border bg-border">{["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map(d => <div key={d} className="bg-muted p-2 text-center text-xs font-semibold">{d}</div>)}{calendarDays.map(day => { const dayEvents = shown.filter((e: any) => new Date(e.starts_at).toDateString() === day.toDateString()); return <div key={day.toISOString()} className={`min-h-28 bg-card p-1 sm:min-h-36 ${day.getMonth() !== period.getMonth() && view === "month" ? "opacity-50" : ""}`}><div className="mb-1 text-xs font-medium">{day.getDate()}</div>{dayEvents.map((e: any) => { const rows = attendanceByEvent.get(e.id) ?? []; const reserved = rows.filter((r: any) => ["confirmed", "offered"].includes(r.status)).length; const free = Math.max(0, Number(e.max_participants) - reserved); return <Link key={e.id} to="/events/$eventId" params={{ eventId: e.id }} className="mb-1 block rounded bg-primary/10 px-1.5 py-1 text-[10px] text-primary sm:text-xs"><span className="block truncate">{new Date(e.starts_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} {e.title}</span><span className="block truncate">{venueNames.get(e.venue_id) ?? e.location}</span><span>{rosters.isLoading ? "…" : `${reserved}/${e.max_participants} · ${free} vagas`}</span></Link>; })}</div>; })}</div></>}
    {form && <div className="fixed inset-0 z-50 overflow-auto bg-black/50 p-4"><form onSubmit={save} className="mx-auto my-6 grid max-w-3xl gap-3 rounded-xl bg-background p-5 sm:grid-cols-2"><h2 className="sm:col-span-2 text-xl font-bold">Agendar em {court.venue.name}</h2><Field label="Título" value={form.title} onChange={(v: string) => setForm({ ...form, title: v })} /><Field label="Data" type="date" value={form.date} onChange={(v: string) => setForm({ ...form, date: v })} /><Field label="Horário" type="time" value={form.start_time} onChange={(v: string) => setForm({ ...form, start_time: v })} /><Field label="Local" value={form.location} onChange={(v: string) => setForm({ ...form, location: v })} /><Field label="Duração (minutos)" type="number" value={form.duration_minutes} onChange={(v: string) => setForm({ ...form, duration_minutes: v })} /><Field label="Limite de participantes" type="number" value={form.max_participants} onChange={(v: string) => setForm({ ...form, max_participants: v })} /><Field label="Número de times" type="number" value={form.teams_count} onChange={(v: string) => setForm({ ...form, teams_count: v })} /><Field label="Jogadores por time" type="number" value={form.players_per_team} onChange={(v: string) => setForm({ ...form, players_per_team: v })} /><Field label="Goleiros desejados" type="number" value={form.goalkeepers_wanted} onChange={(v: string) => setForm({ ...form, goalkeepers_wanted: v })} /><Field label="Prazo de confirmação antes (horas)" type="number" value={form.deadline_hours} onChange={(v: string) => setForm({ ...form, deadline_hours: v })} /><Field label="Prazo da oferta da fila (minutos; 0 confirma automaticamente)" type="number" value={form.waitlist_offer_minutes} onChange={(v: string) => setForm({ ...form, waitlist_offer_minutes: v })} /><Field label="Recorrências semanais (1 a 52)" type="number" value={form.occurrences} onChange={(v: string) => setForm({ ...form, occurrences: v })} /><div className="sm:col-span-2"><Label>Regras de cancelamento</Label><textarea className="mt-1 w-full rounded-md border bg-background p-2" value={form.cancellation_rules} onChange={e => setForm({ ...form, cancellation_rules: e.target.value })} /></div><div className="sm:col-span-2"><Label>Observações</Label><textarea className="mt-1 w-full rounded-md border bg-background p-2" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div><div className="sm:col-span-2 flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setForm(null)}>Fechar</Button><Button disabled={busy === "save"}>{busy === "save" ? "Criando…" : "Salvar evento(s)"}</Button></div></form></div>}
  </div>;
}

function Field({ label, value, onChange, type = "text" }: any) { return <div><Label>{label}</Label><Input className="mt-1" type={type} value={value} onChange={e => onChange(e.target.value)} required={label === "Data" || label === "Horário"} /></div>; }
function EventCard({ event: e, venueName, rows, rosterLoading, rosterError, playerId, canManage, busy, onRsvp, duplicate, cancel }: any) {
  const [showRoster, setShowRoster] = useState(false);
  const confirmed = rows.filter((r: any) => r.status === "confirmed");
  const reserved = rows.filter((r: any) => ["confirmed", "offered"].includes(r.status));
  const waiting = rows.filter((r: any) => r.status === "waitlist").sort((a: any, b: any) => new Date(a.waitlisted_at ?? a.created_at).getTime() - new Date(b.waitlisted_at ?? b.created_at).getTime());
  const goalkeepers = confirmed.filter((r: any) => isGoalkeeper(r.players));
  const fieldPlayers = confirmed.filter((r: any) => !isGoalkeeper(r.players));
  const offers = rows.filter((r: any) => r.status === "offered");
  const free = Math.max(0, Number(e.max_participants) - reserved.length);
  const own = playerId ? rows.find((r: any) => r.player_id === playerId && ["confirmed", "offered", "waitlist"].includes(r.status)) : null;
  const ownWaitPosition = own?.status === "waitlist" ? waiting.findIndex((r: any) => r.id === own.id) + 1 : null;
  const expired = e.confirm_deadline && new Date(e.confirm_deadline) < new Date();
  const names = (r: any) => r.players?.nickname ? r.players.name + " “" + r.players.nickname + "”" : r.players?.name ?? "Jogador";
  const titleStatus = e.status === "scheduled" && new Date(e.starts_at) < new Date() ? "Encerrado" : e.status === "done" ? "Encerrado" : e.status === "cancelled" ? "Cancelado" : "Agendado";
  const place = [venueName, e.location].filter((value, index, values) => value && values.indexOf(value) === index).join(" · ") || "Local a definir";

  return <article className="overflow-hidden rounded-2xl border bg-card shadow-sm">
    <div className="space-y-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-xl font-bold">{e.title}</h2><Badge variant={titleStatus === "Agendado" ? "secondary" : "outline"}>{titleStatus}</Badge></div>
          <p className="mt-1 truncate text-sm text-muted-foreground">{new Date(e.starts_at).toLocaleString("pt-BR", { dateStyle: "medium", timeStyle: "short" })} · {place}</p>
        </div>
        <div className="shrink-0 rounded-lg bg-muted/50 px-3 py-2 text-center"><strong className="block text-lg leading-tight">{rosterLoading || rosterError ? "—" : free}</strong><span className="text-[10px] uppercase text-muted-foreground">vagas</span></div>
      </div>
      {own ? <div className="flex flex-col gap-2 sm:flex-row sm:items-center"><Badge variant="secondary" className="w-fit">{own.status === "confirmed" ? "Presença confirmada" : own.status === "offered" ? "Vaga oferecida" : "Espera · posição " + ownWaitPosition}</Badge><Button className="w-full sm:w-auto" size="sm" variant="outline" disabled={busy || rosterLoading} onClick={() => onRsvp("rsvp_cancel")}><X className="mr-1 h-4 w-4" />Cancelar presença</Button></div> : <Button className="w-full" disabled={busy || rosterLoading || rosterError || e.status !== "scheduled" || !!expired || !playerId} onClick={() => onRsvp("rsvp_confirm")}><Check className="mr-2 h-4 w-4" />{!playerId ? "Vincule seu cadastro" : expired ? "Confirmação encerrada" : free > 0 ? "Confirmar presença" : "Entrar na lista de espera"}</Button>}
    </div>
    <details className="border-t px-4 py-3">
      <summary className="cursor-pointer list-none text-sm font-semibold text-primary [&::-webkit-details-marker]:hidden">Ver detalhes do evento</summary>
      <div className="mt-3 space-y-3">
        <div className="grid grid-cols-3 gap-2"><CompactStat label="Vagas" value={rosterLoading || rosterError ? "—" : free} hint={"de " + e.max_participants} /><CompactStat label="Goleiros" value={rosterLoading ? "…" : goalkeepers.length} hint={"meta " + (e.goalkeepers_wanted ?? 0)} /><CompactStat label="Confirmados" value={rosterLoading ? "…" : confirmed.length} /></div>
        <div className="grid grid-cols-2 gap-2 text-sm"><Detail icon={<MapPin />} label="Local" value={place} /><Detail icon={<Clock3 />} label="Duração" value={e.duration_minutes + " min"} /><Detail icon={<Users />} label="Times desejados" value={e.teams_count} /><Detail icon={<Users />} label="Jogadores por time" value={e.players_per_team} /></div>
        {e.confirm_deadline && <p className="text-xs text-muted-foreground">Confirmação até {new Date(e.confirm_deadline).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</p>}
        {e.cancellation_rules && <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">Regras de cancelamento</summary><p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{e.cancellation_rules}</p></details>}
        {e.notes && <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">Observações</summary><p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{e.notes}</p></details>}
        <section className="rounded-xl border p-3">
          <div className="flex items-center justify-between gap-2"><div><h3 className="font-semibold">Lista de presença</h3><p className="text-xs text-muted-foreground">{confirmed.length} confirmados · {waiting.length} na espera{offers.length ? " · " + offers.length + " vaga(s) oferecida(s)" : ""}</p></div><Button size="sm" variant="outline" disabled={rosterLoading || rosterError} aria-expanded={showRoster} onClick={() => setShowRoster(!showRoster)}>{showRoster ? "Ocultar" : "Ver lista"}</Button></div>
          {rosterError && <p className="mt-3 text-sm text-destructive">Não foi possível carregar as presenças. Atualize a página para tentar novamente.</p>}
          {showRoster && !rosterError && <div className="mt-3 space-y-3">{[["Goleiros", goalkeepers], ["Jogadores de linha", fieldPlayers]].map(([label, list]: any) => <div key={label}><h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label} ({list.length})</h4>{list.length ? <ul className="space-y-1.5">{list.map((r: any) => <GuestName key={r.id} row={r} names={names} />)}</ul> : <p className="text-xs text-muted-foreground">Nenhum confirmado.</p>}</div>)}{offers.length > 0 && <div><h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Vaga oferecida</h4>{offers.map((r: any) => <p key={r.id} className="text-sm">{names(r)}</p>)}</div>}{waiting.length > 0 && <div><h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lista de espera</h4><ol className="space-y-1 text-sm">{waiting.map((r: any, i: number) => <li key={r.id}>{i + 1}. {names(r)}</li>)}</ol></div>}</div>}
        </section>
        <div className="flex flex-wrap gap-2"><Button asChild variant="outline"><Link to="/events/$eventId" params={{ eventId: e.id }}>Lista completa</Link></Button>{canManage && e.status === "scheduled" && <><Button size="icon" variant="outline" aria-label="Duplicar evento" onClick={duplicate}><Copy className="h-4 w-4" /></Button><Button size="sm" variant="outline" onClick={cancel}>Cancelar evento</Button></>}</div>
      </div>
    </details>
  </article>;
}
function isGoalkeeper(player: any) { return player?.position === "Goleiro" || player?.goalkeeper_level != null; }
function GuestName({ row, names }: any) { const responsible = row.players?.guest_responsible; return <li className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-sm"><span>{names(row)}{row.players?.is_event_guest && <Badge className="ml-2 align-middle" variant="outline">Avulso</Badge>}</span><span className="text-xs text-muted-foreground">{row.players?.position ?? "Posição não informada"}{row.players?.is_event_guest ? ` · responsável: ${responsible?.nickname || responsible?.name || "não informado"}` : ""}</span></li>; }
function CompactStat({ label, value, hint }: any) { return <div className="min-w-0 rounded-lg border bg-background px-2 py-2 text-center"><div className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div><div className="text-xl font-bold leading-tight">{value}</div>{hint && <div className="truncate text-[10px] text-muted-foreground">{hint}</div>}</div>; }
function Detail({ icon, label, value }: any) { return <div className="flex min-w-0 gap-2 rounded-lg bg-muted/30 p-2.5"><span className="mt-0.5 shrink-0 text-muted-foreground [&>svg]:h-4 [&>svg]:w-4">{icon}</span><div className="min-w-0"><div className="text-xs text-muted-foreground">{label}</div><div className="break-words font-medium">{value}</div></div></div>; }
function getCalendarDays(view: string, period: Date) { const first = new Date(period.getFullYear(), period.getMonth(), 1, 12); const start = view === "month" ? new Date(first.getFullYear(), first.getMonth(), 1 - ((first.getDay() + 6) % 7), 12) : new Date(period.getFullYear(), period.getMonth(), period.getDate() - ((period.getDay() + 6) % 7), 12); const count = view === "month" ? 42 : 7; return Array.from({ length: count }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i, 12)); }
