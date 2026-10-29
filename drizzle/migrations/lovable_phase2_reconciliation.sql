-- Pelada Manager: reconciliação revisada das migrations 0006 e 0007.
-- Cole o arquivo inteiro no SQL Editor do Lovable e execute uma única vez.
-- O bloco é transacional: qualquer erro desfaz todas as alterações.
-- Esta execução também registra os hashes das migrations no diário Drizzle.

begin;

do $$
begin
  if to_regclass('drizzle.__drizzle_migrations') is null then
    raise exception 'Não encontrei drizzle.__drizzle_migrations; pare aqui e peça uma revisão do histórico antes de executar.';
  end if;
  if exists (select 1 from drizzle.__drizzle_migrations where created_at in (1792627200000,1793050000000)) then
    raise exception 'Já existe registro para 0006 ou 0007. Não execute novamente; verifique o histórico primeiro.';
  end if;
end $$;
-- Make a venue (court) the scope for its roster and events while preserving
-- the existing group as the permissions and membership boundary.
insert into public.venues(group_id, name, address, created_by)
select g.id, g.name, gs.location, g.created_by
from public.groups g
left join public.group_settings gs on gs.group_id = g.id
where not exists (select 1 from public.venues v where v.group_id = g.id);

alter table public.venues add column if not exists city text;
alter table public.venues add column if not exists neighborhood text;
alter table public.venues add column if not exists habitual_weekday smallint check (habitual_weekday is null or habitual_weekday between 0 and 6);
alter table public.venues add column if not exists habitual_time time;

-- Add every target column before inspecting or backfilling legacy data.
alter table public.players add column if not exists venue_id uuid references public.venues(id) on delete restrict;
alter table public.event_series add column if not exists venue_id uuid references public.venues(id) on delete restrict;
alter table public.events add column if not exists venue_id uuid references public.venues(id) on delete restrict;
alter table public.group_invites add column if not exists venue_id uuid references public.venues(id) on delete cascade;
alter table public.group_join_requests add column if not exists venue_id uuid references public.venues(id) on delete cascade;
alter table public.group_join_requests alter column invite_id drop not null;
alter table public.group_join_requests add column if not exists dominant_foot text check (dominant_foot is null or dominant_foot in ('direito','esquerdo','ambos'));
alter table public.group_join_requests add column if not exists position text;
alter table public.group_join_requests add column if not exists secondary_positions text[] not null default '{}';
-- Abort instead of assigning records to an arbitrary court when legacy data is ambiguous.
do $$
begin
  if exists (
    select 1 from public.players p
    where p.venue_id is null and (select count(*) from public.venues v where v.group_id=p.group_id) <> 1
  ) then raise exception 'Migration 0006 stopped: a player has zero or multiple courts in its group; resolve the court assignment first.'; end if;
  if exists (
    select 1 from public.events e where e.venue_id is null and (
      (select count(*) from public.venues v where v.group_id=e.group_id and lower(coalesce(v.address,''))=lower(coalesce(e.location,''))) > 1
      or ((select count(*) from public.venues v where v.group_id=e.group_id and lower(coalesce(v.address,''))=lower(coalesce(e.location,''))) = 0
          and (select count(*) from public.venues v where v.group_id=e.group_id) <> 1)
    )
  ) then raise exception 'Migration 0006 stopped: an event has ambiguous court data; resolve its court before migration.'; end if;
  if exists (
    select 1 from public.event_series s where s.venue_id is null and (
      (select count(distinct e.venue_id) from public.events e where e.series_id=s.id and e.venue_id is not null) > 1
      or ((select count(distinct e.venue_id) from public.events e where e.series_id=s.id and e.venue_id is not null) = 0
          and (select count(*) from public.venues v where v.group_id=s.group_id) <> 1)
    )
  ) then raise exception 'Migration 0006 stopped: an event series has ambiguous court data; resolve it before migration.'; end if;
  if exists (
    select 1 from public.group_invites i left join public.players p on p.id=i.player_id
    where i.venue_id is null and (
      (i.player_id is not null and (p.id is null or p.group_id<>i.group_id or (p.venue_id is null and (select count(*) from public.venues v where v.group_id=i.group_id)<>1)))
      or (i.player_id is null and (select count(*) from public.venues v where v.group_id=i.group_id) <> 1)
    )
  ) then raise exception 'Migration 0006 stopped: an invite cannot be mapped unambiguously to its court.'; end if;
  if exists (
    select 1 from public.group_join_requests r left join public.group_invites i on i.id=r.invite_id
    where r.venue_id is null and (
      (r.invite_id is not null and (i.id is null or i.group_id<>r.group_id or (i.venue_id is null and (select count(*) from public.venues v where v.group_id=r.group_id)<>1)))
      or (r.invite_id is null and (select count(*) from public.venues v where v.group_id=r.group_id) <> 1)
    )
  ) then raise exception 'Migration 0006 stopped: a membership request has no unambiguous court mapping.'; end if;
end $$;
update public.players p set venue_id = (
  select id from public.venues where group_id=p.group_id order by created_at, id limit 1
) where p.venue_id is null;
update public.events e set venue_id = coalesce(
  (select v.id from public.venues v where v.group_id=e.group_id and lower(coalesce(v.address,''))=lower(coalesce(e.location,'')) order by v.created_at limit 1),
  (select v.id from public.venues v where v.group_id=e.group_id order by v.created_at limit 1)
) where e.venue_id is null;
update public.event_series s set venue_id = coalesce(
  (select e.venue_id from public.events e where e.series_id=s.id and e.venue_id is not null order by e.starts_at limit 1),
  (select v.id from public.venues v where v.group_id=s.group_id order by v.created_at limit 1)
) where s.venue_id is null;
update public.group_invites i set venue_id=coalesce(
 (select p.venue_id from public.players p where p.id=i.player_id),
 (select v.id from public.venues v where v.group_id=i.group_id order by v.created_at limit 1)
) where i.venue_id is null;
update public.group_join_requests r set venue_id=i.venue_id from public.group_invites i where i.id=r.invite_id and r.venue_id is null;
update public.group_join_requests r set venue_id=(select v.id from public.venues v where v.group_id=r.group_id) where r.venue_id is null and (select count(*) from public.venues v where v.group_id=r.group_id)=1;

alter table public.players alter column venue_id set not null;
alter table public.events alter column venue_id set not null;
alter table public.event_series alter column venue_id set not null;
alter table public.group_join_requests alter column venue_id set not null;
create index players_venue_name_idx on public.players(venue_id, name);
create index events_venue_start_idx on public.events(venue_id, starts_at);
drop index if exists public.group_join_requests_one_pending_user_idx;
create unique index group_join_requests_one_pending_user_idx on public.group_join_requests(venue_id,user_id) where status='pending';
create or replace function public.get_public_court(_venue_id uuid)
returns table(id uuid,name text,address text,city text,neighborhood text)
language sql stable security definer set search_path=public as $$
  select v.id,v.name,v.address,v.city,v.neighborhood from public.venues v where v.id=_venue_id and v.is_active
$$;
revoke execute on function public.get_public_court(uuid) from public;
grant execute on function public.get_public_court(uuid) to anon,authenticated;

create or replace function public.request_court_membership(_venue_id uuid,_dominant_foot text,_position text,_secondary_positions text[] default '{}') returns uuid
language plpgsql security definer set search_path=public as $$
declare v public.venues; prof public.profiles; uemail text; pname text; reqid uuid;
begin
  if auth.uid() is null then raise exception 'Entre ou crie uma conta antes de solicitar participação'; end if;
  select * into v from public.venues where id=_venue_id and is_active;
  if not found then raise exception 'Esta quadra não está disponível'; end if;
  select * into prof from public.profiles where id=auth.uid();
  if not found or nullif(trim(prof.full_name),'') is null or prof.age is null or nullif(trim(prof.address),'') is null or nullif(trim(prof.city),'') is null or nullif(trim(prof.neighborhood),'') is null then
    raise exception 'Complete seu perfil antes de solicitar participação';
  end if;
  if _dominant_foot is null or _dominant_foot not in ('direito','esquerdo','ambos') then raise exception 'Selecione seu pé dominante'; end if;
  if _position is null or _position not in ('Goleiro','Zagueiro','Lateral','Volante','Meia','Ponta','Atacante') then raise exception 'Selecione sua posição principal'; end if;
  if exists(select 1 from unnest(coalesce(_secondary_positions,'{}')) x where x not in ('Goleiro','Zagueiro','Lateral','Volante','Meia','Ponta','Atacante')) then raise exception 'Posição secundária inválida'; end if;
  if exists(select 1 from public.players where venue_id=v.id and user_id=auth.uid()) then raise exception 'Você já participa desta quadra'; end if;
  select id into reqid from public.group_join_requests where venue_id=v.id and user_id=auth.uid() and status='pending' limit 1;
  if reqid is not null then return reqid; end if;
  select email into uemail from auth.users where id=auth.uid();
  pname:=trim(prof.full_name);
  insert into public.group_join_requests(group_id,venue_id,invite_id,user_id,court_name,name,email,dominant_foot,position,secondary_positions)
    values(v.group_id,v.id,null,auth.uid(),v.name,pname,lower(uemail),_dominant_foot,_position,coalesce(_secondary_positions,'{}')) returning id into reqid;
  insert into public.audit_logs(group_id,actor_id,action,entity,entity_id,details)
    values(v.group_id,auth.uid(),'join.requested','join_request',reqid,jsonb_build_object('venue_id',v.id,'position',_position));
  return reqid;
end $$;
revoke execute on function public.request_court_membership(uuid,text,text,text[]) from public,anon;
grant execute on function public.request_court_membership(uuid,text,text,text[]) to authenticated;

create or replace function public.validate_court_scope() returns trigger
language plpgsql set search_path=public as $$
begin
  if not exists (select 1 from public.venues v where v.id=new.venue_id and v.group_id=new.group_id) then
    raise exception 'A quadra selecionada não pertence a este grupo';
  end if;
  return new;
end $$;
create trigger trg_players_court_scope before insert or update of group_id,venue_id on public.players
for each row execute function public.validate_court_scope();
create trigger trg_events_court_scope before insert or update of group_id,venue_id on public.events
for each row execute function public.validate_court_scope();
create trigger trg_series_court_scope before insert or update of group_id,venue_id on public.event_series
for each row execute function public.validate_court_scope();

create or replace function public.validate_team_player_scope() returns trigger
language plpgsql set search_path=public as $$
begin
  if not exists(select 1 from public.event_teams t join public.events e on e.id=t.event_id
    join public.players p on p.id=new.player_id where t.id=new.team_id and t.event_id=new.event_id
    and t.venue_id=new.venue_id and e.venue_id=new.venue_id and p.venue_id=new.venue_id
    and t.group_id=new.group_id and p.group_id=new.group_id) then
    raise exception 'Time, evento e jogador devem pertencer à mesma quadra';
  end if;
  return new;
end $$;

-- Keep the existing group creator flow working with the new required venue_id.
create or replace function public.create_group(_name text, _as_player boolean default true) returns uuid
language plpgsql security definer set search_path=public as $$
declare gid uuid; pid uuid; pname text; prof public.profiles;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if length(trim(_name))<2 then raise exception 'Nome da quadra inválido'; end if;
  select * into prof from public.profiles where id=auth.uid() for update;
  if not found or nullif(trim(prof.full_name),'') is null or prof.age is null or nullif(trim(prof.address),'') is null or nullif(trim(prof.city),'') is null or nullif(trim(prof.neighborhood),'') is null then
    raise exception 'Complete idade, endereço, cidade e bairro no seu perfil antes de criar uma quadra';
  end if;
  insert into public.groups(name,created_by) values(trim(_name),auth.uid()) returning id into gid;
  insert into public.group_members(group_id,user_id,role) values(gid,auth.uid(),'admin');
  insert into public.group_settings(group_id) values(gid);
  insert into public.venues(group_id,name,address,city,neighborhood,created_by)
    values(gid,trim(_name),trim(prof.address),trim(prof.city),trim(prof.neighborhood),auth.uid()) returning id into pid;
  if _as_player then
    insert into public.players(group_id,venue_id,user_id,name,email)
      values(gid,pid,auth.uid(),coalesce(nullif(trim(prof.full_name),''),'Administrador'),(select lower(email) from auth.users where id=auth.uid()));
  end if;
  insert into public.audit_logs(group_id,actor_id,action,entity,entity_id)
    values(gid,auth.uid(),'group.created','group',gid);
  return gid;
end $$;
revoke execute on function public.create_group(text,boolean) from public,anon,authenticated;

create or replace function public.create_court(_name text,_address text,_weekday smallint,_time time) returns uuid
language plpgsql security definer set search_path=public as $$
declare gid uuid;
begin
  if nullif(trim(_address),'') is null then raise exception 'Informe o endereço da quadra'; end if;
  if _weekday is null or _weekday not between 0 and 6 then raise exception 'Dia da semana inválido'; end if;
  if _time is null then raise exception 'Informe o horário de uso'; end if;
  gid:=public.create_group(_name,true);
  update public.group_settings set default_weekday=_weekday,default_time=_time,location=trim(_address) where group_id=gid;
  update public.venues set address=trim(_address),habitual_weekday=_weekday,habitual_time=_time where group_id=gid;
  return gid;
end $$;
revoke execute on function public.create_court(text,text,smallint,time) from public,anon;
grant execute on function public.create_court(text,text,smallint,time) to authenticated;

create or replace function public.is_court_member(_venue_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.venues v where v.id=_venue_id and (
    public.is_group_admin(v.group_id) or exists(select 1 from public.players p where p.venue_id=v.id and p.user_id=auth.uid())
  ))
$$;
revoke execute on function public.is_court_member(uuid) from public,anon;
grant execute on function public.is_court_member(uuid) to authenticated;

drop policy if exists "group members read venues" on public.venues;
create policy "court members read venues" on public.venues for select to authenticated using (public.is_court_member(id));
drop policy if exists "members read players" on public.players;
create policy "court members read players" on public.players for select to authenticated using (public.is_court_member(venue_id));
drop policy if exists "members read events" on public.events;
create policy "court members read events" on public.events for select to authenticated using (public.is_court_member(venue_id));
drop policy if exists "members read series" on public.event_series;
create policy "court members read series" on public.event_series for select to authenticated using (public.is_court_member(venue_id));
drop policy if exists "members read attendances" on public.attendances;
create policy "court members read attendances" on public.attendances for select to authenticated using (
  exists(select 1 from public.events e where e.id=event_id and public.is_court_member(e.venue_id))
);
drop policy if exists "members read att history" on public.attendance_history;
create policy "court members read att history" on public.attendance_history for select to authenticated using (
  exists(select 1 from public.attendances a join public.events e on e.id=a.event_id where a.id=attendance_id and public.is_court_member(e.venue_id))
);
drop policy if exists "group members read player photos" on storage.objects;
create policy "court members read player photos" on storage.objects for select to authenticated using (
  bucket_id='player-photos' and exists(select 1 from public.players p
    where p.id::text=(storage.foldername(name))[2] and p.group_id=((storage.foldername(name))[1])::uuid
      and public.is_court_member(p.venue_id))
);
drop policy if exists "managers or self upload player photos" on storage.objects;
create policy "court managers or self upload player photos" on storage.objects for insert to authenticated with check (
  bucket_id='player-photos' and exists(select 1 from public.players p where p.id::text=(storage.foldername(name))[2]
    and p.group_id=((storage.foldername(name))[1])::uuid and
    (public.has_group_permission(p.group_id,'players') or p.user_id=auth.uid()))
);
drop policy if exists "managers or self update player photos" on storage.objects;
create policy "court managers or self update player photos" on storage.objects for update to authenticated using (
  bucket_id='player-photos' and exists(select 1 from public.players p where p.id::text=(storage.foldername(name))[2]
    and p.group_id=((storage.foldername(name))[1])::uuid and
    (public.has_group_permission(p.group_id,'players') or p.user_id=auth.uid()))
) with check (
  bucket_id='player-photos' and exists(select 1 from public.players p where p.id::text=(storage.foldername(name))[2]
    and p.group_id=((storage.foldername(name))[1])::uuid and
    (public.has_group_permission(p.group_id,'players') or p.user_id=auth.uid()))
);
drop policy if exists "managers delete player photos" on storage.objects;
create policy "court managers delete player photos" on storage.objects for delete to authenticated using (
  bucket_id='player-photos' and exists(select 1 from public.players p where p.id::text=(storage.foldername(name))[2]
    and p.group_id=((storage.foldername(name))[1])::uuid and public.has_group_permission(p.group_id,'players'))
);

create or replace function public._resolve_player(_ev public.events, _player_id uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare pid uuid;
begin
  if _player_id is null then
    select id into pid from public.players where group_id=_ev.group_id and venue_id=_ev.venue_id and user_id=auth.uid();
    if pid is null then raise exception 'Você não tem cadastro de jogador nesta quadra'; end if;
    return pid;
  end if;
  if not exists(select 1 from public.players where id=_player_id and group_id=_ev.group_id and venue_id=_ev.venue_id) then
    raise exception 'Jogador não pertence a esta quadra';
  end if;
  if not exists(select 1 from public.players where id=_player_id and user_id=auth.uid())
     and not public.has_group_permission(_ev.group_id,'events') then raise exception 'Sem permissão'; end if;
  return _player_id;
end $$;

create or replace function public.create_invite(
  _group_id uuid, _email text, _role public.group_role default 'player', _player_id uuid default null
) returns text language plpgsql security definer set search_path=public as $$
declare t text; p public.players; em text:=lower(trim(_email));
begin
  if not public.has_group_permission(_group_id,'members') and not public.has_group_permission(_group_id,'players') then raise exception 'Sem permissão'; end if;
  if _role<>'player' then raise exception 'Convites individuais só podem incluir jogadores'; end if;
  if em is null or em='' or position('@' in em)<2 then raise exception 'E-mail inválido'; end if;
  if _player_id is null then raise exception 'Selecione o cadastro do jogador e sua quadra antes de convidar'; end if;
  select * into p from public.players where id=_player_id and group_id=_group_id for update;
  if not found then raise exception 'Jogador não encontrado nesta quadra'; end if;
  if p.user_id is not null then raise exception 'Este jogador já tem conta vinculada'; end if;
  if p.email is not null and lower(p.email)<>em then raise exception 'O e-mail não corresponde ao cadastro deste jogador'; end if;
  update public.players set email=em where id=p.id and email is null;
  update public.group_invites set revoked_at=now() where player_id=p.id and accepted_at is null and revoked_at is null;
  if exists(select 1 from public.group_members gm join auth.users u on u.id=gm.user_id where gm.group_id=_group_id and lower(u.email)=em) then
    raise exception 'Este e-mail já participa do grupo';
  end if;
  insert into public.group_invites(group_id,venue_id,email,role,invited_by,player_id)
    values(_group_id,p.venue_id,em,'player',auth.uid(),_player_id) returning token into t;
  insert into public.audit_logs(group_id,actor_id,action,entity,entity_id,details)
    values(_group_id,auth.uid(),'invite.created','player',_player_id,jsonb_build_object('venue_id',p.venue_id,'email',em));
  return t;
end $$;

create or replace function public.accept_invite(_token text) returns uuid
language plpgsql security definer set search_path=public as $$
declare inv public.group_invites; uemail text; pname text; p public.players; prof public.profiles;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  select * into inv from public.group_invites where token=_token for update;
  if not found then raise exception 'Convite inválido'; end if;
  if inv.role<>'player' then raise exception 'Este convite não pode conceder privilégios'; end if;
  if inv.revoked_at is not null then raise exception 'Convite revogado'; end if;
  if inv.accepted_at is not null then raise exception 'Convite já utilizado'; end if;
  if inv.expires_at<now() then raise exception 'Convite expirado'; end if;
  select email into uemail from auth.users where id=auth.uid();
  if lower(uemail)<>inv.email then raise exception 'Este convite foi enviado para outro e-mail'; end if;
  select * into prof from public.profiles where id=auth.uid();
  if not found or nullif(trim(prof.full_name),'') is null or prof.age is null or nullif(trim(prof.address),'') is null or nullif(trim(prof.city),'') is null or nullif(trim(prof.neighborhood),'') is null then
    raise exception 'Complete seu perfil antes de solicitar entrada';
  end if;
  if inv.player_id is not null then
    select * into p from public.players where id=inv.player_id and group_id=inv.group_id and venue_id=inv.venue_id for update;
    if not found then raise exception 'Jogador do convite não existe mais'; end if;
    if p.user_id is not null and p.user_id<>auth.uid() then raise exception 'Este jogador já está vinculado a outra conta'; end if;
    if p.email is not null and lower(p.email)<>lower(uemail) then raise exception 'O convite não corresponde ao e-mail deste jogador'; end if;
  end if;
  if exists(select 1 from public.players where group_id=inv.group_id and venue_id=inv.venue_id and user_id=auth.uid()) then raise exception 'Sua conta já participa desta quadra'; end if;
  pname:=coalesce(nullif(trim(prof.full_name),''),split_part(uemail,'@',1));
  insert into public.group_join_requests(group_id,venue_id,invite_id,user_id,player_id,court_name,name,email)
    values(inv.group_id,inv.venue_id,inv.id,auth.uid(),inv.player_id,(select name from public.venues where id=inv.venue_id),pname,lower(uemail));
  update public.group_invites set accepted_at=now() where id=inv.id;
  insert into public.audit_logs(group_id,actor_id,action,entity,entity_id,details)
    values(inv.group_id,auth.uid(),'join.requested','join_request',inv.id,jsonb_build_object('player_id',inv.player_id,'venue_id',inv.venue_id));
  return inv.group_id;
end $$;

create or replace function public.review_join_request(_request_id uuid,_approve boolean) returns uuid
language plpgsql security definer set search_path=public as $$
declare req public.group_join_requests; p public.players; gid uuid;
begin
  select * into req from public.group_join_requests where id=_request_id for update;
  if not found then raise exception 'Solicitação não encontrada'; end if;
  if not public.is_group_admin(req.group_id) then raise exception 'Somente o administrador da quadra pode aprovar'; end if;
  if req.status<>'pending' then raise exception 'Esta solicitação já foi analisada'; end if;
  gid:=req.group_id;
  if not _approve then
    update public.group_join_requests set status='rejected',decided_at=now(),decided_by=auth.uid() where id=req.id;
    insert into public.audit_logs(group_id,actor_id,action,entity,entity_id) values(gid,auth.uid(),'join.rejected','join_request',req.id);
    return gid;
  end if;
  if exists(select 1 from public.players where group_id=gid and venue_id=req.venue_id and user_id=req.user_id and id is distinct from req.player_id) then raise exception 'Esta conta já pertence à quadra'; end if;
  if exists(select 1 from public.players where group_id=gid and venue_id=req.venue_id and user_id=req.user_id and id is distinct from req.player_id) then raise exception 'Esta conta já está vinculada a outro jogador'; end if;
  if req.player_id is not null then
    select * into p from public.players where id=req.player_id and group_id=gid and venue_id=req.venue_id for update;
    if not found then raise exception 'Cadastro do jogador não existe mais'; end if;
    if p.user_id is not null and p.user_id<>req.user_id then raise exception 'Este jogador está vinculado a outra conta'; end if;
    if p.email is not null and lower(p.email)<>lower(req.email) then raise exception 'O e-mail do cadastro foi alterado; valide antes de aprovar'; end if;
    update public.players set user_id=req.user_id,
      dominant_foot=coalesce(dominant_foot,req.dominant_foot),
      position=coalesce(position,req.position),
      secondary_positions=case when cardinality(secondary_positions)=0 then req.secondary_positions else secondary_positions end
      where id=p.id;
  else
    select * into p from public.players where group_id=gid and venue_id=req.venue_id and lower(email)=lower(req.email) for update;
    if found then
      if p.user_id is not null and p.user_id<>req.user_id then raise exception 'Este jogador está vinculado a outra conta'; end if;
      update public.players set user_id=req.user_id,
        dominant_foot=coalesce(dominant_foot,req.dominant_foot),
        position=coalesce(position,req.position),
        secondary_positions=case when cardinality(secondary_positions)=0 then req.secondary_positions else secondary_positions end
        where id=p.id;
    else
      insert into public.players(group_id,venue_id,user_id,name,email,dominant_foot,position,secondary_positions)
        values(gid,req.venue_id,req.user_id,req.name,req.email,req.dominant_foot,req.position,req.secondary_positions) returning * into p;
    end if;
  end if;
  insert into public.group_members(group_id,user_id,role) values(gid,req.user_id,'player') on conflict(group_id,user_id) do nothing;
  update public.group_join_requests set status='approved',decided_at=now(),decided_by=auth.uid() where id=req.id;
  insert into public.audit_logs(group_id,actor_id,action,entity,entity_id,details)
    values(gid,auth.uid(),'join.approved','player',p.id,jsonb_build_object('request_id',req.id,'venue_id',req.venue_id));
  return gid;
end $$;

create or replace function public.admin_promote(_event_id uuid, _player_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare ev public.events;
begin
  ev := public._lock_event(_event_id);
  if not public.has_group_permission(ev.group_id,'events') then raise exception 'Sem permissão'; end if;
  if ev.status<>'scheduled' then raise exception 'Não é possível alterar participantes de um evento encerrado'; end if;
  if not exists(select 1 from public.players where id=_player_id and group_id=ev.group_id and venue_id=ev.venue_id) then raise exception 'Jogador não pertence a esta quadra'; end if;
  perform 1 from public.attendances where event_id=_event_id and player_id=_player_id for update;
  update public.attendances set status='confirmed',confirmed_at=now(),cancelled_at=null,offer_expires_at=null,updated_by=auth.uid()
    where event_id=_event_id and player_id=_player_id;
  if not found then insert into public.attendances(event_id,group_id,player_id,status,confirmed_at,updated_by)
    values (_event_id,ev.group_id,_player_id,'confirmed',now(),auth.uid()); end if;
  insert into public.audit_logs(group_id,actor_id,action,entity,entity_id,details)
    values (ev.group_id,auth.uid(),'attendance.promoted','event',_event_id,jsonb_build_object('player_id',_player_id,'venue_id',ev.venue_id));
end $$;

create or replace function public.admin_mark_attended(_event_id uuid, _player_id uuid, _attended boolean) returns void
language plpgsql security definer set search_path=public as $$
declare ev public.events;
begin
  ev := public._lock_event(_event_id);
  if not public.has_group_permission(ev.group_id,'events') then raise exception 'Sem permissão'; end if;
  if ev.status<>'scheduled' then raise exception 'Não é possível alterar presença de um evento encerrado'; end if;
  if not exists(select 1 from public.players where id=_player_id and group_id=ev.group_id and venue_id=ev.venue_id) then raise exception 'Jogador não pertence a esta quadra'; end if;
  insert into public.attendances(event_id,group_id,player_id,status,attended,updated_by)
    values (_event_id,ev.group_id,_player_id,'confirmed',_attended,auth.uid())
    on conflict (event_id,player_id) do update set attended=_attended,updated_by=auth.uid();
  insert into public.audit_logs(group_id,actor_id,action,entity,entity_id,details)
    values (ev.group_id,auth.uid(),'attendance.marked','event',_event_id,jsonb_build_object('player_id',_player_id,'attended',_attended));
end $$;

create or replace function public.create_event_series(_group_id uuid, _venue_id uuid, _first_date date, _occurrences int, _start_time time, _template jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
declare sid uuid; i int; d date; tz text := coalesce(_template->>'timezone','America/Sao_Paulo'); st timestamptz; dl numeric;
begin
  if not public.has_group_permission(_group_id,'events') then raise exception 'Sem permissão'; end if;
  if not exists(select 1 from public.venues where id=_venue_id and group_id=_group_id and is_active) then raise exception 'Quadra inválida ou inativa'; end if;
  if _occurrences < 1 or _occurrences > 52 then raise exception 'Quantidade de ocorrências deve ser de 1 a 52'; end if;
  insert into public.event_series(group_id,venue_id,weekday,start_time,created_by)
    values (_group_id,_venue_id,extract(dow from _first_date),_start_time,auth.uid()) returning id into sid;
  dl := nullif(_template->>'deadline_hours','')::numeric;
  for i in 0.._occurrences-1 loop
    d := _first_date + i*7; st := (d + _start_time) at time zone tz;
    insert into public.events(group_id,venue_id,series_id,title,starts_at,duration_minutes,location,max_participants,teams_count,players_per_team,goalkeepers_wanted,price,confirm_deadline,cancellation_rules,waitlist_offer_minutes,notes,created_by)
    values (_group_id,_venue_id,sid,coalesce(nullif(_template->>'title',''),'Pelada'),st,
      coalesce((_template->>'duration_minutes')::int,90),coalesce(nullif(_template->>'location',''),(select address from public.venues where id=_venue_id)),
      coalesce((_template->>'max_participants')::int,20),coalesce((_template->>'teams_count')::int,2),coalesce((_template->>'players_per_team')::int,10),
      coalesce((_template->>'goalkeepers_wanted')::int,2),nullif(_template->>'price','')::numeric,
      case when dl is not null then st-make_interval(secs=>dl*3600) end,_template->>'cancellation_rules',
      nullif(_template->>'waitlist_offer_minutes','')::int,_template->>'notes',auth.uid());
  end loop;
  insert into public.audit_logs(group_id,actor_id,action,entity,entity_id,details)
    values (_group_id,auth.uid(),'series.created','series',sid,jsonb_build_object('venue_id',_venue_id,'occurrences',_occurrences));
  return sid;
end $$;

create table public.event_teams (
 id uuid primary key default gen_random_uuid(), event_id uuid not null references public.events(id) on delete cascade,
 group_id uuid not null references public.groups(id) on delete cascade, venue_id uuid not null references public.venues(id) on delete restrict,
 name text not null, created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 unique(event_id,name)
);
create table public.event_team_players (
 event_id uuid not null references public.events(id) on delete cascade, team_id uuid not null references public.event_teams(id) on delete cascade,
 player_id uuid not null references public.players(id) on delete restrict, group_id uuid not null references public.groups(id) on delete cascade,
 venue_id uuid not null references public.venues(id) on delete restrict, assigned_by uuid references auth.users(id), created_at timestamptz not null default now(),
 primary key(event_id,player_id)
);
create trigger trg_team_player_scope before insert or update on public.event_team_players
for each row execute function public.validate_team_player_scope();
alter table public.event_teams enable row level security;
alter table public.event_team_players enable row level security;
grant select,insert,update,delete on public.event_teams,public.event_team_players to authenticated;
grant all on public.event_teams,public.event_team_players to service_role;
create policy "court members read teams" on public.event_teams for select to authenticated using (public.is_court_member(venue_id));
create policy "court admins manage teams" on public.event_teams for all to authenticated using (public.is_group_admin(group_id)) with check (public.is_group_admin(group_id));
create policy "court members read team players" on public.event_team_players for select to authenticated using (public.is_court_member(venue_id));
create policy "court admins manage team players" on public.event_team_players for all to authenticated using (public.is_group_admin(group_id)) with check (public.is_group_admin(group_id));

create or replace function public.generate_event_teams(_event_id uuid) returns int
language plpgsql security definer set search_path=public as $$
declare ev public.events; n int;
begin
  ev := public._lock_event(_event_id);
  if not public.is_group_admin(ev.group_id) then raise exception 'Somente o administrador pode tirar os times'; end if;
  if ev.status='cancelled' then raise exception 'Evento cancelado'; end if;
  delete from public.event_teams where event_id=_event_id;
  insert into public.event_teams(event_id,group_id,venue_id,name,created_by)
  select _event_id,ev.group_id,ev.venue_id,'Time '||g,auth.uid() from generate_series(1,ev.teams_count) g;
  with eligible as (
    select p.id,p.skill_level,p.goalkeeper_level,
      row_number() over(order by coalesce(p.goalkeeper_level,0) desc, coalesce(p.skill_level,5) desc, p.id) rn
    from public.attendances a join public.players p on p.id=a.player_id
    where a.event_id=_event_id and p.venue_id=ev.venue_id and a.status='confirmed' and a.attended is distinct from false
  ), placed as (
    select *, case when floor((rn-1)::numeric/ev.teams_count)::int%2=0
      then ((rn-1)%ev.teams_count)+1 else ev.teams_count-((rn-1)%ev.teams_count) end team_no from eligible
  )
  insert into public.event_team_players(event_id,team_id,player_id,group_id,venue_id,assigned_by)
  select _event_id,t.id,p.id,ev.group_id,ev.venue_id,auth.uid() from placed p join public.event_teams t on t.event_id=_event_id and t.name='Time '||p.team_no;
  get diagnostics n = row_count;
  insert into public.audit_logs(group_id,actor_id,action,entity,entity_id,details)
    values (ev.group_id,auth.uid(),'teams.generated','event',_event_id,jsonb_build_object('venue_id',ev.venue_id,'players',n));
  return n;
end $$;

create or replace function public.create_player_for_event_team(_event_id uuid,_team_id uuid,_name text,_email text default null) returns uuid
language plpgsql security definer set search_path=public as $$
declare ev public.events; pid uuid; em text:=nullif(lower(trim(_email)),'');
begin
  ev:=public._lock_event(_event_id);
  if not public.is_group_admin(ev.group_id) then raise exception 'Somente o administrador pode incluir jogadores manualmente'; end if;
  if not exists(select 1 from public.event_teams where id=_team_id and event_id=_event_id and venue_id=ev.venue_id) then raise exception 'Time não pertence a esta quadra'; end if;
  if length(trim(_name))<2 then raise exception 'Informe o nome do jogador'; end if;
  if em is not null and exists(select 1 from public.players where venue_id=ev.venue_id and lower(email)=em) then raise exception 'Já existe jogador com este e-mail nesta quadra'; end if;
  insert into public.players(group_id,venue_id,name,email,participation_type,is_monthly,status,joined_at)
    values(ev.group_id,ev.venue_id,trim(_name),em,'avulso',false,'active',current_date) returning id into pid;
  insert into public.attendances(event_id,group_id,player_id,status,confirmed_at,attended,updated_by)
    values(_event_id,ev.group_id,pid,'confirmed',now(),true,auth.uid());
  insert into public.event_team_players(event_id,team_id,player_id,group_id,venue_id,assigned_by)
    values(_event_id,_team_id,pid,ev.group_id,ev.venue_id,auth.uid());
  insert into public.audit_logs(group_id,actor_id,action,entity,entity_id,details)
    values(ev.group_id,auth.uid(),'player.created_for_event','player',pid,jsonb_build_object('event_id',_event_id,'venue_id',ev.venue_id));
  return pid;
end $$;

create or replace function public.add_player_to_event_team(_event_id uuid,_team_id uuid,_player_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare ev public.events;
begin
  ev:=public._lock_event(_event_id);
  if not public.is_group_admin(ev.group_id) then raise exception 'Somente o administrador pode adicionar jogadores aos times'; end if;
  if not exists(select 1 from public.event_teams where id=_team_id and event_id=_event_id and venue_id=ev.venue_id) then raise exception 'Time não pertence a este evento'; end if;
  if not exists(select 1 from public.players where id=_player_id and group_id=ev.group_id and venue_id=ev.venue_id) then raise exception 'Jogador não pertence a esta quadra'; end if;
  insert into public.attendances(event_id,group_id,player_id,status,confirmed_at,attended,updated_by)
    values(_event_id,ev.group_id,_player_id,'confirmed',now(),true,auth.uid())
    on conflict(event_id,player_id) do update set status='confirmed',attended=true,updated_by=auth.uid();
  insert into public.event_team_players(event_id,team_id,player_id,group_id,venue_id,assigned_by)
    values(_event_id,_team_id,_player_id,ev.group_id,ev.venue_id,auth.uid())
    on conflict(event_id,player_id) do update set team_id=excluded.team_id,assigned_by=auth.uid();
end $$;

create table public.event_player_votes (
 id uuid primary key default gen_random_uuid(), event_id uuid not null references public.events(id) on delete cascade,
 group_id uuid not null references public.groups(id) on delete cascade, venue_id uuid not null references public.venues(id) on delete restrict,
 voter_id uuid not null references public.players(id) on delete cascade, target_id uuid not null references public.players(id) on delete cascade,
 rating smallint not null check(rating between 1 and 10), comment text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(event_id,voter_id,target_id), check(voter_id<>target_id)
);
create or replace function public.validate_event_player_vote() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.events e
    join public.players voter on voter.id=new.voter_id and voter.venue_id=e.venue_id and voter.group_id=e.group_id
    join public.players target on target.id=new.target_id and target.venue_id=e.venue_id and target.group_id=e.group_id
    join public.attendances av on av.event_id=e.id and av.player_id=voter.id and av.attended=true
    join public.attendances at on at.event_id=e.id and at.player_id=target.id and at.attended=true
    where e.id=new.event_id and e.group_id=new.group_id and e.venue_id=new.venue_id and e.status='done'
      and voter.user_id=auth.uid() and voter.id<>target.id) then
    raise exception 'Só participantes presentes podem votar em outros presentes após o evento';
  end if;
  return new;
end $$;
create trigger trg_validate_event_player_vote before insert or update on public.event_player_votes
for each row execute function public.validate_event_player_vote();
alter table public.event_player_votes enable row level security;
grant select,insert,update on public.event_player_votes to authenticated;
grant all on public.event_player_votes to service_role;
create policy "court members read event votes" on public.event_player_votes for select to authenticated using (public.is_court_member(venue_id));
create policy "players vote for event peers" on public.event_player_votes for insert to authenticated with check (
 public.is_group_member(group_id) and voter_id in (select id from public.players where user_id=auth.uid() and venue_id=event_player_votes.venue_id)
 and exists(select 1 from public.events e join public.attendances av on av.event_id=e.id and av.player_id=event_player_votes.voter_id and av.attended=true
   join public.attendances at on at.event_id=e.id and at.player_id=event_player_votes.target_id and at.attended=true
   where e.id=event_player_votes.event_id and e.group_id=event_player_votes.group_id and e.venue_id=event_player_votes.venue_id and e.status='done')
);
create policy "players update own event votes" on public.event_player_votes for update to authenticated using (
 voter_id in (select id from public.players where user_id=auth.uid() and venue_id=event_player_votes.venue_id)
) with check (voter_id in (select id from public.players where user_id=auth.uid() and venue_id=event_player_votes.venue_id));
create view public.event_vote_summary with (security_invoker=true) as
 select event_id,venue_id,target_id,round(avg(rating)::numeric,2) average_rating,count(*) vote_count,
   (select count(*) from public.event_player_votes allv where allv.event_id=v.event_id) submitted_votes
 from public.event_player_votes v group by event_id,venue_id,target_id;
grant select on public.event_vote_summary to authenticated;

create table public.court_championships (
 id uuid primary key default gen_random_uuid(), group_id uuid not null references public.groups(id) on delete cascade,
 venue_id uuid not null references public.venues(id) on delete cascade, name text not null check(length(trim(name)) between 2 and 120),
 starts_on date, ends_on date, status text not null default 'planned' check(status in ('planned','active','completed','cancelled')),
 notes text, created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 check(ends_on is null or starts_on is null or ends_on>=starts_on)
);
alter table public.court_championships enable row level security;
grant select,insert,update on public.court_championships to authenticated;
grant all on public.court_championships to service_role;
create policy "court members read championships" on public.court_championships for select to authenticated using (public.is_court_member(venue_id));
create policy "court admins manage championships" on public.court_championships for all to authenticated using (public.is_group_admin(group_id)) with check (public.is_group_admin(group_id));
create trigger trg_championship_scope before insert or update of group_id,venue_id on public.court_championships
for each row execute function public.validate_court_scope();

create or replace function public.finish_event(_event_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare ev public.events;
begin
 ev:=public._lock_event(_event_id);
 if not public.is_group_admin(ev.group_id) then raise exception 'Somente o administrador pode finalizar o evento'; end if;
 if ev.status<>'scheduled' then raise exception 'Somente eventos agendados podem ser finalizados'; end if;
 if ev.starts_at + make_interval(mins=>ev.duration_minutes)>now() then raise exception 'O evento só pode ser finalizado após seu horário de término'; end if;
 update public.events set status='done' where id=_event_id;
 insert into public.audit_logs(group_id,actor_id,action,entity,entity_id,details)
   values(ev.group_id,auth.uid(),'event.finished','event',_event_id,jsonb_build_object('venue_id',ev.venue_id));
end $$;

revoke execute on function public.generate_event_teams(uuid),public.add_player_to_event_team(uuid,uuid,uuid),public.create_player_for_event_team(uuid,uuid,text,text),public.finish_event(uuid) from public,anon;
grant execute on function public.generate_event_teams(uuid),public.add_player_to_event_team(uuid,uuid,uuid),public.create_player_for_event_team(uuid,uuid,text,text),public.finish_event(uuid) to authenticated;
revoke execute on function public.create_event_series(uuid,uuid,date,int,time,jsonb) from public,anon;
grant execute on function public.create_event_series(uuid,uuid,date,int,time,jsonb) to authenticated;




-- Keep older court links usable when they contain the group UUID instead of
-- the venue UUID. Resolve the legacy form only when it maps to one active
-- court, so a group with multiple courts can never send a player to the wrong
-- one.
create or replace function public.get_public_court(_venue_id uuid)
returns table(id uuid,name text,address text,city text,neighborhood text)
language sql stable security definer set search_path=public as $$
  select v.id,v.name,v.address,v.city,v.neighborhood
  from public.venues v
  where v.is_active
    and (
      v.id=_venue_id
      or (
        v.group_id=_venue_id
        and (select count(*) from public.venues active_v where active_v.group_id=_venue_id and active_v.is_active)=1
      )
    )
  order by (v.id=_venue_id) desc
  limit 1
$$;
revoke execute on function public.get_public_court(uuid) from public;
grant execute on function public.get_public_court(uuid) to anon,authenticated;

insert into drizzle.__drizzle_migrations(hash,created_at)
values ('ae62f7172b71f9aa495f175e32e6291f9c6471f1595d9db1970b7b7fea3819d8',1792627200000),('8d5d2d6e07ccd553fb1c6137a28a156b9279388f9c0255db5d0041d0f1fe9209',1793050000000);

commit;
