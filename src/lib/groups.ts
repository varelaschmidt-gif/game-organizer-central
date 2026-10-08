import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type GroupRole = "admin" | "organizer" | "player";

export interface MyGroup {
  id: string;
  name: string;
  role: GroupRole;
  permissions: string[];
}

export const myGroupsQuery = queryOptions({
  queryKey: ["my-groups"],
  queryFn: async (): Promise<MyGroup[]> => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return [];
    const { data, error } = await supabase
      .from("group_members")
      .select("role, permissions, groups(id, name)")
      .eq("user_id", u.user.id);
    if (error) throw error;
    return (data ?? [])
      .filter((r) => r.groups)
      .map((r) => ({
        id: r.groups!.id,
        name: r.groups!.name,
        role: r.role,
        permissions: r.permissions,
      }));
  },
});

export const canCreateGroupQuery = queryOptions({
  queryKey: ["can-create-group"],
  queryFn: async () => {
    const { data, error } = await supabase.rpc("has_platform_role", { _role: "group_creator" });
    if (error) throw error;
    return Boolean(data);
  },
});

export const profileQuery = queryOptions({
  queryKey: ["profile"],
  queryFn: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return null;
    const { data } = await supabase.from("profiles").select("*").eq("id", u.user.id).maybeSingle();
    return { email: u.user.email ?? "", ...(data ?? { full_name: "" }) };
  },
});

export const ROLE_LABEL: Record<GroupRole, string> = {
  admin: "Administrador",
  organizer: "Organizador",
  player: "Jogador",
};

const KEY = "rdq-active-group";
export const getActiveGroupId = () =>
  typeof window === "undefined" ? null : window.localStorage.getItem(KEY);
export const setActiveGroupId = (id: string) => window.localStorage.setItem(KEY, id);
