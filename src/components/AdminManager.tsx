import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ROLE_LABEL, type GroupRole } from "@/lib/groups";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const MAX_ADMINS = 3;

type Member = { member_id: string; user_id: string; full_name: string; email: string; role: GroupRole; is_creator: boolean };

export function AdminManager({ groupId }: { groupId: string }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["group-members-admin", groupId],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("list_group_members", { _group_id: groupId });
      if (error) throw error;
      return (data ?? []) as Member[];
    },
  });
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Carregando membros…</p>;
  if (q.error) return <p className="text-sm text-destructive">Não foi possível carregar os membros. A atualização do banco para administradores ainda pode estar pendente.</p>;
  const members = q.data ?? [];
  const admins = members.filter((m) => m.role === "admin").length;

  async function change(m: Member, admin: boolean) {
    setBusy(m.user_id);
    const { error } = await (supabase as any).rpc("set_group_admin", { _group_id: groupId, _user_id: m.user_id, _admin: admin });
    setBusy(null);
    if (error) return void toast.error(error.message);
    toast.success(admin ? "Membro promovido a administrador" : "Administrador rebaixado a jogador");
    await qc.invalidateQueries({ queryKey: ["group-members-admin", groupId] });
    await qc.invalidateQueries({ queryKey: ["my-groups"] });
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{admins} de {MAX_ADMINS} administradores</p>
      {members.map((m) => (
        <div key={m.member_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
          <div className="min-w-0">
            <p className="truncate font-medium">{m.full_name}{m.is_creator && <span className="ml-2 text-xs text-muted-foreground">(criador)</span>}</p>
            <p className="truncate text-xs text-muted-foreground">{m.email}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={m.role === "admin" ? "default" : "secondary"}>{ROLE_LABEL[m.role]}</Badge>
            {m.role === "admin" ? (
              <Button size="sm" variant="outline" disabled={busy === m.user_id || admins <= 1} title={admins <= 1 ? "A quadra precisa de pelo menos um administrador" : undefined} onClick={() => change(m, false)}>Rebaixar</Button>
            ) : (
              <Button size="sm" disabled={busy === m.user_id || admins >= MAX_ADMINS} title={admins >= MAX_ADMINS ? "Limite de 3 administradores atingido" : undefined} onClick={() => change(m, true)}>Promover a admin</Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
