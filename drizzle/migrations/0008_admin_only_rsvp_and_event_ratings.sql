create or replace function public._resolve_player(_ev public.events, _player_id uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
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
     and not public.is_group_admin(_ev.group_id) then raise exception 'Somente o administrador pode alterar a presença de outro jogador'; end if;
  return _player_id;
end $$;

create or replace function public.rsvp_confirm(_event_id uuid, _player_id uuid default null)
returns text language plpgsql security definer set search_path to 'public' as $$
declare ev public.events; pid uuid; cur public.attendances; taken int; is_adm boolean; st text; pst text; has_attendance boolean; on_behalf boolean;
begin
  ev := public._lock_event(_event_id);
  pid := public._resolve_player(ev, _player_id);
  is_adm := public.is_group_admin(ev.group_id);
  on_behalf := not exists(select 1 from public.players where id=pid and user_id=auth.uid());
  if ev.status <> 'scheduled' then raise exception 'Este evento não está aberto'; end if;
  if not is_adm and ev.confirm_deadline is not null and now() > ev.confirm_deadline then raise exception 'Prazo de confirmação encerrado'; end if;
  select status into pst from public.players where id=pid;
  if pst <> 'active' and not is_adm then raise exception 'Jogador inativo ou suspenso'; end if;
  perform public._expire_offers(_event_id);
  select * into cur from public.attendances where event_id=_event_id and player_id=pid for update;
  has_attendance := found;
  if has_attendance and cur.status in ('confirmed','waitlist') then return cur.status; end if;
  if has_attendance and cur.status = 'offered' then
    update public.attendances set status='confirmed', confirmed_at=now(), offer_expires_at=null, updated_by=auth.uid() where id=cur.id;
    st := 'confirmed';
  else
    select count(*) into taken from public.attendances where event_id=_event_id and status in ('confirmed','offered');
    if taken < ev.max_participants and not exists(select 1 from public.attendances where event_id=_event_id and status in ('waitlist')) then st := 'confirmed'; else st := 'waitlist'; end if;
    if has_attendance then
      update public.attendances set status=st, confirmed_at=case when st='confirmed' then now() end,
        waitlisted_at=case when st='waitlist' then now() end, cancelled_at=null, updated_by=auth.uid() where id=cur.id;
    else
      insert into public.attendances(event_id,group_id,player_id,status,confirmed_at,waitlisted_at,updated_by)
      values (_event_id, ev.group_id, pid, st, case when st='confirmed' then now() end, case when st='waitlist' then now() end, auth.uid());
    end if;
  end if;
  if on_behalf then
    insert into public.audit_logs(group_id,actor_id,action,entity,entity_id,details)
      values (ev.group_id,auth.uid(),'attendance.admin_added','event',_event_id,jsonb_build_object('player_id',pid,'venue_id',ev.venue_id,'status',st));
  end if;
  return st;
end $$;

create or replace function public.rsvp_cancel(_event_id uuid, _player_id uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare ev public.events; pid uuid; cur public.attendances;
begin
  ev := public._lock_event(_event_id);
  pid := public._resolve_player(ev, _player_id);
  if ev.status <> 'scheduled' then raise exception 'Este evento não está aberto'; end if;
  select * into cur from public.attendances where event_id=_event_id and player_id=pid for update;
  if not found or cur.status in ('cancelled','declined') then return; end if;
  update public.attendances set status=case when cur.status='offered' then 'declined' else 'cancelled' end,
    cancelled_at=now(), offer_expires_at=null, updated_by=auth.uid() where id=cur.id;
  if not exists(select 1 from public.players where id=pid and user_id=auth.uid()) then
    insert into public.audit_logs(group_id,actor_id,action,entity,entity_id,details)
      values (ev.group_id,auth.uid(),'attendance.admin_cancelled','event',_event_id,jsonb_build_object('player_id',pid,'venue_id',ev.venue_id));
  end if;
  perform public._expire_offers(_event_id);
end $$;

create or replace function public.admin_promote(_event_id uuid, _player_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare ev public.events; cur public.attendances; taken int;
begin
  ev := public._lock_event(_event_id);
  if not public.is_group_admin(ev.group_id) then raise exception 'Somente o administrador pode promover jogadores'; end if;
  if ev.status<>'scheduled' then raise exception 'Não é possível alterar participantes de um evento encerrado'; end if;
  if not exists(select 1 from public.players where id=_player_id and group_id=ev.group_id and venue_id=ev.venue_id) then raise exception 'Jogador não pertence a esta quadra'; end if;
  perform public._expire_offers(_event_id);
  select * into cur from public.attendances where event_id=_event_id and player_id=_player_id for update;
  if found and cur.status='confirmed' then return; end if;
  select count(*) into taken from public.attendances where event_id=_event_id and status in ('confirmed','offered') and player_id<>_player_id;
  if taken >= ev.max_participants then raise exception 'Evento lotado: libere uma vaga antes de promover'; end if;
  if found then
    update public.attendances set status='confirmed',confirmed_at=now(),cancelled_at=null,offer_expires_at=null,updated_by=auth.uid() where id=cur.id;
  else
    insert into public.attendances(event_id,group_id,player_id,status,confirmed_at,updated_by) values (_event_id,ev.group_id,_player_id,'confirmed',now(),auth.uid());
  end if;
  insert into public.audit_logs(group_id,actor_id,action,entity,entity_id,details)
    values (ev.group_id,auth.uid(),'attendance.promoted','event',_event_id,jsonb_build_object('player_id',_player_id,'venue_id',ev.venue_id));
end $$;

create or replace function public.admin_mark_attended(_event_id uuid, _player_id uuid, _attended boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
declare ev public.events;
begin
  ev := public._lock_event(_event_id);
  if not public.is_group_admin(ev.group_id) then raise exception 'Somente o administrador pode registrar presença'; end if;
  if ev.status<>'scheduled' then raise exception 'Não é possível alterar presença de um evento encerrado'; end if;
  if not exists(select 1 from public.players where id=_player_id and group_id=ev.group_id and venue_id=ev.venue_id) then raise exception 'Jogador não pertence a esta quadra'; end if;
  update public.attendances set attended=_attended,updated_by=auth.uid() where event_id=_event_id and player_id=_player_id and status='confirmed';
  if not found then raise exception 'Somente jogadores confirmados podem ter presença registrada'; end if;
  insert into public.audit_logs(group_id,actor_id,action,entity,entity_id,details)
    values (ev.group_id,auth.uid(),'attendance.marked','event',_event_id,jsonb_build_object('player_id',_player_id,'attended',_attended));
end $$;

-- Ratings (admin-only, 1-5 stars, one per player per event, only one 5-star per event)
create table if not exists public.event_player_ratings (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  venue_id uuid not null references public.venues(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  rated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, player_id)
);
create unique index if not exists event_player_ratings_one_five_star on public.event_player_ratings(event_id) where rating = 5;
create index if not exists event_player_ratings_venue_player on public.event_player_ratings(venue_id, player_id);
grant select on public.event_player_ratings to authenticated;
grant all on public.event_player_ratings to service_role;
alter table public.event_player_ratings enable row level security;
drop policy if exists "court members read ratings" on public.event_player_ratings;
create policy "court members read ratings" on public.event_player_ratings for select to authenticated
  using (public.is_group_admin(group_id) or public.is_court_member(venue_id));

create or replace function public.set_player_rating(_event_id uuid, _player_id uuid, _rating smallint)
returns void language plpgsql security definer set search_path to 'public' as $$
declare ev public.events; old_rating smallint;
begin
  ev := public._lock_event(_event_id);
  if not public.is_group_admin(ev.group_id) then raise exception 'Somente o administrador pode avaliar jogadores'; end if;
  if ev.status<>'done' then raise exception 'A avaliação só é liberada após a finalização do evento'; end if;
  if _rating is null or _rating not between 1 and 5 then raise exception 'A nota deve ser de 1 a 5 estrelas'; end if;
  if not exists(select 1 from public.attendances a join public.players p on p.id=a.player_id
    where a.event_id=_event_id and a.player_id=_player_id and a.attended=true and p.venue_id=ev.venue_id and p.group_id=ev.group_id) then
    raise exception 'Só jogadores com presença registrada podem ser avaliados';
  end if;
  if _rating=5 and exists(select 1 from public.event_player_ratings where event_id=_event_id and rating=5 and player_id<>_player_id) then
    raise exception 'Somente um jogador pode receber cinco estrelas neste evento';
  end if;
  select rating into old_rating from public.event_player_ratings where event_id=_event_id and player_id=_player_id;
  insert into public.event_player_ratings(event_id,group_id,venue_id,player_id,rating,rated_by)
    values(_event_id,ev.group_id,ev.venue_id,_player_id,_rating,auth.uid())
    on conflict(event_id,player_id) do update set rating=excluded.rating,rated_by=auth.uid(),updated_at=now();
  insert into public.audit_logs(group_id,actor_id,action,entity,entity_id,details)
    values(ev.group_id,auth.uid(),case when old_rating is null then 'rating.set' else 'rating.changed' end,'event',_event_id,
      jsonb_build_object('player_id',_player_id,'venue_id',ev.venue_id,'from',old_rating,'to',_rating));
end $$;

create or replace function public.remove_player_rating(_event_id uuid, _player_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare ev public.events; old_rating smallint;
begin
  ev := public._lock_event(_event_id);
  if not public.is_group_admin(ev.group_id) then raise exception 'Somente o administrador pode remover notas'; end if;
  delete from public.event_player_ratings where event_id=_event_id and player_id=_player_id returning rating into old_rating;
  if old_rating is not null then
    insert into public.audit_logs(group_id,actor_id,action,entity,entity_id,details)
      values(ev.group_id,auth.uid(),'rating.removed','event',_event_id,jsonb_build_object('player_id',_player_id,'venue_id',ev.venue_id,'from',old_rating));
  end if;
end $$;

create or replace function public.get_court_rating_averages(_venue_id uuid)
returns table(player_id uuid, average numeric, ratings_count bigint)
language sql stable security definer set search_path to 'public' as $$
  select r.player_id, round(avg(r.rating)::numeric,2), count(*)
  from public.event_player_ratings r
  where r.venue_id=_venue_id and public.is_court_member(_venue_id)
  group by r.player_id $$;

-- Peer voting disabled for now (old votes preserved)
create or replace function public.validate_event_player_vote()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  raise exception 'A votação entre jogadores está desativada no momento';
end $$;
comment on table public.event_player_votes is 'DEPRECATED (temporarily): peer voting disabled; replaced by event_player_ratings. Historical rows preserved.';