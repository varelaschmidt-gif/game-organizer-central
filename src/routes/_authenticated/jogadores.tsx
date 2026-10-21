import { createFileRoute, Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Download, Link2, Pencil, Plus, Upload, UserX, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useActiveGroup, errMsg } from "@/lib/groups";
import { download, parseCsv, toCsv } from "@/lib/csv";
import { DataTable, EmptyState, ErrorState, FilterBar, LoadingState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Player = Database["public"]["Tables"]["players"]["Row"];

export const Route = createFileRoute("/_authenticated/jogadores")({
  head: () => ({
    meta: [
      { title: "Jogadores | Rei da Quadra" },
      { name: "description", content: "Cadastro e gestão dos jogadores do grupo." },
      { property: "og:title", content: "Jogadores | Rei da Quadra" },
      { property: "og:description", content: "Cadastro e gestão dos jogadores do grupo." },
    ],
  }),
  component: PlayersPage,
});

export const POSITIONS = ["Goleiro", "Zagueiro", "Lateral", "Volante", "Meia", "Ponta", "Atacante"];
const STATUS_LABEL: Record<string, string> = { active: "Ativo", inactive: "Inativo", suspended: "Suspenso" };
const TYPE_LABEL: Record<string, string> = { mensalista: "Mensalista", avulso: "Avulso", convidado: "Convidado" };
const PAGE = 20;
const sel = "rounded-md border border-input bg-background px-3 py-2 text-sm";

function PlayersPage() {
  const { group, can, isLoading } = useActiveGroup();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("active");
  const [type, setType] = useState("");
  const [position, setPosition] = useState("");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Player | "new" | null>(null);
  const [inviting, setInviting] = useState<Player | null>(null);
  const [importing, setImporting] = useState(false);
  const manager = can("players");

  useEffect(() => setPage(0), [search, status, type, position]);

  const q = useQuery({
    enabled: !!group,
    placeholderData: keepPreviousData,
    queryKey: ["players", group?.id, search, status, type, position, page],
    queryFn: async () => {
      let r = supabase.from("players").select("*", { count: "exact" }).eq("group_id", group!.id);
      if (search.trim()) {
        const s = search.trim().replace(/[%,()]/g, "");
        r = r.or(`name.ilike.%${s}%,nickname.ilike.%${s}%,email.ilike.%${s}%`);
      }
      if (status) r = r.eq("status", status);
      if (type) r = r.eq("participation_type", type);
      if (position) r = r.or(`position.eq.${position},secondary_positions.cs.{${position}}`);
      const { data, count, error } = await r.order("name").range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw error;
      return { rows: data ?? [], count: count ?? 0 };
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["players"] });

  async function exportCsv() {
    const { data, error } = await supabase.from("players").select("*").eq("group_id", group!.id).order("name");
    if (error) return void toast.error(error.message);
    download(
      "jogadores.csv",
      toCsv(data ?? [], ["name", "nickname", "email", "phone", "position", "secondary_positions", "dominant_foot", "skill_level", "goalkeeper_level", "participation_type", "status", "joined_at", "photo_path"]),
    );
  }

  async function setPlayerStatus(p: Player, s: string) {
    const { error } = await supabase.from("players").update({ status: s }).eq("id", p.id);
    if (error) return void toast.error(error.message);
    toast.success(s === "active" ? "Jogador reativado" : "Jogador desativado (histórico mantido)");
    refresh();
  }

  if (isLoading) return <LoadingState />;
  if (!group) return <EmptyState title="Você ainda não participa de uma quadra" description="Crie sua quadra gratuitamente ou abra o convite recebido na tela inicial." action={<Button asChild><Link to="/dashboard">Ir para início</Link></Button>} />;
  const pages = Math.max(1, Math.ceil((q.data?.count ?? 0) / PAGE));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold uppercase">Jogadores</h1>
        {manager && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={exportCsv}><Download className="mr-2 h-4 w-4" />Exportar CSV</Button>
            <Button variant="outline" onClick={() => setImporting(true)}><Upload className="mr-2 h-4 w-4" />Importar CSV</Button>
            <Button onClick={() => setEditing("new")}><Plus className="mr-2 h-4 w-4" />Novo jogador</Button>
          </div>
        )}
      </div>
      <FilterBar>
        <Input placeholder="Buscar por nome, apelido ou e-mail" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <select className={sel} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">Todos os status</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className={sel} value={type} onChange={(e) => setType(e.target.value)} aria-label="Tipo">
          <option value="">Todos os tipos</option>
          {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className={sel} value={position} onChange={(e) => setPosition(e.target.value)} aria-label="Posição">
          <option value="">Todas as posições</option>
          {POSITIONS.map((p) => <option key={p}>{p}</option>)}
        </select>
      </FilterBar>

      {q.isLoading ? <LoadingState /> : q.error ? <ErrorState message={errMsg(q.error)} onRetry={() => q.refetch()} /> : (
        <DataTable
          rows={q.data!.rows}
          rowKey={(r) => r.id}
          empty={<EmptyState icon={<Users className="h-8 w-8" />} title="Nenhum jogador encontrado" description={manager ? "Cadastre o primeiro jogador ou ajuste os filtros." : "Ajuste os filtros."} action={manager ? <Button onClick={() => setEditing("new")}>Novo jogador</Button> : undefined} />}
          columns={[
            { key: "name", header: "Jogador", render: (r) => <PlayerCell p={r} /> },
            { key: "pos", header: "Posição", render: (r) => [r.position, ...r.secondary_positions].filter(Boolean).join(", ") || "—" },
            { key: "type", header: "Tipo", render: (r) => TYPE_LABEL[r.participation_type] },
            { key: "notes", header: "Nota", render: (r) => `${r.skill_level ?? "—"}${r.goalkeeper_level != null ? ` / G ${r.goalkeeper_level}` : ""}` },
            { key: "status", header: "Status", render: (r) => <Badge variant={r.status === "active" ? "default" : "secondary"}>{STATUS_LABEL[r.status]}</Badge> },
            { key: "acc", header: "Conta", render: (r) => r.user_id ? <span className="text-primary">Vinculada</span> : <span className="text-muted-foreground">Sem conta</span> },
            {
              key: "act", header: "", render: (r) => (
                <div className="flex justify-end gap-1">
                  <Button size="icon" variant="ghost" aria-label="Editar" onClick={() => setEditing(r)}><Pencil className="h-4 w-4" /></Button>
                  {manager && !r.user_id && <Button size="icon" variant="ghost" aria-label="Convidar" onClick={() => setInviting(r)}><Link2 className="h-4 w-4" /></Button>}
                  {manager && (r.status === "active"
                    ? <Button size="icon" variant="ghost" aria-label="Desativar" onClick={() => setPlayerStatus(r, "inactive")}><UserX className="h-4 w-4" /></Button>
                    : <Button size="sm" variant="ghost" onClick={() => setPlayerStatus(r, "active")}>Reativar</Button>)}
                </div>
              ),
            },
          ]}
        />
      )}
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</Button>
          <span>Página {page + 1} de {pages}</span>
          <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Próxima</Button>
        </div>
      )}

      {editing && <PlayerForm groupId={group.id} player={editing === "new" ? null : editing} manager={manager} onClose={() => { setEditing(null); refresh(); }} />}
      {inviting && <InvitePlayer groupId={group.id} player={inviting} onClose={() => setInviting(null)} />}
      {importing && <ImportCsv groupId={group.id} onClose={() => { setImporting(false); refresh(); }} />}
    </div>
  );
}

function usePhotoUrl(path: string | null) {
  return useQuery({
    enabled: !!path,
    queryKey: ["photo", path],
    staleTime: 50 * 60 * 1000,
    queryFn: async () => (await supabase.storage.from("player-photos").createSignedUrl(path!, 3600)).data?.signedUrl ?? null,
  }).data;
}

function PlayerCell({ p }: { p: Player }) {
  const url = usePhotoUrl(p.photo_path);
  return (
    <div className="flex items-center gap-3">
      {url ? <img src={url} alt="" className="h-9 w-9 rounded-full object-cover" /> : <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted font-semibold">{p.name[0]?.toUpperCase()}</div>}
      <div>
        <div className="font-medium">{p.name}</div>
        <div className="text-xs text-muted-foreground">{p.nickname || p.email || ""}</div>
      </div>
    </div>
  );
}

function PlayerForm({ groupId, player, manager, onClose }: { groupId: string; player: Player | null; manager: boolean; onClose: () => void }) {
  const [f, setF] = useState({
    name: player?.name ?? "", nickname: player?.nickname ?? "", email: player?.email ?? "", phone: player?.phone ?? "",
    position: player?.position ?? "", secondary_positions: player?.secondary_positions ?? [], dominant_foot: player?.dominant_foot ?? "",
    skill_level: player?.skill_level?.toString() ?? "", goalkeeper_level: player?.goalkeeper_level?.toString() ?? "",
    participation_type: player?.participation_type ?? "avulso", status: player?.status ?? "active",
    joined_at: player?.joined_at ?? new Date().toISOString().slice(0, 10),
  });
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const photo = usePhotoUrl(player?.photo_path ?? null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    if (player && manager)
      supabase.from("player_private_notes").select("notes").eq("player_id", player.id).maybeSingle().then(({ data }) => setNotes(data?.notes ?? ""));
  }, [player, manager]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const self = { nickname: f.nickname || null, phone: f.phone || null, position: f.position || null, secondary_positions: f.secondary_positions, dominant_foot: f.dominant_foot || null };
      const admin = manager ? {
        name: f.name, email: f.email || null, skill_level: f.skill_level === "" ? null : Number(f.skill_level),
        goalkeeper_level: f.goalkeeper_level === "" ? null : Number(f.goalkeeper_level), participation_type: f.participation_type,
        is_monthly: f.participation_type === "mensalista", status: f.status, joined_at: f.joined_at,
      } : {};
      let id = player?.id;
      if (player) {
        const { error } = await supabase.from("players").update({ ...self, ...admin }).eq("id", player.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("players").insert({ group_id: groupId, name: f.name, ...self, ...admin }).select("id").single();
        if (error) throw error;
        id = data.id;
      }
      if (file && id) {
        const path = `${groupId}/${id}/foto`;
        const { error } = await supabase.storage.from("player-photos").upload(path, file, { upsert: true, contentType: file.type });
        if (error) throw error;
        await supabase.from("players").update({ photo_path: path }).eq("id", id);
      }
      if (manager && id) {
        const { error } = await supabase.from("player_private_notes").upsert({ player_id: id, group_id: groupId, notes });
        if (error) throw error;
      }
      toast.success("Jogador salvo");
      onClose();
    } catch (err) {
      const m = errMsg(err);
      toast.error(m.includes("players_group_email_uniq") ? "Já existe um jogador com este e-mail no grupo" : m);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{player ? "Editar jogador" : "Novo jogador"}</DialogTitle></DialogHeader>
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-center gap-3 sm:col-span-2">
            {photo ? <img src={photo} alt="" className="h-14 w-14 rounded-full object-cover" /> : <div className="h-14 w-14 rounded-full bg-muted" />}
            <div><Label htmlFor="ph">Foto</Label><Input id="ph" type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
          </div>
          <div><Label htmlFor="n">Nome</Label><Input id="n" required disabled={!manager} value={f.name} onChange={set("name")} /></div>
          <div><Label htmlFor="nk">Apelido</Label><Input id="nk" value={f.nickname} onChange={set("nickname")} /></div>
          <div><Label htmlFor="em">E-mail</Label><Input id="em" type="email" disabled={!manager} value={f.email} onChange={set("email")} /></div>
          <div><Label htmlFor="tel">Telefone</Label><Input id="tel" value={f.phone} onChange={set("phone")} /></div>
          <div><Label htmlFor="pos">Posição principal</Label>
            <select id="pos" className={`${sel} w-full`} value={f.position} onChange={set("position")}><option value="">—</option>{POSITIONS.map((p) => <option key={p}>{p}</option>)}</select></div>
          <div><Label htmlFor="ft">Pé dominante</Label>
            <select id="ft" className={`${sel} w-full`} value={f.dominant_foot} onChange={set("dominant_foot")}><option value="">—</option><option value="direito">Direito</option><option value="esquerdo">Esquerdo</option><option value="ambos">Ambos</option></select></div>
          <div className="sm:col-span-2"><Label>Posições secundárias</Label>
            <div className="mt-1 flex flex-wrap gap-2">{POSITIONS.map((p) => {
              const on = f.secondary_positions.includes(p);
              return <button type="button" key={p} onClick={() => setF({ ...f, secondary_positions: on ? f.secondary_positions.filter((x) => x !== p) : [...f.secondary_positions, p] })}
                className={`rounded-full border px-3 py-1 text-xs ${on ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"}`}>{p}</button>;
            })}</div></div>
          {manager && <>
            <div><Label htmlFor="sk">Nota técnica (0–10)</Label><Input id="sk" type="number" min={0} max={10} value={f.skill_level} onChange={set("skill_level")} /></div>
            <div><Label htmlFor="gk">Nota de goleiro (0–10)</Label><Input id="gk" type="number" min={0} max={10} value={f.goalkeeper_level} onChange={set("goalkeeper_level")} /></div>
            <div><Label htmlFor="tp">Participação</Label>
              <select id="tp" className={`${sel} w-full`} value={f.participation_type} onChange={set("participation_type")}>{Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div><Label htmlFor="st">Status</Label>
              <select id="st" className={`${sel} w-full`} value={f.status} onChange={set("status")}>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div><Label htmlFor="jd">Data de entrada</Label><Input id="jd" type="date" value={f.joined_at} onChange={set("joined_at")} /></div>
            <div className="sm:col-span-2"><Label htmlFor="obs">Observações privadas (só administração vê)</Label><Textarea id="obs" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          </>}
          <Button type="submit" disabled={busy} className="sm:col-span-2">{busy ? "Salvando..." : "Salvar"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function InvitePlayer({ groupId, player, onClose }: { groupId: string; player: Player; onClose: () => void }) {
  const [email, setEmail] = useState(player.email ?? "");
  const [link, setLink] = useState<string | null>(null);
  const invites = useQuery({
    queryKey: ["invites", player.id],
    queryFn: async () => (await supabase.from("group_invites").select("*").eq("player_id", player.id).order("created_at", { ascending: false })).data ?? [],
  });
  async function create(e: React.FormEvent) {
    e.preventDefault();
    const { data, error } = await supabase.rpc("create_invite", { _group_id: groupId, _email: email, _role: "player", _player_id: player.id });
    if (error) return void toast.error(error.message);
    setLink(`${window.location.origin}/convite/${data}`);
    invites.refetch();
  }
  async function revoke(id: string) {
    const { error } = await supabase.rpc("revoke_invite", { _invite_id: id });
    if (error) return void toast.error(error.message);
    toast.success("Convite revogado");
    invites.refetch();
  }
  const stateOf = (i: { accepted_at: string | null; revoked_at: string | null; expires_at: string }) =>
    i.accepted_at ? "Usado" : i.revoked_at ? "Revogado" : new Date(i.expires_at) < new Date() ? "Expirado" : "Pendente";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Convidar {player.name}</DialogTitle></DialogHeader>
        {link ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Link pessoal, válido por 7 dias, só para {email}. Convites anteriores deste jogador foram revogados.</p>
            <Input readOnly value={link} onFocus={(e) => e.target.select()} />
            <Button className="w-full" onClick={() => { navigator.clipboard.writeText(link); toast.success("Link copiado"); }}>Copiar link</Button>
          </div>
        ) : (
          <form onSubmit={create} className="space-y-2">
            <Label htmlFor="ie">E-mail do jogador</Label>
            <Input id="ie" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            <Button type="submit" className="w-full">Gerar convite</Button>
          </form>
        )}
        {(invites.data?.length ?? 0) > 0 && (
          <div className="mt-2 space-y-1 text-sm">
            <div className="font-medium">Convites</div>
            {invites.data!.map((i) => (
              <div key={i.id} className="flex items-center justify-between rounded-md border border-border px-3 py-1.5">
                <span>{i.email} · {stateOf(i)}</span>
                {stateOf(i) === "Pendente" && <Button size="sm" variant="ghost" onClick={() => revoke(i.id)}>Revogar</Button>}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface ImportRow { data: Record<string, string>; errors: string[] }

function ImportCsv({ groupId, onClose }: { groupId: string; onClose: () => void }) {
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File) {
    const parsed = parseCsv(await file.text());
    const { data: existing } = await supabase.from("players").select("name, email").eq("group_id", groupId);
    const emails = new Set((existing ?? []).map((p) => p.email?.trim().toLowerCase()).filter(Boolean));
    const names = new Set((existing ?? []).map((p) => p.name.trim().toLowerCase()));
    const seenE = new Set<string>(), seenN = new Set<string>();
    setRows(parsed.map((d) => {
      const errors: string[] = [];
      const name = (d["name"] || d["nome"] || "").trim();
      const email = (d["email"] || d["e-mail"] || "").trim().toLowerCase();
      const normalizedName = name.toLowerCase();
      if (!name) errors.push("Sem nome");
      if (email && (emails.has(email) || seenE.has(email))) errors.push("E-mail duplicado");
      if (name && (names.has(normalizedName) || seenN.has(normalizedName))) errors.push("Nome já cadastrado");
      const t = (d["participation_type"] || d["tipo"] || "avulso").trim().toLowerCase();
      if (!["mensalista", "avulso", "convidado"].includes(t)) errors.push("Tipo inválido");
      const sk = d["skill_level"] || d["nota"] || "";
      const gk = d["goalkeeper_level"] || d["nota_goleiro"] || "";
      if (sk && (isNaN(+sk) || +sk < 0 || +sk > 10)) errors.push("Nota técnica inválida");
      if (gk && (isNaN(+gk) || +gk < 0 || +gk > 10)) errors.push("Nota de goleiro inválida");
      const foot = (d["dominant_foot"] || d["pe_dominante"] || "").trim().toLowerCase();
      if (foot && !["direito", "esquerdo", "ambos"].includes(foot)) errors.push("Pé dominante inválido");
      const playerStatus = (d["status"] || "active").trim().toLowerCase();
      if (!["active", "inactive", "suspended"].includes(playerStatus)) errors.push("Status inválido");
      const joinedAt = d["joined_at"] || d["data_entrada"] || new Date().toISOString().slice(0, 10);
      if (joinedAt && !/^\d{4}-\d{2}-\d{2}$/.test(joinedAt)) errors.push("Data de entrada inválida (use AAAA-MM-DD)");
      const positions = (d["secondary_positions"] || d["posicoes_secundarias"] || "").split(/[|;]/).map((p) => p.trim()).filter(Boolean);
      seenE.add(email); if (name) seenN.add(normalizedName);
      return { data: { ...d, name, email, participation_type: t, skill_level: sk, goalkeeper_level: gk, dominant_foot: foot, status: playerStatus, joined_at: joinedAt, secondary_positions: positions.join("|") }, errors };
    }));
  }

  async function doImport() {
    const ok = rows!.filter((r) => r.errors.length === 0);
    if (!ok.length) return;
    setBusy(true);
    const { error } = await supabase.from("players").insert(ok.map(({ data: d }) => ({
      group_id: groupId, name: d["name"]!, email: d["email"] || null, nickname: d["nickname"] || d["apelido"] || null,
      phone: d["phone"] || d["telefone"] || null, position: d["position"] || d["posicao"] || null,
      secondary_positions: (d["secondary_positions"] || d["posicoes_secundarias"] || "").split(/[|;]/).map((p) => p.trim()).filter(Boolean), dominant_foot: d["dominant_foot"] || d["pe_dominante"] || null,
      participation_type: d["participation_type"]!, is_monthly: d["participation_type"] === "mensalista",
      status: d["status"] as "active" | "inactive" | "suspended", joined_at: d["joined_at"] || d["data_entrada"],
      skill_level: d["skill_level"] ? Number(d["skill_level"]) : null,
      goalkeeper_level: d["goalkeeper_level"] ? Number(d["goalkeeper_level"]) : null,
    })));
    setBusy(false);
    if (error) return void toast.error(error.message);
    toast.success(`${ok.length} jogadores importados`);
    onClose();
  }

  const valid = rows?.filter((r) => r.errors.length === 0).length ?? 0;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle>Importar jogadores (CSV)</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Colunas aceitas: nome, apelido, email, telefone, posicao, tipo (mensalista/avulso/convidado), nota.</p>
        <Input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        {rows && (
          <>
            <DataTable rows={rows} rowKey={(r) => JSON.stringify(r.data)} columns={[
              { key: "n", header: "Nome", render: (r) => r.data["name"] },
              { key: "e", header: "E-mail", render: (r) => r.data["email"] },
              { key: "t", header: "Tipo", render: (r) => r.data["participation_type"] },
              { key: "s", header: "Validação", render: (r) => r.errors.length ? <span className="text-destructive">{r.errors.join(", ")}</span> : <span className="text-primary">OK</span> },
            ]} />
            <Button onClick={doImport} disabled={busy || valid === 0}>Importar {valid} válidos (ignorar {rows.length - valid})</Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

