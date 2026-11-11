import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { CalendarDays, Check, Clock3, Copy, MapPin, Plus, Users, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getActiveGroupId, myGroupsQuery, useActiveCourt } from "@/lib/groups";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/events")({ component: EventsPage });
const db = supabase as any;
const empty = { title: "Pelada", date: "", start_time: "09:00", duration_minutes: "90", location: "", max_participants: "20", teams_count: "2", players_per_team: "10", goalkeepers_wanted: "2", price: "", deadline_hours: "24", waitlist_offer_minutes: "30", cancellation_rules: "", notes: "", occurrences: "1" };

function EventsPage() {
  const qc = useQueryClient();
  const groups = useQuery(myGroupsQuery);
  const group = groups.data?.find(g => g.id === getActiveGroupId()) ?? groups.data?.[0];
  const court = useActiveCourt(group?.id);
  const [view, setView] = useState("list");
  const [period, setPeriod] = useState(new Date());
  const [form, setForm] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const auth = useQuery({ queryKey: ["event-current-user"], queryFn: async () => (await supabase.auth.getUser()).data.user?.id ?? null });

  const events = useQuery({
    queryKey: ["events", group?.id, court.venue?.id],
    enabled: !!group && !!court.venue,
    queryFn: async () => {
      const { data, error } = await db.from("events").select("*").eq("group_id", group!.id).eq("venue_id", court.venue!.id).order("starts_at");
      if (error) throw error;
      return data ?? [];
    },
  });
  const eventRows = events.data ?? [];
  const eventIds = eventRows.map((event: any) => event.id);
  const rosters = useQuery({
    queryKey: ["event-rosters", group?.id, court.venue?.id, eventIds],
    enabled: !!group && !!court.venue && eventIds.length > 0,
    queryFn: async () => {
      const { data, error } = await db.from("attendances").select("id,event_id,player_id,status,confirmed_at,waitlisted_at,offer_expires_at,created_at,players(id,name,nickname,position,goalkeeper_level,user_id)")
        .eq("group_id", group!.id).in("event_id", eventIds);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 15000,
  });
  const myPlayer = useQuery({
    queryKey: ["event-player", group?.id, court.venue?.id, auth.data],
    enabled: !!group && !!court.venue && !!auth.data,
    queryFn: async () => {
      const { data, error } = await db.from("players").select("id").eq("group_id", group!.id).eq("venue_id", court.venue!.id).eq("user_id", auth.data).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const canManage = !!group && (group.role === "admin" || group.permissions.includes("events"));
  const attendanceByEvent = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const row of rosters.data ?? []) map.set(row.event_id, [...(map.get(row.event_id) ?? []), row]);
    return map;
  }, [rosters.data]);
  const shown = useMemo(() => {
    if (view === "list") return eventRows;
    return eventRows.filter((e: any) => {
      const d = new Date(e.starts_at);
      if (view === "month") return d.getMonth() === period.getMonth() && d.getFullYear() === period.getFullYear();
      const start = new Date(period); start.setDate(period.getDate() - ((period.getDay() + 6) % 7)); start.setHours(0, 0, 0, 0);
      const end = new Date(start); end.setDate(start.getDate() + 7);
      return d >= start && d < end;
    });
  }, [eventRows, view, period]);
  const calendarDays = useMemo(() => getCalendarDays(view, period), [view, period]);

  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!group || !court.venue) return;
    setBusy("save"); const f = form; const deadline = Number(f.deadline_hours || 0);
    const template = { title: f.title, duration_minutes: Number(f.duration_minutes), location: f.location || court.venue.address, max_participants: Number(f.max_participants), teams_count: Number(f.teams_count), players_per_team: Number(f.players_per_team), goalkeepers_wanted: Number(f.goalkeepers_wanted), price: f.price, deadline_hours: deadline, waitlist_offer_minutes: f.waitlist_offer_minutes, cancellation_rules: f.cancellation_rules, notes: f.notes, timezone: "America/Sao_Paulo" };
    let error: any = null;
    if (Number(f.occurrences) > 1 && new Date(`${f.date}T12:00:00`).getDay() !== 0) { setBusy(null); toast.error("Para criar recorrência semanal, escolha um domingo."); return; }
    if (Number(f.occurrences) > 1) {
      const result = await db.rpc("create_event_series", { _group_id: group.id, _venue_id: court.venue.id, _first_date: f.date, _occurrences: Number(f.occurrences), _start_time: f.start_time, _template: template }); error = result.error;
    } else {
      const starts = new Date(`${f.date}T${f.start_time}:00-03:00`).toISOString();
      const result = await db.from("events").insert({ group_id: group.id, venue_id: court.venue.id, title: f.title, starts_at: starts, duration_minutes: Number(f.duration_minutes), location: f.location || court.venue.address || null, max_participants: Number(f.max_participants), teams_count: Number(f.teams_count), players_per_team: Number(f.players_per_team), goalkeepers_wanted: Number(f.goalkeepers_wanted), price: f.price || null, confirm_deadline: deadline ? new Date(new Date(starts).getTime() - deadline * 3600000).toISOString() : null, waitlist_offer_minutes: Number(f.waitlist_offer_minutes) || null, cancellation_rules: f.cancellation_rules || null, notes: f.notes || null, created_by: auth.data }); error = result.error;
    }
    setBusy(null);
    if (error) toast.error(error.message); else { toast.success(Number(f.occurrences) > 1 ? "Série de jogos criada" : "Jogo criado"); setForm(null); await qc.invalidateQueries({ queryKey: ["events", group.id] }); }
  }
  async function duplicate(e: any) {
    const start = new Date(e.starts_at); start.setDate(start.getDate() + 7);
    const { error } = await db.from("events").insert({ ...Object.fromEntries(Object.entries(e).filter(([k]) => !["id", "created_at", "updated_at", "series_id"].includes(k))), series_id: null, starts_at: start.toISOString(), created_by: auth.data });
    if (error) toast.error(error.message); else { toast.success("Jogo duplicado para a semana seguinte"); qc.invalidateQueries({ queryKey: ["events", group?.id] }); }
  }
  async function cancelEvent(e: any) {
    if (!confirm("Cancelar este jogo?")) return;
    const { error } = await db.from("events").update({ status: "cancelled" }).eq("id", e.id).eq("group_id", group!.id);
    if (error) toast.error(error.message); else { toast.success("Jogo cancelado"); qc.invalidateQueries({ queryKey: ["events", group?.id] }); }
  }
  async function rsvp(e: any, action: "rsvp_confirm" | "rsvp_cancel") {
    if (!myPlayer.data?.id) { toast.error("Sua conta ainda não está vinculada a um jogador desta quadra. Peça ao administrador para aprovar sua entrada."); return; }
    setBusy(e.id);
    const { data, error } = await db.rpc(action, { _event_id: e.id, _player_id: myPlayer.data.id });
    setBusy(null);
    if (error) toast.error(error.message);
    else {
      toast.success(action === "rsvp_cancel" ? "Presença cancelada" : data === "waitlist" ? "Você entrou na lista de espera" : "Presença confirmada");
      await Promise.all([qc.invalidateQueries({ queryKey: ["event-rosters"] }), qc.invalidateQueries({ queryKey: ["attendance", e.id] }), qc.invalidateQueries({ queryKey: ["events", group?.id] })]);
    }
  }

  if (!group) return <div className="space-y-3"><h1 className="text-3xl font-bold">Eventos</h1><p className="text-muted-foreground">Crie sua quadra gratuitamente ou aceite um convite para ver a agenda.</p><Button asChild><Link to="/dashboard">Ir para início</Link></Button></div>;
  if (!court.venue) return <div className="space-y-3"><h1 className="text-3xl font-bold">Eventos</h1><p className="text-muted-foreground">Selecione uma quadra para abrir sua agenda.</p><Button asChild><Link to="/quadras">Ir para quadras</Link></Button></div>;

  return <div className="mx-auto max-w-7xl space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-3xl font-bold">Eventos</h1><p className="text-sm text-muted-foreground">Agenda de {court.venue.name}. Veja participantes e vagas ou confirme sua presença.</p></div>{canManage && <Button onClick={() => setForm({ ...empty, date: new Date().toISOString().slice(0, 10), location: court.venue.address ?? "" })}><Plus className="mr-2 h-4 w-4" />Novo evento</Button>}</header>
    <div className="flex flex-wrap items-center gap-2"><div className="flex rounded-lg border p-1">{[["month", "Mês"], ["week", "Semana"], ["list", "Lista"]].map(([v, l]) => <Button key={v} size="sm" variant={view === v ? "default" : "ghost"} onClick={() => setView(v ?? "list")}>{l}</Button>)}</div>{view !== "list" && <><Button variant="outline" onClick={() => { const d = new Date(period); d.setDate(d.getDate() - (view === "month" ? 30 : 7)); setPeriod(d); }}>‹</Button><strong>{period.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}</strong><Button variant="outline" onClick={() => { const d = new Date(period); d.setDate(d.getDate() + (view === "month" ? 30 : 7)); setPeriod(d); }}>›</Button></>}</div>
    {view === "list" ? <div className="grid gap-5">{shown.map((e: any) => <EventCard key={e.id} event={e} rows={attendanceByEvent.get(e.id) ?? []} rosterLoading={rosters.isLoading} rosterError={rosters.isError} playerId={myPlayer.data?.id} canManage={canManage} busy={busy === e.id} onRsvp={(action: "rsvp_confirm" | "rsvp_cancel") => rsvp(e, action)} duplicate={() => duplicate(e)} cancel={() => cancelEvent(e)} />)}{!shown.length && <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">Nenhum evento nesta agenda.</div>}</div> : <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border bg-border">{["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map(d => <div key={d} className="bg-muted p-2 text-center text-xs font-semibold">{d}</div>)}{calendarDays.map(day => { const dayEvents = shown.filter((e: any) => new Date(e.starts_at).toDateString() === day.toDateString()); return <div key={day.toISOString()} className={`min-h-28 bg-card p-1 sm:min-h-36 ${day.getMonth() !== period.getMonth() && view === "month" ? "opacity-50" : ""}`}><div className="mb-1 text-xs font-medium">{day.getDate()}</div>{dayEvents.map((e: any) => { const rows = attendanceByEvent.get(e.id) ?? []; const reserved = rows.filter((r: any) => ["confirmed", "offered"].includes(r.status)).length; const free = Math.max(0, Number(e.max_participants) - reserved); return <Link key={e.id} to="/events/$eventId" params={{ eventId: e.id }} className="mb-1 block rounded bg-primary/10 px-1.5 py-1 text-[10px] text-primary sm:text-xs"><span className="block truncate">{new Date(e.starts_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} {e.title}</span><span>{rosters.isLoading ? "Carregando vagas…" : `${reserved} confirmados · ${free} vagas`}</span></Link>; })}</div>; })}</div>}
    {form && <div className="fixed inset-0 z-50 overflow-auto bg-black/50 p-4"><form onSubmit={save} className="mx-auto my-6 grid max-w-3xl gap-3 rounded-xl bg-background p-5 sm:grid-cols-2"><h2 className="sm:col-span-2 text-xl font-bold">Agendar em {court.venue.name}</h2><Field label="Título" value={form.title} onChange={(v: string) => setForm({ ...form, title: v })} /><Field label="Data" type="date" value={form.date} onChange={(v: string) => setForm({ ...form, date: v })} /><Field label="Horário" type="time" value={form.start_time} onChange={(v: string) => setForm({ ...form, start_time: v })} /><Field label="Local" value={form.location} onChange={(v: string) => setForm({ ...form, location: v })} /><Field label="Duração (minutos)" type="number" value={form.duration_minutes} onChange={(v: string) => setForm({ ...form, duration_minutes: v })} /><Field label="Limite de participantes" type="number" value={form.max_participants} onChange={(v: string) => setForm({ ...form, max_participants: v })} /><Field label="Número de times" type="number" value={form.teams_count} onChange={(v: string) => setForm({ ...form, teams_count: v })} /><Field label="Jogadores por time" type="number" value={form.players_per_team} onChange={(v: string) => setForm({ ...form, players_per_team: v })} /><Field label="Goleiros desejados" type="number" value={form.goalkeepers_wanted} onChange={(v: string) => setForm({ ...form, goalkeepers_wanted: v })} /><Field label="Valor previsto (R$)" type="number" value={form.price} onChange={(v: string) => setForm({ ...form, price: v })} /><Field label="Prazo de confirmação antes (horas)" type="number" value={form.deadline_hours} onChange={(v: string) => setForm({ ...form, deadline_hours: v })} /><Field label="Prazo da oferta da fila (minutos; 0 confirma automaticamente)" type="number" value={form.waitlist_offer_minutes} onChange={(v: string) => setForm({ ...form, waitlist_offer_minutes: v })} /><Field label="Recorrências semanais (1 a 52)" type="number" value={form.occurrences} onChange={(v: string) => setForm({ ...form, occurrences: v })} /><div className="sm:col-span-2"><Label>Regras de cancelamento</Label><textarea className="mt-1 w-full rounded-md border bg-background p-2" value={form.cancellation_rules} onChange={e => setForm({ ...form, cancellation_rules: e.target.value })} /></div><div className="sm:col-span-2"><Label>Observações</Label><textarea className="mt-1 w-full rounded-md border bg-background p-2" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div><div className="sm:col-span-2 flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setForm(null)}>Fechar</Button><Button disabled={busy === "save"}>{busy === "save" ? "Criando…" : "Salvar evento(s)"}</Button></div></form></div>}
  </div>;
}

function Field({ label, value, onChange, type = "text" }: any) { return <div><Label>{label}</Label><Input className="mt-1" type={type} value={value} onChange={e => onChange(e.target.value)} required={label === "Data" || label === "Horário"} /></div>; }
function EventCard({ event: e, rows, rosterLoading, rosterError, playerId, canManage, busy, onRsvp, duplicate, cancel }: any) {
  const confirmed = rows.filter((r: any) => r.status === "confirmed");
  const reserved = rows.filter((r: any) => ["confirmed", "offered"].includes(r.status));
  const waiting = rows.filter((r: any) => r.status === "waitlist").sort((a: any, b: any) => new Date(a.waitlisted_at ?? a.created_at).getTime() - new Date(b.waitlisted_at ?? b.created_at).getTime());
  const free = Math.max(0, Number(e.max_participants) - reserved.length);
  const own = playerId ? rows.find((r: any) => r.player_id === playerId && ["confirmed", "offered", "waitlist"].includes(r.status)) : null;
  const ownWaitPosition = own?.status === "waitlist" ? waiting.findIndex((r: any) => r.id === own.id) + 1 : null;
  const expired = e.confirm_deadline && new Date(e.confirm_deadline) < new Date();
  const names = (r: any) => r.players?.nickname ? `${r.players.name} “${r.players.nickname}”` : r.players?.name ?? "Jogador";
  return <article className="overflow-hidden rounded-2xl border bg-card shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-4 border-b bg-muted/20 p-5 sm:p-6"><div className="space-y-2"><div className="flex flex-wrap items-center gap-2"><h2 className="text-2xl font-bold">{e.title}</h2><Badge variant={e.status === "scheduled" ? "secondary" : "outline"}>{e.status === "scheduled" ? "Agendado" : e.status}</Badge></div><p className="text-base text-muted-foreground">{new Date(e.starts_at).toLocaleString("pt-BR", { dateStyle: "full", timeStyle: "short" })}</p></div><div className="min-w-44 rounded-xl border bg-background p-3 text-center"><div className="text-xs uppercase tracking-wide text-muted-foreground">Vagas disponíveis</div><div className="text-3xl font-bold">{rosterLoading ? "…" : rosterError ? "—" : free}<span className="text-base font-normal text-muted-foreground"> / {e.max_participants}</span></div><div className="text-sm text-muted-foreground">{rosterLoading ? "Atualizando lista" : rosterError ? "Lista indisponível" : `${reserved.length} ocupadas`}</div></div></div>
    <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[1.2fr_1fr]"><div className="space-y-4"><div className="grid gap-3 text-sm sm:grid-cols-2"><Detail icon={<MapPin />} label="Local" value={e.location || "Local a definir"} /><Detail icon={<Clock3 />} label="Duração" value={`${e.duration_minutes} minutos`} /><Detail icon={<Users />} label="Times" value={`${e.teams_count} times · ${e.players_per_team} por time`} /><Detail icon={<CalendarDays />} label="Participação" value={e.price != null ? `R$ ${Number(e.price).toFixed(2)}` : "Valor não definido"} /></div>{e.confirm_deadline && <p className="text-sm text-muted-foreground">Confirmação até {new Date(e.confirm_deadline).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</p>}{e.goalkeepers_wanted != null && <p className="text-sm text-muted-foreground">Goleiros desejados: {e.goalkeepers_wanted}</p>}{e.cancellation_rules && <div><h3 className="text-sm font-semibold">Regras de cancelamento</h3><p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{e.cancellation_rules}</p></div>}{e.notes && <div><h3 className="text-sm font-semibold">Observações</h3><p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{e.notes}</p></div>}</div>
      <div className="space-y-4"><section className="rounded-xl border p-4"><div className="mb-3 flex items-center justify-between gap-2"><h3 className="font-semibold">Confirmados ({confirmed.length})</h3><span className="text-xs text-muted-foreground">Lista completa</span></div>{confirmed.length ? <ul className="max-h-52 space-y-2 overflow-y-auto">{confirmed.map((r: any) => <li key={r.id} className="flex items-center justify-between gap-2 text-sm"><span>{names(r)}</span><span className="text-xs text-muted-foreground">{r.players?.position ?? "Posição não informada"}</span></li>)}</ul> : <p className="text-sm text-muted-foreground">Ainda ninguém confirmou. Seja o primeiro!</p>}{reserved.filter((r: any) => r.status === "offered").map((r: any) => <p key={r.id} className="mt-2 text-xs text-amber-600">Vaga oferecida: {names(r)}</p>)}</section>
      {waiting.length > 0 && <section className="rounded-xl border p-4"><h3 className="mb-2 font-semibold">Lista de espera ({waiting.length})</h3><ol className="space-y-1 text-sm">{waiting.map((r: any, i: number) => <li key={r.id}>{i + 1}. {names(r)}</li>)}</ol></section>}
      {rosterError && <p className="text-sm text-destructive">Não foi possível carregar as presenças. Atualize a página para tentar novamente.</p>}<div className="flex flex-wrap items-center gap-2">{own ? <><Badge variant="secondary">{own.status === "confirmed" ? "Presença confirmada" : own.status === "offered" ? "Vaga oferecida" : `Lista de espera · posição ${ownWaitPosition}`}</Badge><Button size="sm" variant="outline" disabled={busy || rosterLoading} onClick={() => onRsvp("rsvp_cancel")}><X className="mr-1 h-4 w-4" />Cancelar presença</Button></> : <Button disabled={busy || rosterLoading || rosterError || e.status !== "scheduled" || !!expired || !playerId} onClick={() => onRsvp("rsvp_confirm")}><Check className="mr-2 h-4 w-4" />{!playerId ? "Vincule seu jogador para confirmar" : expired ? "Confirmação encerrada" : free > 0 ? "Confirmar presença" : "Entrar na lista de espera"}</Button>}{!playerId && <span className="basis-full text-xs text-muted-foreground">A entrada na quadra precisa ser aprovada e vinculada a um jogador para confirmar presença.</span>}</div>
      <div className="flex flex-wrap gap-2"><Button asChild variant="outline"><Link to="/events/$eventId" params={{ eventId: e.id }}>Ver lista completa e detalhes</Link></Button>{canManage && e.status === "scheduled" && <><Button size="icon" variant="outline" aria-label="Duplicar evento" onClick={duplicate}><Copy className="h-4 w-4" /></Button><Button size="sm" variant="outline" onClick={cancel}>Cancelar evento</Button></>}</div></div></div>
  </article>;
}
function Detail({ icon, label, value }: any) { return <div className="flex gap-2 rounded-lg bg-muted/30 p-3"><span className="mt-0.5 text-muted-foreground [&>svg]:h-4 [&>svg]:w-4">{icon}</span><div><div className="text-xs text-muted-foreground">{label}</div><div className="font-medium">{value}</div></div></div>; }
function getCalendarDays(view: string, period: Date) { const first = new Date(period.getFullYear(), period.getMonth(), 1, 12); const start = view === "month" ? new Date(first.getFullYear(), first.getMonth(), 1 - ((first.getDay() + 6) % 7), 12) : new Date(period.getFullYear(), period.getMonth(), period.getDate() - ((period.getDay() + 6) % 7), 12); const count = view === "month" ? 42 : 7; return Array.from({ length: count }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i, 12)); }
