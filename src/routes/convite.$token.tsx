import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { setActiveGroupId, ROLE_LABEL } from "@/lib/groups";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/states";

export const Route = createFileRoute("/convite/$token")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Convite | Rei da Quadra" },
      { name: "description", content: "Você foi convidado para um grupo no Rei da Quadra." },
      { property: "og:title", content: "Convite | Rei da Quadra" },
      { property: "og:description", content: "Você foi convidado para um grupo no Rei da Quadra." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: InvitePage,
});

function InvitePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ["invite", token],
    queryFn: async () => {
      const [{ data, error }, { data: u }] = await Promise.all([
        supabase.rpc("get_invite", { _token: token }),
        supabase.auth.getUser(),
      ]);
      if (error) throw error;
      const { data: profile } = u.user
        ? await supabase.from("profiles").select("full_name,age,address,city,neighborhood").eq("id", u.user.id).maybeSingle()
        : { data: null };
      return { invite: data?.[0] ?? null, user: u.user, profile };
    },
  });

  async function accept() {
    setBusy(true);
    const { data, error } = await supabase.rpc("accept_invite", { _token: token });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setActiveGroupId(data as string);
    await qc.invalidateQueries();
    toast.success("Pedido enviado. O administrador da quadra precisa aprovar sua entrada.");
    navigate({ to: "/dashboard" });
  }

  const redirect = `/convite/${token}`;
  let body;
  if (q.isLoading) body = <LoadingState />;
  else if (q.error) body = <ErrorState message={(q.error as Error).message} />;
  else if (!q.data?.invite) body = <ErrorState message="Convite inválido." />;
  else {
    const { invite, user, profile } = q.data;
    if (invite.accepted) body = <ErrorState message="Este convite já foi utilizado." />;
    else if (invite.revoked) body = <ErrorState message="Este convite foi revogado. Peça um novo ao administrador." />;
    else if (invite.expired) body = <ErrorState message="Este convite expirou. Peça um novo ao administrador." />;
    else
      body = (
        <>
          <p className="text-muted-foreground">
            Você foi convidado para <strong className="text-foreground">{invite.group_name}</strong> como{" "}
            {ROLE_LABEL[invite.role]}.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">Convite para: {invite.email}</p>
          {user ? (
            !profile?.full_name?.trim() || !profile.age || !profile.address?.trim() || !profile.city?.trim() || !profile.neighborhood?.trim() ? (
              <div className="mt-4 space-y-3"><p className="text-sm text-muted-foreground">Complete seu perfil antes de solicitar acesso.</p><Button asChild className="w-full"><Link to="/perfil" search={{ redirect }}>Completar perfil</Link></Button></div>
            ) :
            user.email?.toLowerCase() === invite.email ? (
              <Button className="mt-4 w-full" onClick={accept} disabled={busy}>
                {busy ? "Enviando pedido..." : "Solicitar entrada"}
              </Button>
            ) : (
              <div className="mt-4">
                <ErrorState message={`Você está logado como ${user.email}. Entre com ${invite.email} para aceitar.`} />
              </div>
            )
          ) : (
            <div className="mt-4 flex flex-col gap-2">
              <Button asChild>
                <Link to="/auth" search={{ redirect, mode: "signup" }}>Criar conta</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/auth" search={{ redirect, mode: undefined }}>Já tenho conta</Link>
              </Button>
            </div>
          )}
        </>
      );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6">
        <h1 className="mb-3 text-2xl font-bold uppercase">Convite</h1>
        {body}
      </div>
    </main>
  );
}
