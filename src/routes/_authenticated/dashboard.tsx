import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Bell,
  BarChart3,
  CalendarDays,
  FileText,
  Settings,
  Shield,
  Swords,
  Users,
  Wallet,
  Shirt,
  UserPlus,
  MapPin,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  myGroupsQuery,
  getActiveGroupId,
  setActiveGroupId,
  ROLE_LABEL,
  useActiveCourt,
  type MyGroup,
} from "@/lib/groups";
import { ErrorState, LoadingState, StatCard } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AdminNotificationComposer, NotificationsPanel } from "@/components/NotificationsCenter";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Painel | Rei da Quadra" },
      { name: "description", content: "Painel do seu grupo de futebol no Rei da Quadra." },
      { property: "og:title", content: "Painel | Rei da Quadra" },
      { property: "og:description", content: "Painel do seu grupo de futebol no Rei da Quadra." },
    ],
  }),
  component: Dashboard,
});

const MODULES = [
  { label: "Eventos", icon: CalendarDays, to: "/events" },
  { label: "Jogadores", icon: Users, to: "/jogadores" },
  { label: "Quadras", icon: MapPin, to: "/quadras" },
  { label: "Times", icon: Shirt, to: "/times" },
  { label: "Campeonatos", icon: Swords, to: "/campeonatos" },
  { label: "Financeiro", icon: Wallet, to: "/financeiro" },
  { label: "Estatísticas", icon: BarChart3 },
  { label: "Relatórios", icon: FileText },
  { label: "Configurações", icon: Settings },
] as const;

function Dashboard() {
  const [, refresh] = useState(0);
  useEffect(() => {
    const update = () => refresh((value) => value + 1);
    window.addEventListener("rdq-group-change", update);
    return () => window.removeEventListener("rdq-group-change", update);
  }, []);
  const groups = useQuery({ ...myGroupsQuery, refetchInterval: 15_000 });
  if (groups.isLoading) return <LoadingState />;
  if (groups.error)
    return <ErrorState message={(groups.error as Error).message} onRetry={() => groups.refetch()} />;
  const list = groups.data ?? [];
  if (list.length === 0) return <NoGroup />;
  const active = list.find((g) => g.id === getActiveGroupId()) ?? list[0]!;
  return <GroupDashboard group={active} />;
}

function NoGroup() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [weekday, setWeekday] = useState("0");
  const [time, setTime] = useState("09:00");
  const [busy, setBusy] = useState(false);
  const requests = useQuery({
    queryKey: ["my-join-requests"],
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return [];
      const { data, error } = await (supabase as any).from("group_join_requests")
        .select("id,court_name,status,created_at").eq("user_id", auth.user.id).order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.rpc("create_court", { _name: name, _address: address, _weekday: Number(weekday), _time: time });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setActiveGroupId(data as string);
    toast.success("Quadra criada! Você é o administrador responsável.");
    await qc.invalidateQueries({ queryKey: ["my-groups"] });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="rounded-xl border border-border bg-card p-6">
        <h1 className="text-2xl font-bold">Crie sua quadra</h1>
        <p className="mt-1 text-sm text-muted-foreground">A criação é gratuita durante o desenvolvimento. Você será o administrador e poderá aprovar os jogadores que entrarem.</p>
        <form onSubmit={create} className="mt-4 grid gap-3 sm:grid-cols-2">
          <div><Label htmlFor="gname">Nome da quadra ou grupo</Label><Input id="gname" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} /></div>
          <div><Label htmlFor="court-address">Endereço da quadra</Label><Input id="court-address" value={address} onChange={(e) => setAddress(e.target.value)} required /></div>
          <div><Label htmlFor="court-day">Dia habitual de uso</Label><select id="court-day" className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={weekday} onChange={(e) => setWeekday(e.target.value)}>{["Domingo","Segunda-feira","Terça-feira","Quarta-feira","Quinta-feira","Sexta-feira","Sábado"].map((d,i)=><option key={d} value={i}>{d}</option>)}</select></div>
          <div><Label htmlFor="court-time">Horário habitual</Label><Input id="court-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} required /></div>
          <Button type="submit" disabled={busy} className="sm:col-span-2">{busy ? "Criando..." : "Criar quadra gratuitamente"}</Button>
        </form>
      </div>
      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="text-xl font-semibold">Aguardando aprovação</h2>
        <p className="mt-1 text-sm text-muted-foreground">Depois de usar um convite e completar seu perfil, o administrador da quadra precisa aprovar sua entrada.</p>
        <div className="mt-3 space-y-2">{(requests.data ?? []).map((r:any)=><div key={r.id} className="flex items-center justify-between rounded-lg border p-3"><span>{r.court_name}</span><Badge variant={r.status==="approved"?"default":"secondary"}>{r.status==="pending"?"Aguardando aprovação":r.status==="approved"?"Aprovado":"Recusado"}</Badge></div>)}{requests.data?.length===0&&<p className="text-sm text-muted-foreground">Nenhuma solicitação enviada.</p>}</div>
      </section>
    </div>
  );
}

function GroupDashboard({ group }: { group: MyGroup }) {
  const qc = useQueryClient();
  const court = useActiveCourt(group.id);
  const players = useQuery({
    queryKey: ["players-count", group.id, court.venue?.id],
    enabled: !!court.venue,
    queryFn: async () => {
      const { count, error } = await (supabase as any)
        .from("players")
        .select("id", { count: "exact", head: true })
        .eq("group_id", group.id).eq("venue_id", court.venue!.id);
      if (error) throw error;
      return count ?? 0;
    },
  });
  const members = useQuery({
    queryKey: ["members-count", group.id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("group_members")
        .select("id", { count: "exact", head: true })
        .eq("group_id", group.id);
      if (error) throw error;
      return count ?? 0;
    },
  });
  const canInvite = group.role === "admin" || group.permissions.includes("members");
  const requests = useQuery({
    queryKey: ["join-requests", group.id, court.venue?.id],
    enabled: group.role === "admin" && !!court.venue,
    refetchInterval: 20000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("group_join_requests").select("id,name,email,position,secondary_positions,dominant_foot,created_at")
        .eq("group_id", group.id).eq("venue_id", court.venue!.id).eq("status", "pending").order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });
  async function reviewRequest(id: string, approve: boolean) {
    const { error } = await (supabase as any).rpc("review_join_request", { _request_id: id, _approve: approve });
    if (error) { toast.error(error.message); return; }
    toast.success(approve ? "Jogador aprovado e vinculado à quadra" : "Solicitação recusada");
    await Promise.all([qc.invalidateQueries({ queryKey: ["my-groups"] }), qc.invalidateQueries({ queryKey: ["players-count", group.id] }), requests.refetch()]);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold uppercase">{court.venue?.name ?? group.name}</h1>
          <Badge variant="secondary" className="mt-1">
            <Shield className="mr-1 h-3 w-3" /> {ROLE_LABEL[group.role]}
          </Badge>
        </div>
          <div className="flex gap-2">
          {canInvite && <Button asChild variant="outline"><Link to="/jogadores"><UserPlus className="mr-2 h-4 w-4" />Convidar jogador</Link></Button>}
        </div>
      </div>

      <details className="group rounded-xl border border-border bg-card p-4 sm:p-5">
        <summary className="flex cursor-pointer list-none items-center gap-2 font-display text-lg font-bold [&::-webkit-details-marker]:hidden">
          <Bell className="h-5 w-5 text-primary" /> Notificações
          <span className="ml-auto text-sm font-normal text-muted-foreground transition-transform group-open:rotate-180">⌄</span>
        </summary>
        <div className="mt-4 space-y-3">
          <NotificationsPanel compact />
          {group.role === "admin" && <AdminNotificationComposer group={group} />}
        </div>
      </details>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Jogadores" icon={<Users className="h-4 w-4" />} value={players.data ?? "—"} />
        <StatCard label="Membros" icon={<Shield className="h-4 w-4" />} value={members.data ?? "—"} />
      </div>

      {group.role === "admin" && (requests.data?.length ?? 0) > 0 && (
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-xl font-semibold">Pedidos para entrar na quadra</h2>
          <div className="mt-3 divide-y">{requests.data!.map((request: any) => (
            <div key={request.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div><div className="font-medium">{request.name}</div><div className="text-sm text-muted-foreground">{request.email} · {request.position} · pé {request.dominant_foot} · {request.secondary_positions?.join(", ")||"sem posições secundárias"}</div><div className="text-xs text-muted-foreground">Solicitou em {new Date(request.created_at).toLocaleString("pt-BR")}</div></div>
              <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => reviewRequest(request.id, false)}>Recusar</Button><Button size="sm" onClick={() => reviewRequest(request.id, true)}>Aprovar entrada</Button></div>
            </div>
          ))}</div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-xl font-semibold uppercase">Módulos</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m) => "to" in m ? (
            <Link key={m.label} to={m.to} className="flex min-h-24 items-center justify-between gap-2 rounded-xl border border-border bg-card p-3 transition-colors hover:border-primary/50 hover:bg-muted/40 sm:p-4">
              <div className="flex min-w-0 items-center gap-2 font-display text-base font-semibold sm:text-lg">
                <m.icon className="h-5 w-5 shrink-0 text-primary" /> <span className="truncate">{m.label}</span>
              </div>
              <span aria-hidden="true" className="text-lg text-muted-foreground">›</span>
            </Link>
          ) : (
            <div key={m.label} className="flex min-h-24 items-center justify-between gap-2 rounded-xl border border-border bg-card p-3 sm:p-4">
              <div className="flex min-w-0 items-center gap-2 font-display text-base font-semibold sm:text-lg">
                <m.icon className="h-5 w-5 shrink-0 text-primary" /> <span className="truncate">{m.label}</span>
              </div>
              <Badge className="shrink-0" variant="secondary">Em breve</Badge>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
