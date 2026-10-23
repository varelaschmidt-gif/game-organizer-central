import { queryOptions, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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
    return { email: u.user.email ?? "", ...(data ?? { full_name: "", age: null, address: null, city: null, neighborhood: null }) };
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

const COURT_KEY = "rdq-active-court";
export const getActiveCourtId = () => typeof window === "undefined" ? null : window.localStorage.getItem(COURT_KEY);
export const setActiveCourtId = (id: string) => {
  window.localStorage.setItem(COURT_KEY, id);
  window.dispatchEvent(new Event("rdq-court-change"));
};

export function useActiveCourt(groupId?: string) {
  const [selectedId, setSelectedId] = useState(getActiveCourtId);
  useEffect(() => {
    const update = () => setSelectedId(getActiveCourtId());
    window.addEventListener("rdq-court-change", update);
    window.addEventListener("storage", update);
    return () => { window.removeEventListener("rdq-court-change", update); window.removeEventListener("storage", update); };
  }, []);
  const query = useQuery({
    queryKey: ["venues", groupId],
    enabled: !!groupId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("venues").select("*").eq("group_id", groupId).eq("is_active", true).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const venues = query.data ?? [];
  const venue = venues.find((item: any) => item.id === selectedId) ?? venues[0];
  useEffect(() => {
    if (venue && venue.id !== selectedId) setActiveCourtId(venue.id);
  }, [venue?.id, selectedId]);
  return { ...query, venues, venue };
}

export function useActiveGroup() {
  const q = useQuery(myGroupsQuery);
  const list = q.data ?? [];
  const group = list.find((g) => g.id === getActiveGroupId()) ?? list[0];
  const can = (perm: string) =>
    !!group && (group.role === "admin" || (group.role === "organizer" && group.permissions.includes(perm)));
  return { ...q, group, can };
}

export const myPlayerQuery = (groupId: string) =>
  queryOptions({
    queryKey: ["my-player", groupId],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data } = await supabase.from("players").select("*").eq("group_id", groupId).eq("user_id", u.user.id).maybeSingle();
      return data;
    },
  });

export function errMsg(e: unknown) {
  return e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "Erro inesperado";
}
