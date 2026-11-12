import { useMemo, useState } from "react";
import type React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, Megaphone } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { myGroupsQuery, setActiveCourtId, setActiveGroupId, type MyGroup, useActiveCourt } from "@/lib/groups";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const db = supabase as any;
type Notice = { id: string; group_id: string; kind: "message" | "charge" | "request"; title: string; body: string; event_id: string | null; metadata: any; created_at: string; read_at: string | null };

function useNotifications() {
  return useQuery<Notice[]>({
    queryKey: ["group-notifications"],
    queryFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) return [];
      const { data, error } = await db.from("group_notifications")
        .select("id,group_id,kind,title,body,event_id,metadata,created_at,read_at")
        .order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 30_000,
  });
}

async function markRead(id: string, qc: ReturnType<typeof useQueryClient>) {
  const { error } = await db.rpc("group_notification_mark_read", { _notification_id: id });
  if (error) { toast.error(error.message); return; }
  await qc.invalidateQueries({ queryKey: ["group-notifications"] });
}

function NoticeItem({ notice, groupName }: { notice: Notice; groupName: string }) {
  const qc = useQueryClient();
  const charge = notice.kind === "charge";
  const due = notice.metadata?.due_date ? new Date(`${notice.metadata.due_date}T12:00:00`).toLocaleDateString("pt-BR") : null;
  const amount = notice.metadata?.amount_cents != null ? (Number(notice.metadata.amount_cents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : null;
  return <article className={`rounded-lg border p-3 ${notice.read_at ? "bg-card" : "border-primary/40 bg-primary/5"}`}>
    <button className="w-full text-left" onClick={() => { if (!notice.read_at) void markRead(notice.id, qc); }}>
      <div className="flex items-start justify-between gap-2"><span className="font-semibold">{notice.title}</span>{!notice.read_at && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Não lida" />}</div>
      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{notice.body}</p>
    </button>
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"><span>{groupName}</span><span>·</span><time>{new Date(notice.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</time></div>
    {charge && <div className="mt-2 rounded-md bg-muted/60 p-2 text-sm"><span className="font-medium">{notice.metadata?.description || "Cobrança"}</span>{amount && <span> · {amount}</span>}{due && <span className="text-muted-foreground"> · vence {due}</span>}<Link className="ml-1 font-semibold text-primary underline" onClick={() => { setActiveGroupId(notice.group_id); if (notice.metadata?.venue_id) setActiveCourtId(notice.metadata.venue_id); }} to="/financeiro">Ver Financeiro</Link></div>}
    {notice.event_id && <Link className="mt-2 inline-block text-sm font-medium text-primary underline" to="/events/$eventId" params={{ eventId: notice.event_id }}>Abrir evento</Link>}
    {notice.kind === "request" && <Link className="mt-2 inline-block text-sm font-medium text-primary underline" onClick={() => setActiveGroupId(notice.group_id)} to="/dashboard">Ver solicitações</Link>}
  </article>;
}

export function NotificationsPanel({ compact = false }: { compact?: boolean }) {
  const { data: notices, isLoading, isError } = useNotifications();
  const groups = useQuery(myGroupsQuery);
  const byId = useMemo(() => new Map((groups.data ?? []).map((group) => [group.id, group.name])), [groups.data]);
  const unread = (notices ?? []).filter((notice) => !notice.read_at).length;
  return <section className={compact ? "space-y-2" : "rounded-xl border bg-card p-4 sm:p-5"}>
    {!compact && <div className="mb-3 flex items-center justify-between"><h2 className="flex items-center gap-2 font-display text-lg font-bold"><Bell className="h-5 w-5 text-primary" />Notificações</h2>{unread > 0 && <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">{unread} novas</span>}</div>}
    {isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p> : isError ? <p className="text-sm text-muted-foreground">As notificações aparecerão após a ativação da estrutura no banco.</p> : (notices ?? []).length ? <div className="space-y-2">{(notices ?? []).slice(0, 5).map((notice) => <NoticeItem key={notice.id} notice={notice} groupName={byId.get(notice.group_id) ?? "Quadra"} />)}</div> : <p className="text-sm text-muted-foreground">Você não tem notificações novas.</p>}
  </section>;
}

export function NotificationsBell() {
  const { data: notices, isError } = useNotifications();
  const groups = useQuery(myGroupsQuery);
  const byId = useMemo(() => new Map((groups.data ?? []).map((group) => [group.id, group.name])), [groups.data]);
  const unread = (notices ?? []).filter((notice) => !notice.read_at).length;
  return <Popover>
    <PopoverTrigger asChild><Button variant="ghost" size="icon" className="relative rounded-full" aria-label={`Notificações${unread ? `, ${unread} não lidas` : ""}`}><Bell className="h-5 w-5" />{unread > 0 && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-background" />}</Button></PopoverTrigger>
    <PopoverContent align="end" className="max-h-[75vh] w-[min(22rem,calc(100vw-1rem))] overflow-y-auto p-3"><div className="mb-3 flex items-center justify-between"><strong>Notificações</strong>{unread > 0 && <span className="text-xs text-muted-foreground">{unread} não lidas</span>}</div>{isError ? <p className="text-sm text-muted-foreground">Indisponível até a migration de notificações ser aplicada.</p> : (notices ?? []).length ? <div className="space-y-2">{(notices ?? []).slice(0, 12).map((notice) => <NoticeItem key={notice.id} notice={notice} groupName={byId.get(notice.group_id) ?? "Quadra"} />)}</div> : <p className="text-sm text-muted-foreground">Nenhuma notificação.</p>}</PopoverContent>
  </Popover>;
}

export function AdminNotificationComposer({ group }: { group: MyGroup }) {
  const court = useActiveCourt(group.id);
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [eventId, setEventId] = useState("");
  const events = useQuery({
    queryKey: ["notification-events", group.id, court.venue?.id],
    enabled: !!court.venue,
    queryFn: async () => {
      const { data, error } = await db.from("events").select("id,title,starts_at")
        .eq("group_id", group.id).eq("venue_id", court.venue!.id).gte("starts_at", new Date().toISOString()).order("starts_at").limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });
  if (group.role !== "admin") return null;
  async function publish(event: React.FormEvent) {
    event.preventDefault();
    if (title.trim().length < 2 || !body.trim()) return;
    const { error } = await db.rpc("admin_publish_group_notification", { _group_id: group.id, _title: title.trim(), _body: body.trim(), _event_id: eventId || null });
    if (error) { toast.error(error.message); return; }
    toast.success("Notificação enviada aos membros da quadra.");
    setTitle(""); setBody(""); setEventId("");
    await qc.invalidateQueries({ queryKey: ["group-notifications"] });
  }
  return <section className="rounded-xl border bg-card p-4 sm:p-5"><h2 className="flex items-center gap-2 font-display text-lg font-bold"><Megaphone className="h-5 w-5 text-primary" />Avisar jogadores</h2><p className="mt-1 text-xs text-muted-foreground">Cobranças geradas também criam avisos privados com o valor individual de cada jogador.</p>
    <form onSubmit={publish} className="mt-3 grid gap-3 sm:grid-cols-2"><div><Label htmlFor="notice-title">Título</Label><Input id="notice-title" className="mt-1" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} required placeholder="Ex.: Mudança de horário" /></div><div><Label htmlFor="notice-event">Evento relacionado</Label><select id="notice-event" className="mt-1 min-h-10 w-full rounded-md border bg-background px-3 text-sm" value={eventId} onChange={(e) => setEventId(e.target.value)}><option value="">Nenhum evento</option>{(events.data ?? []).map((event: any) => <option key={event.id} value={event.id}>{event.title} · {new Date(event.starts_at).toLocaleDateString("pt-BR")}</option>)}</select></div><div className="sm:col-span-2"><Label htmlFor="notice-body">Mensagem</Label><textarea id="notice-body" className="mt-1 min-h-24 w-full rounded-md border bg-background p-3 text-sm" value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} required placeholder="Escreva o aviso para os jogadores desta quadra" /></div><div className="sm:col-span-2 flex justify-end"><Button disabled={!title.trim() || !body.trim()}><CheckCheck className="mr-2 h-4 w-4" />Enviar aviso</Button></div></form>
  </section>;
}
