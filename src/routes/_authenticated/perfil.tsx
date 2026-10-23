import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { profileQuery } from "@/lib/groups";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingState } from "@/components/states";

export const Route = createFileRoute("/_authenticated/perfil")({
  validateSearch: (search: Record<string, unknown>) => ({ redirect: typeof search["redirect"] === "string" ? search["redirect"] : undefined }),
  head: () => ({ meta: [{ title: "Meu perfil | Rei da Quadra" }] }),
  component: ProfilePage,
});

function ProfilePage() {
  const profile = useQuery(profileQuery);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const [fields, setFields] = useState({ full_name: "", age: "", address: "", city: "", neighborhood: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!profile.data) return;
    setFields({
      full_name: profile.data.full_name ?? "",
      age: profile.data.age?.toString() ?? "",
      address: profile.data.address ?? "",
      city: profile.data.city ?? "",
      neighborhood: profile.data.neighborhood ?? "",
    });
  }, [profile.data]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    setBusy(true);
    const { error } = await supabase.from("profiles").upsert({
      id: auth.user.id,
      full_name: fields.full_name.trim(),
      age: Number(fields.age),
      address: fields.address.trim(),
      city: fields.city.trim(),
      neighborhood: fields.neighborhood.trim(),
    });
    setBusy(false);
    if (error) return void toast.error(error.message);
    await qc.invalidateQueries({ queryKey: ["profile"] });
    toast.success("Perfil atualizado");
    navigate({ to: (redirect || "/dashboard") as any, replace: true });
  }

  if (profile.isLoading) return <LoadingState />;
  return (
    <div className="mx-auto max-w-xl rounded-xl border border-border bg-card p-6">
      <h1 className="text-2xl font-bold">Complete seu perfil</h1>
      <p className="mt-1 text-sm text-muted-foreground">Essas informações são necessárias para criar uma quadra ou pedir acesso a um grupo.</p>
      <form onSubmit={save} className="mt-5 space-y-4">
        <div><Label htmlFor="profile-name">Nome</Label><Input id="profile-name" required value={fields.full_name} onChange={(e) => setFields({ ...fields, full_name: e.target.value })} /></div>
        <div><Label htmlFor="profile-age">Idade</Label><Input id="profile-age" required type="number" min={1} max={120} value={fields.age} onChange={(e) => setFields({ ...fields, age: e.target.value })} /></div>
        <div><Label htmlFor="profile-address">Endereço</Label><Input id="profile-address" required autoComplete="street-address" value={fields.address} onChange={(e) => setFields({ ...fields, address: e.target.value })} /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><Label htmlFor="profile-city">Cidade</Label><Input id="profile-city" required autoComplete="address-level2" value={fields.city} onChange={(e) => setFields({ ...fields, city: e.target.value })} /></div>
          <div><Label htmlFor="profile-neighborhood">Bairro</Label><Input id="profile-neighborhood" required value={fields.neighborhood} onChange={(e) => setFields({ ...fields, neighborhood: e.target.value })} /></div>
        </div>
        <Button className="w-full" disabled={busy}>{busy ? "Salvando…" : "Salvar perfil"}</Button>
      </form>
    </div>
  );
}
