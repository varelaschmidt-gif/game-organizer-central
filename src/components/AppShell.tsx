import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  CalendarDays,
  Crown,
  LayoutDashboard,
  LogOut,
  Settings,
  Users,
  Wallet,
  BarChart3,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { myGroupsQuery, profileQuery, getActiveGroupId } from "@/lib/groups";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

const NAV = [
  { to: "/dashboard", label: "Início", icon: LayoutDashboard },
  { to: "/jogos", label: "Jogos", icon: CalendarDays },
  { to: "/jogadores", label: "Jogadores", icon: Users },
  { to: "/dashboard", label: "Financeiro", icon: Wallet, soon: true },
  { to: "/dashboard", label: "Estatísticas", icon: BarChart3, soon: true },
  { to: "/dashboard", label: "Configurações", icon: Settings, soon: true },
] as const;

export function AppShell() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: groups } = useQuery(myGroupsQuery);
  const { data: profile } = useQuery(profileQuery);
  const active = groups?.find((g) => g.id === getActiveGroupId()) ?? groups?.[0];
  const name = profile?.full_name || profile?.email || "";

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
          <div className="min-w-0">
            <div className="text-xs uppercase text-muted-foreground">Grupo</div>
            <div className="truncate font-display text-lg font-semibold">
              {active?.name ?? "Nenhum grupo"}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              aria-label="Notificações"
              className="rounded-full p-2 text-muted-foreground hover:bg-muted"
            >
              <Bell className="h-5 w-5" />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger aria-label="Perfil" className="rounded-full">
                <Avatar className="h-9 w-9">
                  <AvatarFallback className="bg-primary text-primary-foreground">
                    {(name[0] ?? "?").toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="max-w-56 truncate">{name}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={signOut}>
                  <LogOut className="mr-2 h-4 w-4" /> Sair
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="flex-1 px-4 py-6 md:px-8">
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
