import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getActiveGroupId, myGroupsQuery, useActiveCourt } from "@/lib/groups";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/times")({ component: TeamsPage });
const db = supabase as any;

function TeamsPage() {
  const qc=useQueryClient(); const groups=useQuery(myGroupsQuery);
  const group=groups.data?.find(g=>g.id===getActiveGroupId())??groups.data?.[0];
  const court=useActiveCourt(group?.id); const [eventId,setEventId]=useState(""); const [newName,setNewName]=useState("");
  const [newEmail,setNewEmail]=useState(""); const [busy,setBusy]=useState(false); const [teamChoice,setTeamChoice]=useState("");
  const canManage=group?.role==="admin";
  const events=useQuery({queryKey:["events",group?.id,court.venue?.id],enabled:!!group&&!!court.venue,queryFn:async()=>{const {data,error}=await db.from("events").select("id,title,starts_at,status,teams_count,players_per_team").eq("group_id",group!.id).eq("venue_id",court.venue!.id).order("starts_at",{ascending:false});if(error)throw error;return data??[]}});
  const event=events.data?.find((e:any)=>e.id===(eventId||events.data?.[0]?.id));
  const teams=useQuery({queryKey:["event-teams",event?.id],enabled:!!event,queryFn:async()=>{const {data,error}=await db.from("event_teams").select("*,event_team_players(*,players(id,name,nickname,position,skill_level,goalkeeper_level))").eq("event_id",event.id).order("name");if(error)throw error;return data??[]}});
  const roster=useQuery({queryKey:["event-roster",event?.id],enabled:!!event,queryFn:async()=>{const {data,error}=await db.from("attendances").select("player_id,status,attended,players(id,name,nickname,position,skill_level,goalkeeper_level)").eq("event_id",event.id).eq("status","confirmed");if(error)throw error;return data??[]}});
  const players=useQuery({queryKey:["players",group?.id,court.venue?.id],enabled:!!group&&!!court.venue,queryFn:async()=>{const {data,error}=await db.from("players").select("id,name,nickname,position,skill_level,goalkeeper_level,status").eq("group_id",group!.id).eq("venue_id",court.venue!.id).eq("status","active").order("name");if(error)throw error;return data??[]}});
  async function generate(){if(!event){return;}setBusy(true);const {error}=await db.rpc("generate_event_teams",{_event_id:event.id});setBusy(false);if(error)toast.error(error.message);else{toast.success("Times montados com os jogadores confirmados");await qc.invalidateQueries({queryKey:["event-teams",event.id]})}}
  async function addToTeam(playerId:string){if(!event||!teamChoice){toast.error("Escolha o time para adicionar o jogador");return;}setBusy(true);const {error}=await db.rpc("add_player_to_event_team",{_event_id:event.id,_team_id:teamChoice,_player_id:playerId});setBusy(false);if(error)toast.error(error.message);else{toast.success("Jogador adicionado ao evento e ao time");await Promise.all([qc.invalidateQueries({queryKey:["event-teams",event.id]}),qc.invalidateQueries({queryKey:["event-roster",event.id]})])}}
  async function createAndAdd(e:React.FormEvent){e.preventDefault();if(!event||!teamChoice){toast.error("Selecione um evento e um time");return;}setBusy(true);const {error}=await db.rpc("create_player_for_event_team",{_event_id:event.id,_team_id:teamChoice,_name:newName.trim(),_email:newEmail.trim()||null});setBusy(false);if(error)toast.error(error.message);else{setNewName("");setNewEmail("");toast.success("Novo jogador cadastrado nesta quadra e incluído no time");await Promise.all([qc.invalidateQueries({queryKey:["players",group!.id,court.venue!.id]}),qc.invalidateQueries({queryKey:["event-teams",event.id]}),qc.invalidateQueries({queryKey:["event-roster",event.id]})])}}
  if(!group)return <Empty message="Entre em uma quadra para organizar times."/>;
  if(!court.venue)return <Empty message="Selecione uma quadra para organizar os times."/>;
  return <div className="mx-auto max-w-5xl space-y-5"><header className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-3xl font-bold">Times</h1><p className="text-sm text-muted-foreground">{court.venue.name} · escalações dos eventos a partir dos confirmados.</p></div><Button variant="outline" asChild><Link to="/quadras">Trocar quadra</Link></Button></header>
    <section className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-[1fr_auto]"><div><Label htmlFor="team-event">Evento</Label><select id="team-event" className="mt-1 w-full rounded-md border bg-background p-2" value={event?.id??""} onChange={e=>setEventId(e.target.value)}><option value="">Selecione um evento</option>{events.data?.map((e:any)=><option key={e.id} value={e.id}>{new Date(e.starts_at).toLocaleDateString("pt-BR")} · {e.title} · {e.status}</option>)}</select></div><div className="flex items-end">{canManage&&<Button disabled={!event||busy||event.status==="cancelled"} onClick={generate}>Tirar times ({roster.data?.length??0} confirmados)</Button>}</div></section>
    {!event&&<p className="rounded-xl border p-6 text-center text-muted-foreground">Nenhum evento cadastrado nesta quadra.</p>}
    {event&&<><div className="grid gap-3 md:grid-cols-2">{teams.data?.map((t:any)=><article key={t.id} className="rounded-xl border bg-card p-4"><h2 className="text-lg font-semibold">{t.name}</h2><div className="mt-3 space-y-2">{t.event_team_players?.map((a:any)=><div key={a.player_id} className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2"><div>{a.players?.nickname||a.players?.name}<span className="ml-2 text-xs text-muted-foreground">{a.players?.position||"Sem posição"}</span></div><span className="text-xs text-muted-foreground">{a.players?.skill_level??"—"}/10</span></div>)}{!t.event_team_players?.length&&<p className="text-sm text-muted-foreground">Nenhum jogador neste time.</p>}</div></article>)}</div>
      {canManage&&teams.data?.length>0&&<section className="grid gap-4 rounded-xl border bg-card p-4 md:grid-cols-2"><div className="space-y-2"><h2 className="font-semibold">Adicionar jogador da quadra</h2><Label htmlFor="assign-team">Time</Label><select id="assign-team" className="w-full rounded-md border bg-background p-2" value={teamChoice} onChange={e=>setTeamChoice(e.target.value)}><option value="">Escolha um time</option>{teams.data.map((t:any)=><option key={t.id} value={t.id}>{t.name}</option>)}</select><div className="max-h-60 space-y-1 overflow-y-auto">{players.data?.filter((p:any)=>!teams.data.some((t:any)=>t.event_team_players?.some((a:any)=>a.player_id===p.id))).map((p:any)=><div key={p.id} className="flex items-center justify-between gap-2 rounded border p-2 text-sm"><span>{p.nickname||p.name}</span><Button size="sm" variant="outline" disabled={busy||!teamChoice} onClick={()=>addToTeam(p.id)}>Adicionar</Button></div>)}</div></div>
      <form className="space-y-2" onSubmit={createAndAdd}><h2 className="font-semibold">Cadastrar jogador avulso</h2><p className="text-sm text-muted-foreground">O jogador será vinculado a esta quadra e incluído como presente neste evento.</p><Label htmlFor="new-player-name">Nome</Label><Input id="new-player-name" required value={newName} onChange={e=>setNewName(e.target.value)}/><Label htmlFor="new-player-email">E-mail (opcional)</Label><Input id="new-player-email" type="email" value={newEmail} onChange={e=>setNewEmail(e.target.value)}/><Button disabled={busy||!teamChoice}>Cadastrar e adicionar ao time</Button></form></section>}
    </>}
  </div>;
}

function Empty({message}:{message:string}){return <div className="space-y-3"><p className="text-muted-foreground">{message}</p><Button asChild><Link to="/quadras">Ir para quadras</Link></Button></div>}
