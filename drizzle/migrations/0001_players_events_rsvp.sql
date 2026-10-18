
-- ===== Players: new fields =====
alter table public.players
  add column email text,
  add column photo_path text,
  add column secondary_positions text[] not null default '{}',
  add column dominant_foot text,
  add column goalkeeper_level smallint,
  add column participation_type text not null default 'avulso',
  add column joined_at date not null default current_date;

create or replace function public.validate_player() returns trigger language plpgsql set search_path=public as $$
begin
  if new.status not in ('active','inactive','suspended') then raise exception 'Status inválido'; end if;
  if new.participation_type not in ('mensalista','avulso','convidado') then raise exception 'Tipo de participação inválido'; end if;
  if new.dominant_foot is not null and new.dominant_foot not in ('direito','esquerdo','ambos') then raise exception 'Pé dominante inválido'; end if;
  if new.skill_level is not null and (new.skill_level < 0 or new.skill_level > 10) then raise exception 'Nota técnica deve ser de 0 a 10'; end if;
  if new.goalkeeper_level is not null and (new.goalkeeper_level < 0 or new.goalkeeper_level > 10) then raise exception 'Nota de goleiro deve ser de 0 a 10'; end if;
  if new.email is not null then new.email = lower(trim(new.email)); if new.email = '' then new.email = null; end if; end if;
  return new;
end $$;
create trigger trg_validate_player before insert or update on public.players for each row execute function public.validate_player();
create unique index players_group_email_uniq on public.players(group_id, email) where email is not null;

create or replace function public.guard_player_fields() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if public.has_group_permission(old.group_id,'players') then return new; end if;
  if new.group_id <> old.group_id or new.user_id is distinct from old.user_id
     or new.skill_level is distinct from old.skill_level or new.goalkeeper_level is distinct from old.goalkeeper_level
     or new.status <> old.status or new.is_monthly <> old.is_monthly
     or new.participation_type <> old.participation_type or new.joined_at <> old.joined_at
     or new.email is distinct from old.email or new.name <> old.name then
    raise exception 'Campo administrativo não pode ser alterado pelo jogador';
  end if;
  return new;
end $$;

-- private admin notes (separate table so players can't read them)
create table public.player_private_notes (
  player_id uuid primary key references public.players(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  notes text not null default '',
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.player_private_notes to authenticated;
grant all on public.player_private_notes to service_role;
alter table public.player_private_notes enable row level security;
create policy "managers all notes" on public.player_private_notes for all to authenticated
  using (public.has_group_permission(group_id,'players')) with check (public.has_group_permission(group_id,'players'));
create trigger trg_notes_updated before update on public.player_private_notes for each row execute function public.touch_updated_at();

-- ===== Invites: tied to a player, revocable =====
alter table public.group_invites add column player_id uuid references public.players(id) on delete cascade,
  add column revoked_at timestamptz;

drop function public.create_invite(uuid,text,group_role);
create or replace function public.create_invite(_group_id uuid, _email text, _role group_role default 'player', _player_id uuid default null) returns text
language plpgsql security definer set search_path=public as $$
declare t text; p public.players; em text := lower(trim(_email));
begin
  if not public.has_group_permission(_group_id,'members') and not public.has_group_permission(_group_id,'players') then raise exception 'Sem permissão'; end if;
  if _role <> 'player' and not public.is_group_admin(_group_id) then raise exception 'Sem permissão'; end if;
  if _player_id is not null then
    select * into p from public.players where id=_player_id and group_id=_group_id;
    if not found then raise exception 'Jogador não encontrado neste grupo'; end if;
    if p.user_id is not null then raise exception 'Este jogador já tem conta vinculada'; end if;
    _role := 'player';
    update public.players set email = em where id = p.id and email is null;
    update public.group_invites set revoked_at = now() where player_id = p.id and accepted_at is null and revoked_at is null;
  end if;
  if exists(select 1 from public.group_members gm join auth.users u on u.id=gm.user_id
     where gm.group_id=_group_id and lower(u.email)=em) then
    raise exception 'Este e-mail já participa do grupo';
  end if;
  insert into public.group_invites(group_id,email,role,invited_by,player_id) values (_group_id, em, _role, auth.uid(), _player_id) returning token into t;
  insert into public.audit_logs(group_id,actor_id,action,entity,entity_id,details) values (_group_id,auth.uid(),'invite.created','player',_player_id,jsonb_build_object('email',em,'role',_role));
  return t;
end $$;

create or replace function public.revoke_invite(_invite_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare inv public.group_invites;
begin
  select * into inv from public.group_invites where id=_invite_id;
  if not found then raise exception 'Convite não encontrado'; end if;
  if not public.has_group_permission(inv.group_id,'members') and not public.has_group_permission(inv.group_id,'players') then raise exception 'Sem permissão'; end if;
  update public.group_invites set revoked_at = now() where id=_invite_id and accepted_at is null;
  insert into public.audit_logs(group_id,actor_id,action,entity,entity_id) values (inv.group_id,auth.uid(),'invite.revoked','invite',inv.id);
end $$;

drop function public.get_invite(text);
create or replace function public.get_invite(_token text) returns table(group_name text, email text, role group_role, expired boolean, accepted boolean, revoked boolean, player_name text)
language sql stable security definer set search_path=public as $$
  select g.name, i.email, i.role, i.expires_at < now(), i.accepted_at is not null, i.revoked_at is not null, p.name
  from public.group_invites i join public.groups g on g.id=i.group_id left join public.players p on p.id=i.player_id
  where i.token=_token $$;

create or replace function public.accept_invite(_token text) returns uuid
language plpgsql security definer set search_path=public as $$
declare inv public.group_invites; uemail text; pname text; p public.players;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  select * into inv from public.group_invites where token=_token for update;
  if not found then raise exception 'Convite inválido'; end if;
  if inv.revoked_at is not null then raise exception 'Convite revogado'; end if;
  if inv.accepted_at is not null then raise exception 'Convite já utilizado'; end if;
  if inv.expires_at < now() then raise exception 'Convite expirado'; end if;
  select email into uemail from auth.users where id=auth.uid();
  if lower(uemail) <> inv.email then raise exception 'Este convite foi enviado para outro e-mail'; end if;
  if inv.player_id is not null then
    select * into p from public.players where id=inv.player_id and group_id=inv.group_id for update;
    if not found then raise exception 'Jogador do convite não existe mais'; end if;
    if p.user_id is not null and p.user_id <> auth.uid() then raise exception 'Este jogador já está vinculado a outra conta'; end if;
    if exists(select 1 from public.players where group_id=inv.group_id and user_id=auth.uid() and id<>p.id) then
      raise exception 'Sua conta já está vinculada a outro jogador deste grupo';
    end if;
  end if;
  insert into public.group_members(group_id,user_id,role) values (inv.group_id, auth.uid(), inv.role) on conflict (group_id,user_id) do nothing;
  if inv.player_id is not null then
    update public.players set user_id = auth.uid() where id = inv.player_id;
  else
    select coalesce(nullif(full_name,''), split_part(uemail,'@',1)) into pname from public.profiles where id=auth.uid();
    insert into public.players(group_id,user_id,name,email) values (inv.group_id, auth.uid(), pname, lower(uemail)) on conflict (group_id,user_id) do nothing;
  end if;
  update public.group_invites set accepted_at=now() where id=inv.id;
  insert into public.audit_logs(group_id,actor_id,action,entity,entity_id) values (inv.group_id,auth.uid(),'invite.accepted','player',inv.player_id);
  return inv.group_id;
end $$;

-- ===== Events =====
create table public.event_series (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  weekday smallint not null,
  start_time time not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.event_series to authenticated;
grant all on public.event_series to service_role;
alter table public.event_series enable row level security;
create policy "members read series" on public.event_series for select to authenticated using (public.is_group_member(group_id));

create table public.events (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  series_id uuid references public.event_series(id) on delete set null,
  title text not null default 'Pelada',
  starts_at timestamptz not null,
  duration_minutes integer not null default 90,
  location text,
  max_participants integer not null default 20,
  teams_count integer not null default 2,
  players_per_team integer not null default 10,
  goalkeepers_wanted integer not null default 2,
  price numeric(10,2),
  confirm_deadline timestamptz,
  cancellation_rules text,
  waitlist_offer_minutes integer,
  status text not null default 'scheduled',
  notes text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index events_group_start on public.events(group_id, starts_at);
grant select, insert, update, delete on public.events to authenticated;
grant all on public.events to service_role;
alter table public.events enable row level security;
create trigger trg_events_updated before update on public.events for each row execute function public.touch_updated_at();
create policy "members read events" on public.events for select to authenticated using (public.is_group_member(group_id));
create policy "managers insert events" on public.events for insert to authenticated with check (public.has_group_permission(group_id,'events') and created_by = auth.uid());
create policy "managers update events" on public.events for update to authenticated using (public.has_group_permission(group_id,'events')) with check (public.has_group_permission(group_id,'events'));
create policy "managers delete events" on public.events for delete to authenticated using (public.has_group_permission(group_id,'events') and status <> 'done');

create or replace function public.validate_event() returns trigger language plpgsql set search_path=public as $$
begin
  if new.status not in ('scheduled','cancelled','done') then raise exception 'Status de evento inválido'; end if;
  if new.max_participants < 1 or new.teams_count < 1 or new.players_per_team < 1 or new.goalkeepers_wanted < 0 or new.duration_minutes < 1 then
    raise exception 'Valores do evento inválidos'; end if;
  if tg_op = 'UPDATE' and old.status = 'done' and auth.uid() is not null then
    raise exception 'Eventos realizados não podem ser alterados'; end if;
  return new;
end $$;
create trigger trg_validate_event before insert or update on public.events for each row execute function public.validate_event();

-- ===== Attendances =====
create table public.attendances (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  status text not null,
  waitlisted_at timestamptz,
  offer_expires_at timestamptz,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  attended boolean,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, player_id)
);
create index att_event_status on public.attendances(event_id, status);
grant select on public.attendances to authenticated;
grant all on public.attendances to service_role;
alter table public.attendances enable row level security;
create trigger trg_att_updated before update on public.attendances for each row execute function public.touch_updated_at();
create policy "members read attendances" on public.attendances for select to authenticated using (public.is_group_member(group_id));

create table public.attendance_history (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid not null references public.attendances(id) on delete cascade,
  group_id uuid not null,
  from_status text,
  to_status text not null,
  actor_id uuid,
  note text,
  created_at timestamptz not null default now()
);
grant select on public.attendance_history to authenticated;
grant all on public.attendance_history to service_role;
alter table public.attendance_history enable row level security;
create policy "members read att history" on public.attendance_history for select to authenticated using (public.is_group_member(group_id));

create or replace function public.log_attendance() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status or new.attended is distinct from old.attended then
    insert into public.attendance_history(attendance_id,group_id,from_status,to_status,actor_id,note)
    values (new.id, new.group_id, case when tg_op='UPDATE' then old.status end, new.status, auth.uid(),
      case when tg_op='UPDATE' and new.attended is distinct from old.attended then 'presença: '||coalesce(new.attended::text,'-') end);
  end if;
  return new;
end $$;
create trigger trg_log_att after insert or update on public.attendances for each row execute function public.log_attendance();

-- statuses: confirmed, waitlist, offered, cancelled, declined
-- seats taken = confirmed + offered

create or replace function public._promote_next(_event_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare ev public.events; taken int; nxt public.attendances;
begin
  select * into ev from public.events where id=_event_id;
  loop
    select count(*) into taken from public.attendances where event_id=_event_id and status in ('confirmed','offered');
    exit when taken >= ev.max_participants;
    select * into nxt from public.attendances where event_id=_event_id and status='waitlist'
      order by waitlisted_at, created_at limit 1 for update skip locked;
    exit when not found;
    if ev.waitlist_offer_minutes is null or ev.waitlist_offer_minutes <= 0 then
      update public.attendances set status='confirmed', confirmed_at=now(), offer_expires_at=null, updated_by=auth.uid() where id=nxt.id;
    else
      update public.attendances set status='offered', offer_expires_at=now() + make_interval(mins => ev.waitlist_offer_minutes), updated_by=auth.uid() where id=nxt.id;
    end if;
  end loop;
end $$;

create or replace function public._expire_offers(_event_id uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
  update public.attendances set status='declined', offer_expires_at=null, cancelled_at=now()
    where event_id=_event_id and status='offered' and offer_expires_at < now();
  perform public._promote_next(_event_id);
end $$;

create or replace function public._lock_event(_event_id uuid) returns public.events
language plpgsql security definer set search_path=public as $$
declare ev public.events;
begin
  select * into ev from public.events where id=_event_id for update;
  if not found then raise exception 'Evento não encontrado'; end if;
  if not public.is_group_member(ev.group_id) then raise exception 'Sem acesso a este evento'; end if;
  return ev;
end $$;

create or replace function public._resolve_player(_ev public.events, _player_id uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare pid uuid;
begin
  if _player_id is null then
    select id into pid from public.players where group_id=_ev.group_id and user_id=auth.uid();
    if pid is null then raise exception 'Você não tem cadastro de jogador neste grupo'; end if;
    return pid;
  end if;
  if not exists(select 1 from public.players where id=_player_id and group_id=_ev.group_id) then raise exception 'Jogador não pertence ao grupo'; end if;
  if not exists(select 1 from public.players where id=_player_id and user_id=auth.uid())
     and not public.has_group_permission(_ev.group_id,'events') then raise exception 'Sem permissão'; end if;
  return _player_id;
end $$;

create or replace function public.process_event(_event_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare ev public.events;
begin
  ev := public._lock_event(_event_id);
  perform public._expire_offers(_event_id);
end $$;

create or replace function public.rsvp_confirm(_event_id uuid, _player_id uuid default null) returns text
language plpgsql security definer set search_path=public as $$
declare ev public.events; pid uuid; cur public.attendances; taken int; is_mgr boolean; st text; pst text;
begin
  ev := public._lock_event(_event_id);
  pid := public._resolve_player(ev, _player_id);
  is_mgr := public.has_group_permission(ev.group_id,'events');
  if ev.status <> 'scheduled' then raise exception 'Este evento não está aberto'; end if;
  if not is_mgr and ev.confirm_deadline is not null and now() > ev.confirm_deadline then raise exception 'Prazo de confirmação encerrado'; end if;
  select status into pst from public.players where id=pid;
  if pst <> 'active' and not is_mgr then raise exception 'Jogador inativo ou suspenso'; end if;
  perform public._expire_offers(_event_id);
  select * into cur from public.attendances where event_id=_event_id and player_id=pid for update;
  if found and cur.status = 'confirmed' then return 'confirmed'; end if;
  if found and cur.status = 'waitlist' then return 'waitlist'; end if;
  if found and cur.status = 'offered' then
    update public.attendances set status='confirmed', confirmed_at=now(), offer_expires_at=null, updated_by=auth.uid() where id=cur.id;
    return 'confirmed';
  end if;
  select count(*) into taken from public.attendances where event_id=_event_id and status in ('confirmed','offered');
  if taken < ev.max_participants and not exists(select 1 from public.attendances where event_id=_event_id and status='waitlist') then st := 'confirmed'; else st := 'waitlist'; end if;
  if found then
    update public.attendances set status=st, confirmed_at=case when st='confirmed' then now() end,
      waitlisted_at=case when st='waitlist' then now() end, cancelled_at=null, updated_by=auth.uid() where id=cur.id;
  else
    insert into public.attendances(event_id,group_id,player_id,status,confirmed_at,waitlisted_at,updated_by)
    values (_event_id, ev.group_id, pid, st, case when st='confirmed' then now() end, case when st='waitlist' then now() end, auth.uid());
  end if;
  return st;
end $$;

create or replace function public.rsvp_cancel(_event_id uuid, _player_id uuid default null) returns void
language plpgsql security definer set search_path=public as $$
declare ev public.events; pid uuid; cur public.attendances;
begin
  ev := public._lock_event(_event_id);
  pid := public._resolve_player(ev, _player_id);
  select * into cur from public.attendances where event_id=_event_id and player_id=pid for update;
  if not found or cur.status in ('cancelled','declined') then return; end if;
  update public.attendances set status=case when cur.status='offered' then 'declined' else 'cancelled' end,
    cancelled_at=now(), offer_expires_at=null, updated_by=auth.uid() where id=cur.id;
  perform public._expire_offers(_event_id);
end $$;

create or replace function public.admin_promote(_event_id uuid, _player_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare ev public.events;
begin
  ev := public._lock_event(_event_id);
  if not public.has_group_permission(ev.group_id,'events') then raise exception 'Sem permissão'; end if;
  update public.attendances set status='confirmed', confirmed_at=now(), offer_expires_at=null, updated_by=auth.uid()
    where event_id=_event_id and player_id=_player_id and status in ('waitlist','offered','cancelled','declined');
  if not found then
    insert into public.attendances(event_id,group_id,player_id,status,confirmed_at,updated_by)
    select _event_id, ev.group_id, _player_id, 'confirmed', now(), auth.uid()
    where exists(select 1 from public.players where id=_player_id and group_id=ev.group_id)
    on conflict (event_id,player_id) do nothing;
  end if;
  insert into public.audit_logs(group_id,actor_id,action,entity,entity_id,details) values (ev.group_id,auth.uid(),'attendance.promoted','event',_event_id,jsonb_build_object('player_id',_player_id));
end $$;

create or replace function public.admin_mark_attended(_event_id uuid, _player_id uuid, _attended boolean) returns void
language plpgsql security definer set search_path=public as $$
declare ev public.events;
begin
  ev := public._lock_event(_event_id);
  if not public.has_group_permission(ev.group_id,'events') then raise exception 'Sem permissão'; end if;
  insert into public.attendances(event_id,group_id,player_id,status,attended,updated_by)
  select _event_id, ev.group_id, _player_id, 'confirmed', _attended, auth.uid()
  where exists(select 1 from public.players where id=_player_id and group_id=ev.group_id)
  on conflict (event_id,player_id) do update set attended=_attended, updated_by=auth.uid();
  insert into public.audit_logs(group_id,actor_id,action,entity,entity_id,details) values (ev.group_id,auth.uid(),'attendance.marked','event',_event_id,jsonb_build_object('player_id',_player_id,'attended',_attended));
end $$;

-- recurring series creation
create or replace function public.create_event_series(_group_id uuid, _first_date date, _occurrences int, _start_time time, _template jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
declare sid uuid; i int; d date; tz text := coalesce(_template->>'timezone','America/Sao_Paulo'); st timestamptz; dl numeric;
begin
  if not public.has_group_permission(_group_id,'events') then raise exception 'Sem permissão'; end if;
  if _occurrences < 1 or _occurrences > 52 then raise exception 'Quantidade de ocorrências deve ser de 1 a 52'; end if;
  insert into public.event_series(group_id,weekday,start_time,created_by) values (_group_id, extract(dow from _first_date), _start_time, auth.uid()) returning id into sid;
  dl := nullif(_template->>'deadline_hours','')::numeric;
  for i in 0.._occurrences-1 loop
    d := _first_date + (i*7);
    st := (d + _start_time) at time zone tz;
    insert into public.events(group_id,series_id,title,starts_at,duration_minutes,location,max_participants,teams_count,players_per_team,goalkeepers_wanted,price,confirm_deadline,cancellation_rules,waitlist_offer_minutes,notes,created_by)
    values (_group_id, sid, coalesce(nullif(_template->>'title',''),'Pelada'), st,
      coalesce((_template->>'duration_minutes')::int,90), _template->>'location',
      coalesce((_template->>'max_participants')::int,20), coalesce((_template->>'teams_count')::int,2),
      coalesce((_template->>'players_per_team')::int,10), coalesce((_template->>'goalkeepers_wanted')::int,2),
      nullif(_template->>'price','')::numeric, case when dl is not null then st - make_interval(secs => dl*3600) end,
      _template->>'cancellation_rules', nullif(_template->>'waitlist_offer_minutes','')::int, _template->>'notes', auth.uid());
  end loop;
  insert into public.audit_logs(group_id,actor_id,action,entity,entity_id,details) values (_group_id,auth.uid(),'series.created','series',sid,jsonb_build_object('occurrences',_occurrences));
  return sid;
end $$;

-- scoped edit: 'one' | 'following' | 'all'. Only future, scheduled events are touched.
create or replace function public.update_events_scoped(_event_id uuid, _scope text, _changes jsonb) returns int
language plpgsql security definer set search_path=public as $$
declare ev public.events; n int; tz text := coalesce(_changes->>'timezone','America/Sao_Paulo'); newtime time := nullif(_changes->>'start_time','')::time; dl numeric := nullif(_changes->>'deadline_hours','')::numeric;
begin
  select * into ev from public.events where id=_event_id;
  if not found then raise exception 'Evento não encontrado'; end if;
  if not public.has_group_permission(ev.group_id,'events') then raise exception 'Sem permissão'; end if;
  if ev.status = 'done' then raise exception 'Eventos realizados não podem ser alterados'; end if;
  if _scope not in ('one','following','all') then raise exception 'Escopo inválido'; end if;
  with target as (
    select e.id from public.events e
    where (e.id = _event_id)
       or (_scope <> 'one' and ev.series_id is not null and e.series_id = ev.series_id and e.status='scheduled' and e.starts_at > now()
           and (_scope='all' or e.starts_at >= ev.starts_at))
  ), upd as (
    update public.events e set
      title = coalesce(nullif(_changes->>'title',''), e.title),
      starts_at = case when newtime is not null then (((e.starts_at at time zone tz)::date) + newtime) at time zone tz else e.starts_at end,
      duration_minutes = coalesce((_changes->>'duration_minutes')::int, e.duration_minutes),
      location = case when _changes ? 'location' then _changes->>'location' else e.location end,
      max_participants = coalesce((_changes->>'max_participants')::int, e.max_participants),
      teams_count = coalesce((_changes->>'teams_count')::int, e.teams_count),
      players_per_team = coalesce((_changes->>'players_per_team')::int, e.players_per_team),
      goalkeepers_wanted = coalesce((_changes->>'goalkeepers_wanted')::int, e.goalkeepers_wanted),
      price = case when _changes ? 'price' then nullif(_changes->>'price','')::numeric else e.price end,
      cancellation_rules = case when _changes ? 'cancellation_rules' then _changes->>'cancellation_rules' else e.cancellation_rules end,
      waitlist_offer_minutes = case when _changes ? 'waitlist_offer_minutes' then nullif(_changes->>'waitlist_offer_minutes','')::int else e.waitlist_offer_minutes end,
      notes = case when _changes ? 'notes' then _changes->>'notes' else e.notes end,
      series_id = case when _scope='one' then null else e.series_id end
    from target where e.id = target.id
    returning e.id
  ) select count(*) into n from upd;
  if dl is not null then
    update public.events e set confirm_deadline = e.starts_at - make_interval(secs => dl*3600)
    where e.id = _event_id or (_scope <> 'one' and ev.series_id is not null and e.series_id = ev.series_id and e.status='scheduled' and e.starts_at > now() and (_scope='all' or e.starts_at >= ev.starts_at));
  end if;
  if _scope <> 'one' and newtime is not null and ev.series_id is not null then
    update public.event_series set start_time = newtime where id = ev.series_id;
  end if;
  -- capacity raised? fill from waitlist
  perform public._promote_next(id) from public.events where id = _event_id or (_scope <> 'one' and series_id = ev.series_id and status='scheduled' and starts_at > now());
  insert into public.audit_logs(group_id,actor_id,action,entity,entity_id,details) values (ev.group_id,auth.uid(),'event.updated','event',_event_id,jsonb_build_object('scope',_scope,'changes',_changes,'count',n));
  return n;
end $$;

revoke execute on function public._promote_next(uuid), public._expire_offers(uuid), public._lock_event(uuid), public._resolve_player(public.events,uuid) from public, anon, authenticated;
revoke execute on function public.create_invite(uuid,text,group_role,uuid), public.revoke_invite(uuid), public.accept_invite(text),
  public.process_event(uuid), public.rsvp_confirm(uuid,uuid), public.rsvp_cancel(uuid,uuid), public.admin_promote(uuid,uuid),
  public.admin_mark_attended(uuid,uuid,boolean), public.create_event_series(uuid,date,int,time,jsonb), public.update_events_scoped(uuid,text,jsonb) from public, anon;
grant execute on function public.create_invite(uuid,text,group_role,uuid), public.revoke_invite(uuid), public.accept_invite(text),
  public.process_event(uuid), public.rsvp_confirm(uuid,uuid), public.rsvp_cancel(uuid,uuid), public.admin_promote(uuid,uuid),
  public.admin_mark_attended(uuid,uuid,boolean), public.create_event_series(uuid,date,int,time,jsonb), public.update_events_scoped(uuid,text,jsonb) to authenticated;
grant execute on function public.get_invite(text) to anon, authenticated;

-- ===== Photos storage policies (bucket created separately) =====
create policy "group members read player photos" on storage.objects for select to authenticated
  using (bucket_id = 'player-photos' and public.is_group_member(((storage.foldername(name))[1])::uuid));
create policy "managers or self upload player photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'player-photos' and (
    public.has_group_permission(((storage.foldername(name))[1])::uuid,'players')
    or exists(select 1 from public.players p where p.id::text = (storage.foldername(name))[2] and p.user_id = auth.uid())));
create policy "managers or self update player photos" on storage.objects for update to authenticated
  using (bucket_id = 'player-photos' and (
    public.has_group_permission(((storage.foldername(name))[1])::uuid,'players')
    or exists(select 1 from public.players p where p.id::text = (storage.foldername(name))[2] and p.user_id = auth.uid())));
create policy "managers delete player photos" on storage.objects for delete to authenticated
  using (bucket_id = 'player-photos' and public.has_group_permission(((storage.foldername(name))[1])::uuid,'players'));
