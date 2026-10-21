import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { MapPin, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useActiveGroup } from "@/lib/groups";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/quadras")({
  head: () => ({ meta: [{ title: "Quadras | Rei da Quadra" }] }),
  component: CourtsPage,
});

type Court = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  surface: string | null;
  covered: boolean;
  price_per_hour: number | null;
  notes: string | null;
  is_active: boolean;
};

const blank = {
  name: "",
  address: "",
  phone: "",
  surface: "",
  covered: false,
  price_per_hour: "",
  notes: "",
};

function CourtsPage() {
  const { group, can, isLoading } = useActiveGroup();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Court | null | undefined>(undefined);
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const courts = useQuery({
    queryKey: ["venues", group?.id],
    enabled: !!group,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("venues")
        .select("*")
        .eq("group_id", group!.id)
        .order("is_active", { ascending: false })
        .order("name");
      if (error) throw error;
      return (data ?? []) as Court[];
    },
  });
  const manager = can("events");

  function startNew() {
    setForm(blank);
    setEditing(null);
  }

  function startEdit(court: Court) {
    setForm({
      name: court.name,
      address: court.address ?? "",
      phone: court.phone ?? "",
      surface: court.surface ?? "",
      covered: court.covered,
      price_per_hour: court.price_per_hour == null ? "" : String(court.price_per_hour),
      notes: court.notes ?? "",
    });
    setEditing(court);
  }

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!group || !manager) return;
    setBusy(true);
    const { data: authData } = await supabase.auth.getUser();
    const payload = {
      ...form,
      name: form.name.trim(),
      group_id: group.id,
      address: form.address.trim() || null,
      phone: form.phone.trim() || null,
      surface: form.surface.trim() || null,
      price_per_hour: form.price_per_hour === "" ? null : Number(form.price_per_hour),
      notes: form.notes.trim() || null,
      ...(!editing ? { created_by: authData.user?.id } : {}),
    };
    const db = supabase as any;
    const result = editing
      ? await db.from("venues").update(payload).eq("id", editing.id).eq("group_id", group.id)
      : await db.from("venues").insert(payload);
    setBusy(false);
    if (result.error) {
      toast.error(result.error.message);
      return;
    }
    toast.success(editing ? "Quadra atualizada" : "Quadra cadastrada");
    setEditing(undefined);
    await qc.invalidateQueries({ queryKey: ["venues", group.id] });
  }

  async function setActive(court: Court, is_active: boolean) {
    const { error } = await (supabase as any)
      .from("venues")
      .update({ is_active })
      .eq("id", court.id)
      .eq("group_id", group!.id);
    if (error) return void toast.error(error.message);
    toast.success(is_active ? "Quadra reativada" : "Quadra desativada");
    await qc.invalidateQueries({ queryKey: ["venues", group!.id] });
  }

  if (isLoading || courts.isLoading) return <LoadingState />;
  if (!group) return <EmptyState title="Você ainda não participa de uma quadra" description="Crie uma quadra gratuitamente ou abra o convite recebido na tela inicial." action={<Button asChild><Link to="/dashboard">Ir para início</Link></Button>} />;
  if (courts.error) return <ErrorState message={(courts.error as Error).message} onRetry={() => courts.refetch()} />;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Quadras</h1>
          <p className="text-sm text-muted-foreground">Locais do grupo para organizar os eventos.</p>
        </div>
        {manager && <Button onClick={startNew}><Plus className="mr-2 h-4 w-4" />Nova quadra</Button>}
      </header>

      {courts.data?.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {courts.data.map((court) => (
            <article key={court.id} className="rounded-xl border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{court.name}</h2>
                  <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                    <MapPin className="h-4 w-4 shrink-0" /> {court.address || "Endereço não informado"}
                  </p>
                </div>
                <span className="rounded-full bg-muted px-2 py-1 text-xs">{court.is_active ? "Ativa" : "Inativa"}</span>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                {[court.surface, court.covered ? "Coberta" : null, court.phone, court.price_per_hour != null ? `R$ ${Number(court.price_per_hour).toFixed(2)}/hora` : null]
                  .filter(Boolean).join(" · ") || "Detalhes não informados"}
              </p>
              {court.notes && <p className="mt-2 whitespace-pre-wrap text-sm">{court.notes}</p>}
              {manager && (
                <div className="mt-4 flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => startEdit(court)}><Pencil className="mr-2 h-4 w-4" />Editar</Button>
                  <Button variant="outline" size="sm" onClick={() => setActive(court, !court.is_active)}>{court.is_active ? "Desativar" : "Reativar"}</Button>
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<MapPin className="h-8 w-8" />}
          title="Nenhuma quadra cadastrada"
          description={manager ? "Cadastre os locais usados pelo grupo. Eles poderão ser selecionados ao criar eventos." : "Os locais cadastrados pelo administrador do grupo aparecerão aqui."}
        />
      )}

      {editing !== undefined && (
        <div className="fixed inset-0 z-50 overflow-auto bg-black/50 p-4" role="presentation">
          <form onSubmit={save} className="mx-auto my-8 grid max-w-xl gap-4 rounded-xl bg-background p-5">
            <h2 className="text-xl font-bold">{editing ? "Editar quadra" : "Cadastrar quadra"}</h2>
            <div><Label htmlFor="court-name">Nome</Label><Input id="court-name" required maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label htmlFor="court-address">Endereço</Label><Input id="court-address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><Label htmlFor="court-phone">Telefone</Label><Input id="court-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              <div><Label htmlFor="court-surface">Tipo de piso</Label><Input id="court-surface" placeholder="Sintético, society…" value={form.surface} onChange={(e) => setForm({ ...form, surface: e.target.value })} /></div>
            </div>
            <div><Label htmlFor="court-price">Valor por hora (R$)</Label><Input id="court-price" type="number" min="0" step="0.01" value={form.price_per_hour} onChange={(e) => setForm({ ...form, price_per_hour: e.target.value })} /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.covered} onChange={(e) => setForm({ ...form, covered: e.target.checked })} /> Quadra coberta</label>
            <div><Label htmlFor="court-notes">Observações</Label><Textarea id="court-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setEditing(undefined)}>Cancelar</Button><Button disabled={busy}>{busy ? "Salvando…" : "Salvar quadra"}</Button></div>
          </form>
        </div>
      )}
    </div>
  );
}

