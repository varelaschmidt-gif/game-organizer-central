import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { isProfileComplete } from "@/lib/groups";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      throw redirect({ to: "/auth", search: { redirect: location.href } });
    }
    if (!location.pathname.endsWith("/perfil")) {
      const { data: profile } = await supabase.from("profiles").select("full_name,phone,age,position,dominant_foot").eq("id", data.user.id).maybeSingle();
      if (!isProfileComplete({ ...profile, email: data.user.email })) {
        throw redirect({ to: "/perfil", search: { redirect: location.href } });
      }
    }
    return { user: data.user };
  },
  component: AppShell,
});
