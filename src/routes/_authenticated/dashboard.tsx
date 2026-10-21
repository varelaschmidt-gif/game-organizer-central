import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
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
  canCreateGroupQuery,
  myGroupsQuery,
  getActiveGroupId,
  setActiveGroupId,
  ROLE_LABEL,
  type MyGroup,
} from "@/lib/groups";
import { EmptyState, ErrorState, LoadingState, StatCard } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

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
  { label: "Eventos", icon: CalendarDays, text: "Crie jogos, séries recorrentes e gerencie confirmações.", to: "/events" },
  { label: "Jogadores", icon: Users, text: "Cadastre jogadores, envie convites e organize sua lista.", to: "/jogadores" },
  { label: "Quadras", icon: MapPin, text: "Cadastre os locais utilizados nos jogos.", to: "/quadras" },
  { label: "Times", icon: Shirt, text: "Nenhum time montado ainda." },
  { label: "Partidas", icon: Swords, text: "Nenhuma partida registrada." },
  { label: "Financeiro", icon: Wallet, text: "Nenhuma movimentação registrada." },
  { label: "Estatísticas", icon: BarChart3, text: "Sem dados para estatísticas." },
  { label: "Relatórios", icon: FileText, text: "Nenhum relatório disponível." },
  { label: "Configurações", icon: Settings, text: "Defina dia, horário e local do grupo." },
] as const;

function Dashboard() {
  const groups = useQuery(myGroupsQuery);
  if (groups.isLoading) return <LoadingState />;
  if (groups.error)
    return <ErrorState message={(groups.error as Error).message} onRetry={() => groups.refetch()} />;
  const list = groups.data ?? [];
  if (list.length === 0) return <NoGroup />;
  const active = list.find((g) => g.id === getActiveGroupId()) ?? list[0]!;
  return <GroupDashboard group={active} all={list} />;
}

function NoGroup() {
  const can = useQuery(canCreateGroupQuery);
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.rpc("create_group", { _name: name, _as_player: true });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setActiveGroupId(data as string);
    toast.success("Grupo criado!");
    qc.invalidateQueries({ queryKey: ["my-groups"] });
  }

  if (can.isLoading) return <LoadingState />;
  if (!can.data)
    return (
      <EmptyState
        icon={<UserPlus className="h-8 w-8" />}
        title="Você ainda não participa de um grupo"
        description="Peça um convite ao administrador de um grupo para participar. Para criar um grupo novo, um administrador da plataforma precisa autorizar sua conta."
      />
    );
  return (
    <div className="mx-auto max-w-md rounded-xl border border-border bg-card p-6">
      <h1 className="text-2xl font-bold">Crie seu grupo</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Você foi autorizado a criar um grupo e será o administrador dele.
      </p>
      <form onSubmit={create} className="mt-4 space-y-3">
        <div>
          <Label htmlFor="gname">Nome do grupo</Label>
          <Input id="gname" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
        </div>
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Criando..." : "Criar grupo"}
        </Button>
      </form>
    </div>
  );
}

function GroupDashboard({ group, all }: { group: MyGroup; all: MyGroup[] }) {
  const players = useQuery({
    queryKey: ["players-count", group.id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("players")
        .select("id", { count: "exact", head: true })
        .eq("group_id", group.id);
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold uppercase">{group.name}</h1>
          <Badge variant="secondary" className="mt-1">
            <Shield className="mr-1 h-3 w-3" /> {ROLE_LABEL[group.role]}
          </Badge>
        </div>
        <div className="flex gap-2">
          {all.length > 1 && (
            <select
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={group.id}
              onChange={(e) => {
                setActiveGroupId(e.target.value);
                window.location.reload();
              }}
            >
              {all.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          )}
          {canInvite && <InviteDialog groupId={group.id} />}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Jogadores" icon={<Users className="h-4 w-4" />} value={players.data ?? "—"} />
        <StatCard label="Membros" icon={<Shield className="h-4 w-4" />} value={members.data ?? "—"} />
      </div>

      <section>
        <h2 className="mb-3 text-xl font-semibold uppercase">Módulos</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m) => (
            <div key={m.label} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 font-display text-lg font-semibold">
                <m.icon className="h-5 w-5 text-primary" /> {m.label}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{m.text}</p>
              {"to" in m ? (
                <Button asChild size="sm" variant="outline" className="mt-3">
                  <Link to={m.to}>Abrir</Link>
                </Button>
              ) : (
                <Button size="sm" variant="outline" className="mt-3" disabled>Configurar (em breve)</Button>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function InviteDialog({ groupId }: { groupId: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.rpc("create_invite", {
      _group_id: groupId,
      _email: email,
      _role: "player",
      _player_id: undefined,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setLink(`${window.location.origin}/convite/${data}`);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setLink(null);
          setEmail("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <UserPlus className="mr-2 h-4 w-4" /> Convidar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convidar para o grupo</DialogTitle>
        </DialogHeader>
        {link ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Envie este link para {email}. Ele vale por 7 dias e só funciona com esse e-mail.
            </p>
            <Input readOnly value={link} onFocus={(e) => e.target.select()} />
            <Button
              className="w-full"
              onClick={() => {
                navigator.clipboard.writeText(link);
                toast.success("Link copiado");
              }}
            >
              Copiar link
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div>
              <Label htmlFor="iemail">E-mail</Label>
              <Input id="iemail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Gerando..." : "Gerar convite"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

