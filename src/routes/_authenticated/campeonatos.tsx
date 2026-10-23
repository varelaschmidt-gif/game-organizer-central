import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getActiveGroupId, myGroupsQuery, useActiveCourt } from "@/lib/groups";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route=createFileRoute("/_authenticated/campeonatos")({component:ChampionshipsPage});
const db=supabase as any;
const statusLabel:Record<string,string>={planned:"Agendado",active:"Em andamento",completed:"Finalizado",cancelled:"Cancelado"};
function ChampionshipsPage(){
 const qc=useQueryClient();const groups=useQuery(myGroupsQuery);const group=groups.data?.find(g=>g.id===getActiveGroupId())??groups.data?.[0];const court=useActiveCourt(group?.id);const [form,setForm]=useState(false);const [name,setName]=useState("");const [starts,setStarts]=useState("");const [ends,setEnds]=useState("");const [busy,setBusy]=useState(false);const admin=group?.role==="admin";
 const q=useQuery({queryKey:["championships",group?.id,court.venue?.id],enabled:!!group&&!!court.venue,queryFn:async()=>{const {data,error}=await db.from("court_championships").select("*").eq("group_id",group!.id).eq("venue_id",court.venue!.id).order("starts_on",{ascending:false});if(error)throw error;return data??[]}});
 async function save(e:React.FormEvent){e.preventDefault();if(!group||!court.venue)return;setBusy(true);const {data:user}=await supabase.auth.getUser();const {error}=await db.from("court_championships").insert({group_id:group.id,venue_id:court.venue.id,name:name.trim(),starts_on:starts||null,ends_on:ends||null,created_by:user.user?.id});setBusy(false);if(error)toast.error(error.message);else{toast.success("Campeonato criado");setForm(false);setName("");setStarts("");setEnds("");await qc.invalidateQueries({queryKey:["championships",group.id,court.venue.id]})}}
 async function changeStatus(item:any,status:string){const {error}=await db.from("court_championships").update({status}).eq("id",item.id).eq("venue_id",court.venue.id);if(error)toast.error(error.message);else{toast.success("Status atualizado");await q.refetch()}}
 if(!group||!court.venue)return <div className="space-y-3"><p className="text-muted-foreground">Selecione uma quadra para acessar os campeonatos.</p><Button asChild><Link to="/quadras">Ir para quadras</Link></Button></div>;
 return <div className="mx-auto max-w-5xl space-y-5"><header className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-3xl font-bold">Campeonatos</h1><p className="text-sm text-muted-foreground">Competições vinculadas a {court.venue.name}.</p></div>{admin&&<Button onClick={()=>setForm(!form)}>{form?"Fechar":"Novo campeonato"}</Button>}</header>
 {form&&<form onSubmit={save} className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-3"><div className="sm:col-span-3"><Label htmlFor="champ-name">Nome</Label><Input id="champ-name" required minLength={2} value={name} onChange={e=>setName(e.target.value)}/></div><div><Label htmlFor="champ-start">Início</Label><Input id="champ-start" type="date" value={starts} onChange={e=>setStarts(e.target.value)}/></div><div><Label htmlFor="champ-end">Fim</Label><Input id="champ-end" type="date" min={starts||undefined} value={ends} onChange={e=>setEnds(e.target.value)}/></div><Button className="self-end" disabled={busy}>{busy?"Salvando…":"Salvar campeonato"}</Button></form>}
 <div className="grid gap-3 md:grid-cols-2">{q.data?.map((item:any)=><article key={item.id} className="space-y-3 rounded-xl border bg-card p-4"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">{item.name}</h2><p className="text-sm text-muted-foreground">{item.starts_on?new Date(`${item.starts_on}T12:00:00`).toLocaleDateString("pt-BR"):"Data a definir"}{item.ends_on?` — ${new Date(`${item.ends_on}T12:00:00`).toLocaleDateString("pt-BR")}`:""}</p></div><span className="rounded-full bg-muted px-2 py-1 text-xs">{statusLabel[item.status]??item.status}</span></div>{item.notes&&<p className="text-sm">{item.notes}</p>}{admin&&<select aria-label={`Status ${item.name}`} className="rounded-md border bg-background px-3 py-2 text-sm" value={item.status} onChange={e=>changeStatus(item,e.target.value)}>{Object.entries(statusLabel).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>}</article>)}</div>
 {!q.data?.length&&<p className="rounded-xl border p-6 text-center text-muted-foreground">Nenhum campeonato cadastrado nesta quadra.</p>}
 </div>
}
