import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      throw redirect({ to: "/auth", search: { redirect: location.href } });
    }
    if (!location.pathname.endsWith("/perfil")) {
      const { data: profile } = await supabase.from("profiles").select("full_name,age,address,city,neighborhood").eq("id", data.user.id).maybeSingle();
      if (!profile?.full_name?.trim() || !profile.age || !profile.address?.trim() || !profile.city?.trim() || !profile.neighborhood?.trim()) {
        throw redirect({ to: "/perfil", search: { redirect: location.href } });
      }
    }
    return { user: data.user };
  },
  component: AppShell,
});

