-- Keep the result of the attendance lookup before later SELECT statements
-- overwrite PL/pgSQL's implicit FOUND variable.
create or replace function public.rsvp_confirm(_event_id uuid, _player_id uuid default null) returns text
language plpgsql security definer set search_path=public as $$
declare ev public.events; pid uuid; cur public.attendances; taken int; is_mgr boolean; st text; pst text; has_attendance boolean;
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
  has_attendance := found;
  if has_attendance and cur.status = 'confirmed' then return 'confirmed'; end if;
  if has_attendance and cur.status = 'waitlist' then return 'waitlist'; end if;
  if has_attendance and cur.status = 'offered' then
    update public.attendances set status='confirmed', confirmed_at=now(), offer_expires_at=null, updated_by=auth.uid() where id=cur.id;
    return 'confirmed';
  end if;
  select count(*) into taken from public.attendances where event_id=_event_id and status in ('confirmed','offered');
  if taken < ev.max_participants and not exists(select 1 from public.attendances where event_id=_event_id and status='waitlist') then st := 'confirmed'; else st := 'waitlist'; end if;
  if has_attendance then
    update public.attendances set status=st, confirmed_at=case when st='confirmed' then now() end,
      waitlisted_at=case when st='waitlist' then now() end, cancelled_at=null, updated_by=auth.uid() where id=cur.id;
  else
    insert into public.attendances(event_id,group_id,player_id,status,confirmed_at,waitlisted_at,updated_by)
    values (_event_id, ev.group_id, pid, st, case when st='confirmed' then now() end, case when st='waitlist' then now() end, auth.uid());
  end if;
  return st;
end $$;

revoke execute on function public.rsvp_confirm(uuid,uuid) from public, anon;
grant execute on function public.rsvp_confirm(uuid,uuid) to authenticated;

-- An individual invite must match the email already recorded for its player.
create or replace function public.create_invite(_group_id uuid, _email text, _role group_role default 'player', _player_id uuid default null) returns text
language plpgsql security definer set search_path=public as $$
declare t text; p public.players; em text := lower(trim(_email));
begin
  if not public.has_group_permission(_group_id,'members') and not public.has_group_permission(_group_id,'players') then raise exception 'Sem permissão'; end if;
  if em is null or em = '' or position('@' in em) < 2 then raise exception 'E-mail inválido'; end if;
  if _role <> 'player' and not public.is_group_admin(_group_id) then raise exception 'Sem permissão'; end if;
  if _player_id is not null then
    select * into p from public.players where id=_player_id and group_id=_group_id;
    if not found then raise exception 'Jogador não encontrado neste grupo'; end if;
    if p.user_id is not null then raise exception 'Este jogador já tem conta vinculada'; end if;
    if p.email is not null and lower(p.email) <> em then raise exception 'O e-mail não corresponde ao cadastro deste jogador'; end if;
    _role := 'player';
    update public.players set email = em where id = p.id and email is null;
    update public.group_invites set revoked_at = now() where player_id = p.id and accepted_at is null and revoked_at is null;
  end if;
  if exists(select 1 from public.group_members gm join auth.users u on u.id=gm.user_id where gm.group_id=_group_id and lower(u.email)=em) then
    raise exception 'Este e-mail já participa do grupo';
  end if;
  insert into public.group_invites(group_id,email,role,invited_by,player_id) values (_group_id, em, _role, auth.uid(), _player_id) returning token into t;
  insert into public.audit_logs(group_id,actor_id,action,entity,entity_id,details) values (_group_id,auth.uid(),'invite.created','player',_player_id,jsonb_build_object('email',em,'role',_role));
  return t;
end $$;
revoke execute on function public.create_invite(uuid,text,group_role,uuid) from public, anon;
grant execute on function public.create_invite(uuid,text,group_role,uuid) to authenticated;

-- Manual promotions still share the event row lock and cannot exceed capacity.
create or replace function public.admin_promote(_event_id uuid, _player_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare ev public.events; taken int; current_status text;
begin
  ev := public._lock_event(_event_id);
  if not public.has_group_permission(ev.group_id,'events') then raise exception 'Sem permissão'; end if;
  if ev.status <> 'scheduled' then raise exception 'Este evento não está aberto'; end if;
  if not exists(select 1 from public.players where id=_player_id and group_id=ev.group_id) then raise exception 'Jogador não pertence ao grupo'; end if;
  select status into current_status from public.attendances where event_id=_event_id and player_id=_player_id for update;
  select count(*) into taken from public.attendances where event_id=_event_id and status in ('confirmed','offered');
  if coalesce(current_status,'') not in ('confirmed','offered') and taken >= ev.max_participants then raise exception 'Não há vagas disponíveis'; end if;
  update public.attendances set status='confirmed', confirmed_at=now(), offer_expires_at=null, updated_by=auth.uid()
    where event_id=_event_id and player_id=_player_id and status in ('waitlist','offered','cancelled','declined');
  if not found then
    insert into public.attendances(event_id,group_id,player_id,status,confirmed_at,updated_by)
    values (_event_id,ev.group_id,_player_id,'confirmed',now(),auth.uid()) on conflict (event_id,player_id) do nothing;
    if not found then raise exception 'Jogador já possui uma confirmação'; end if;
  end if;
  insert into public.audit_logs(group_id,actor_id,action,entity,entity_id,details) values (ev.group_id,auth.uid(),'attendance.promoted','event',_event_id,jsonb_build_object('player_id',_player_id));
end $$;
revoke execute on function public.admin_promote(uuid,uuid) from public, anon;
grant execute on function public.admin_promote(uuid,uuid) to authenticated;

drop policy if exists "managers read invites" on public.group_invites;
create policy "managers read invites" on public.group_invites for select to authenticated
  using (public.has_group_permission(group_id,'members') or public.has_group_permission(group_id,'players'));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('player-photos','player-photos',false,5242880,array['image/jpeg','image/png','image/webp','image/avif'])
on conflict (id) do nothing;
