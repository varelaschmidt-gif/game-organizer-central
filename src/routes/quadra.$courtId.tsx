import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { MapPin, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { myGroupsQuery, profileQuery, setActiveCourtId, setActiveGroupId } from "@/lib/groups";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route=createFileRoute("/quadra/$courtId")({component:JoinCourtPage});
const db=supabase as any;
const positions=["Goleiro","Zagueiro","Lateral","Volante","Meia","Ponta","Atacante"];

function JoinCourtPage(){
 const {courtId}=Route.useParams();const qc=useQueryClient();const [foot,setFoot]=useState("");const [position,setPosition]=useState("");const [secondary,setSecondary]=useState<string[]>([]);const [busy,setBusy]=useState(false);
 const user=useQuery({queryKey:["court-link-user"],queryFn:async()=>{const {data}=await supabase.auth.getUser();return data.user??null}});
 const court=useQuery({queryKey:["public-court",courtId],queryFn:async()=>{const {data,error}=await db.rpc("get_public_court",{_venue_id:courtId});if(error)throw error;return Array.isArray(data)?data[0]:data}});
 const profile=useQuery({...profileQuery,enabled:!!user.data});const groups=useQuery({...myGroupsQuery,enabled:!!user.data});
 const venueId=court.data?.id??courtId;
 const requests=useQuery({queryKey:["court-access",venueId,user.data?.id],enabled:!!user.data&&!!court.data,queryFn:async()=>{const {data,error}=await db.from("group_join_requests").select("id,status,created_at").eq("venue_id",venueId).eq("user_id",user.data!.id).order("created_at",{ascending:false}).limit(1);if(error)throw error;return data?.[0]??null}});
 const player=useQuery({queryKey:["court-player",venueId,user.data?.id],enabled:!!user.data&&!!court.data,queryFn:async()=>{const {data,error}=await db.from("players").select("id,group_id").eq("venue_id",venueId).eq("user_id",user.data!.id).maybeSingle();if(error)throw error;return data}});
 const membership=groups.data?.find((g:any)=>g.id===player.data?.group_id);
 const complete=!!profile.data?.full_name?.trim()&&!!profile.data?.age&&!!profile.data?.address?.trim()&&!!profile.data?.city?.trim()&&!!profile.data?.neighborhood?.trim();
 const latest=requests.data;const pending=latest?.status==="pending";const approved=!!player.data;
 async function request(e:React.FormEvent){e.preventDefault();if(!court.data)return;setBusy(true);const {error}=await db.rpc("request_court_membership",{_venue_id:venueId,_dominant_foot:foot,_position:position,_secondary_positions:secondary});setBusy(false);if(error){toast.error(error.message);return}toast.success("Solicitação enviada ao administrador da quadra");await Promise.all([qc.invalidateQueries({queryKey:["court-access",venueId]}),requests.refetch()])}
 if(court.isLoading||user.isLoading)return <main className="mx-auto max-w-xl p-6 text-muted-foreground">Carregando quadra…</main>;
 if(court.error)return <main className="mx-auto max-w-xl space-y-3 p-6"><h1 className="text-2xl font-bold">Não foi possível carregar esta quadra</h1><p className="text-muted-foreground">A conexão pública com o banco está indisponível ou a atualização do banco da fase 2.1 ainda não foi concluída. O administrador do aplicativo precisa verificar a migration 0006. Tente abrir este link novamente depois da atualização.</p><Button asChild><Link to="/">Página inicial</Link></Button></main>;
 if(!court.data)return <main className="mx-auto max-w-xl space-y-3 p-6"><h1 className="text-2xl font-bold">Link de quadra indisponível</h1><p className="text-muted-foreground">A quadra pode ter sido desativada ou o link não é válido.</p><Button asChild><Link to="/">Página inicial</Link></Button></main>;
 const c=court.data;
 return <main className="flex min-h-screen items-center justify-center bg-background px-4 py-8"><section className="w-full max-w-xl space-y-5 rounded-2xl border bg-card p-6"><div className="flex items-center gap-3"><MapPin className="h-8 w-8 text-primary"/><div><p className="text-xs uppercase text-muted-foreground">Convite permanente da quadra</p><h1 className="text-2xl font-bold">{c.name}</h1></div></div><p className="text-sm text-muted-foreground">{[c.address,c.neighborhood,c.city].filter(Boolean).join(" · ")}</p>
 {approved?<div className="space-y-3 rounded-xl border p-4"><p className="font-semibold">Você já participa desta quadra.</p><Button onClick={()=>{setActiveGroupId(player.data.group_id);setActiveCourtId(venueId);window.location.assign("/events")}}>Abrir a quadra</Button></div>
 :!user.data?<div className="space-y-3 rounded-xl border p-4"><div className="flex items-center gap-2"><Users className="h-5 w-5"/><p>Entre ou crie sua conta para solicitar participação. O administrador aprovará sua entrada.</p></div><div className="grid gap-2 sm:grid-cols-2"><Button asChild><Link to="/auth" search={{redirect:`/quadra/${courtId}`,mode:"signup"}}>Criar conta</Link></Button><Button variant="outline" asChild><Link to="/auth" search={{redirect:`/quadra/${courtId}`}}>Já tenho conta</Link></Button></div></div>
 :!complete?<div className="space-y-3 rounded-xl border p-4"><p>Complete seus dados pessoais antes de solicitar acesso.</p><Button asChild><Link to="/perfil" search={{redirect:`/quadra/${courtId}`}}>Completar perfil</Link></Button></div>
 :pending?<div className="rounded-xl border p-4"><p className="font-semibold">Solicitação enviada</p><p className="mt-1 text-sm text-muted-foreground">O administrador desta quadra recebeu seu pedido e ainda precisa aprovar sua entrada.</p></div>
 :<form onSubmit={request} className="space-y-4 rounded-xl border p-4"><div><h2 className="font-semibold">Solicitar participação</h2><p className="text-sm text-muted-foreground">Informe seus dados de jogo para o administrador avaliar seu cadastro e montar os times.</p></div><div><Label htmlFor="foot">Pé dominante</Label><select id="foot" required className="mt-1 w-full rounded-md border bg-background p-2" value={foot} onChange={e=>setFoot(e.target.value)}><option value="">Selecione</option><option value="direito">Direito</option><option value="esquerdo">Esquerdo</option><option value="ambos">Ambos</option></select></div><div><Label htmlFor="position">Posição principal</Label><select id="position" required className="mt-1 w-full rounded-md border bg-background p-2" value={position} onChange={e=>setPosition(e.target.value)}><option value="">Selecione</option>{positions.map(p=><option key={p}>{p}</option>)}</select></div><fieldset><legend className="text-sm font-medium">Posições secundárias</legend><div className="mt-2 flex flex-wrap gap-2">{positions.filter(p=>p!==position).map(p=><label key={p} className={`cursor-pointer rounded-full border px-3 py-1 text-xs ${secondary.includes(p)?"border-primary bg-primary/15 text-primary":"text-muted-foreground"}`}><input className="sr-only" type="checkbox" checked={secondary.includes(p)} onChange={e=>setSecondary(e.target.checked?[...secondary,p]:secondary.filter(x=>x!==p))}/>{p}</label>)}</div></fieldset><Button className="w-full" disabled={busy||!foot||!position}>{busy?"Enviando…":"Participar"}</Button></form>}
 {latest?.status==="rejected"&&<p className="text-sm text-muted-foreground">Sua solicitação anterior foi recusada. Você pode enviar um novo pedido.</p>}
 </section></main>
}
