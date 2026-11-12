import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  Crown,
  LayoutDashboard,
  LogOut,
  MapPin,
  Settings,
  Users,
  Wallet,
  BarChart3,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { myGroupsQuery, profileQuery, getActiveGroupId, setActiveGroupId, setActiveCourtId, useActiveCourt } from "@/lib/groups";
import { resolveProfileAvatar } from "@/lib/profile-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { NotificationsBell } from "@/components/NotificationsCenter";

const NAV = [
  { to: "/dashboard", label: "Início", icon: LayoutDashboard },
  { to: "/events", label: "Eventos", icon: CalendarDays },
  { to: "/jogadores", label: "Jogadores", icon: Users },
  { to: "/quadras", label: "Quadras", icon: MapPin },
  { to: "/financeiro", label: "Financeiro", icon: Wallet },
  { to: "/dashboard", label: "Estatísticas", icon: BarChart3, soon: true },
  { to: "/dashboard", label: "Configurações", icon: Settings, soon: true },
] as const;

export function AppShell() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: groups } = useQuery(myGroupsQuery);
  const { data: profile } = useQuery(profileQuery);
  const groupIds = (groups ?? []).map((group) => group.id);
  const allVenues = useQuery({
    queryKey: ["all-member-venues", groupIds],
    enabled: groupIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("venues")
        .select("id,group_id,name,is_active").in("group_id", groupIds).eq("is_active", true).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const active = groups?.find((g) => g.id === getActiveGroupId()) ?? groups?.[0];
  const court = useActiveCourt(active?.id);
  const selectorValue = active && court.venue ? `${active.id}:${court.venue.id}` : "";
  const name = profile?.full_name || profile?.email || "";
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void resolveProfileAvatar(profile?.avatar_url).then((url) => { if (active) setAvatarUrl(url); });
    return () => { active = false; };
  }, [profile?.avatar_url]);

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <Crown className="h-6 w-6 text-primary" />
          <span className="font-display text-xl font-bold uppercase">Rei da Quadra</span>
        </div>
        <nav className="flex flex-col gap-1 px-3">
          {NAV.map((n) => (
            <Link
              key={n.label}
              to={n.to}
              disabled={"soon" in n}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent data-[disabled=true]:opacity-50"
              data-disabled={"soon" in n}
              activeProps={!("soon" in n) ? { className: "bg-sidebar-accent text-primary" } : {}}
            >
              <n.icon className="h-4 w-4" /> {n.label}
              {"soon" in n && <span className="ml-auto text-[10px] uppercase">em breve</span>}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-background/90 px-4 py-3 backdrop-blur md:px-8">
          <div className="min-w-0 flex-1 md:flex-none">
            <div className="text-xs uppercase text-muted-foreground">Grupo</div>
            <div className="truncate font-display text-base font-semibold md:text-lg">
              {court.venue?.name ?? active?.name ?? "Nenhum grupo"}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select aria-label="Selecionar quadra" className="max-w-[42vw] rounded-md border bg-background px-2 py-2 text-xs md:max-w-56 md:text-sm" value={selectorValue} disabled={!allVenues.data?.length} onChange={(e) => {
              const [groupId, venueId] = e.target.value.split(":");
              if (!groupId || !venueId) return;
              setActiveGroupId(groupId);
              setActiveCourtId(venueId);
              void qc.invalidateQueries({ queryKey: ["venues", groupId] });
            }}>
              {allVenues.isLoading && <option value="">Carregando quadras…</option>}
              {!allVenues.isLoading && !allVenues.data?.length && <option value="">Nenhuma quadra disponível</option>}
              {(groups ?? []).map((group) => {
                const venues = (allVenues.data ?? []).filter((venue: any) => venue.group_id === group.id);
                return <optgroup key={group.id} label={group.name}>{venues.map((venue: any) => <option key={venue.id} value={`${group.id}:${venue.id}`}>{venue.name}</option>)}</optgroup>;
              })}
            </select>
            <NotificationsBell />
            <DropdownMenu>
              <DropdownMenuTrigger aria-label="Perfil" className="rounded-full">
                <Avatar className="h-9 w-9">
                  <AvatarImage src={avatarUrl ?? undefined} alt="" />
                  <AvatarFallback className="bg-primary text-primary-foreground">
                    {(name[0] ?? "?").toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="max-w-56 truncate">{name}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => navigate({ to: "/perfil", search: { redirect: undefined } })}>
                  <Users className="mr-2 h-4 w-4" /> Meu perfil
                </DropdownMenuItem>
                <DropdownMenuItem onClick={signOut}>
                  <LogOut className="mr-2 h-4 w-4" /> Sair
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="flex-1 px-3 py-4 sm:px-4 sm:py-5 md:px-8 md:py-6">
          <Outlet />
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-border bg-sidebar md:hidden">
        {NAV.slice(0, 5).map((n) => (
          <Link
            key={n.label}
            to={n.to}
            disabled={"soon" in n}
            className="flex flex-col items-center gap-1 py-2 text-[11px] text-muted-foreground data-[disabled=true]:opacity-50"
            data-disabled={"soon" in n}
            activeProps={!("soon" in n) ? { className: "text-primary" } : {}}
          >
            <n.icon className="h-5 w-5" />
            {n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
