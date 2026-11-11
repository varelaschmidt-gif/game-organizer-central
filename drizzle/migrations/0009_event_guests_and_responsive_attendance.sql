-- Event-only guests are real player records so they can appear in attendance
-- history and team generation, but remain clearly marked as avulso.
alter table public.players
  add column is_event_guest boolean not null default false,
  add column guest_event_id uuid references public.events(id) on delete restrict,
  add column guest_responsible_player_id uuid references public.players(id) on delete restrict;

create index players_guest_event_idx on public.players(guest_event_id) where is_event_guest;
create unique index players_guest_event_name_idx
  on public.players(guest_event_id, lower(trim(name)))
  where is_event_guest and guest_event_id is not null;

create or replace function public.validate_event_guest()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not new.is_event_guest then
    if new.guest_event_id is not null or new.guest_responsible_player_id is not null then
      raise exception 'Dados de convidado só podem existir para avulsos vinculados a um evento';
    end if;
    return new;
  end if;

  if auth.uid() is null or not public.is_group_admin(new.group_id) then
    raise exception 'Somente o administrador pode cadastrar avulsos para um evento';
  end if;
  if new.user_id is not null or new.participation_type <> 'avulso'
     or new.guest_event_id is null or new.guest_responsible_player_id is null then
    raise exception 'Cadastro de avulso incompleto';
  end if;
  if not exists (
    select 1 from public.events e
    where e.id = new.guest_event_id and e.group_id = new.group_id and e.venue_id = new.venue_id
  ) then
    raise exception 'Evento não pertence à quadra do avulso';
  end if;
  if not exists (
    select 1 from public.players responsible
    where responsible.id = new.guest_responsible_player_id
      and responsible.group_id = new.group_id and responsible.venue_id = new.venue_id
      and responsible.status = 'active' and not responsible.is_event_guest
  ) then
    raise exception 'Responsável não pertence a esta quadra ou não está ativo';
  end if;
  return new;
end;
$$;

create trigger trg_validate_event_guest
before insert or update of is_event_guest, guest_event_id, guest_responsible_player_id,
  group_id, venue_id, user_id, participation_type
on public.players
for each row execute function public.validate_event_guest();
revoke all on function public.validate_event_guest() from public, anon, authenticated;

create or replace function public.admin_add_event_guest(
  _event_id uuid,
  _name text,
  _position text,
  _responsible_player_id uuid
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ev public.events;
  guest_id uuid;
  guest_name text := trim(coalesce(_name, ''));
  attendance_status text;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  ev := public._lock_event(_event_id);
  if not public.is_group_admin(ev.group_id) then
    raise exception 'Somente o administrador da quadra pode adicionar um avulso';
  end if;
  if ev.status <> 'scheduled' then raise exception 'Este evento não está aberto'; end if;
  if length(guest_name) < 2 or length(guest_name) > 120 then
    raise exception 'Informe um nome entre 2 e 120 caracteres';
  end if;
  if _position is null or _position not in ('Goleiro','Zagueiro','Lateral','Volante','Meia','Ponta','Atacante') then
    raise exception 'Selecione uma posição válida';
  end if;
  if not exists (
    select 1 from public.players responsible
    where responsible.id = _responsible_player_id
      and responsible.group_id = ev.group_id and responsible.venue_id = ev.venue_id
      and responsible.status = 'active' and not responsible.is_event_guest
  ) then
    raise exception 'Selecione um jogador ativo desta quadra como responsável';
  end if;
  if exists (
    select 1 from public.players p
    where p.guest_event_id = ev.id and p.is_event_guest and lower(trim(p.name)) = lower(guest_name)
  ) then
    raise exception 'Já existe um avulso com esse nome neste evento';
  end if;

  insert into public.players(
    group_id, venue_id, name, position, status, is_monthly, participation_type,
    joined_at, is_event_guest, guest_event_id, guest_responsible_player_id
  ) values (
    ev.group_id, ev.venue_id, guest_name, _position, 'active', false, 'avulso',
    current_date, true, ev.id, _responsible_player_id
  ) returning id into guest_id;

  -- Reuse the event's locked, capacity-aware RSVP path; it inserts a waitlist
  -- entry when the event is full and records the normal attendance audit.
  attendance_status := public.rsvp_confirm(_event_id, guest_id);
  insert into public.audit_logs(group_id, actor_id, action, entity, entity_id, details)
    values (ev.group_id, auth.uid(), 'event.guest_added', 'event', ev.id,
      jsonb_build_object('player_id', guest_id, 'name', guest_name, 'position', _position,
        'responsible_player_id', _responsible_player_id, 'attendance_status', attendance_status,
        'venue_id', ev.venue_id));
  return attendance_status;
end;
$$;

revoke all on function public.admin_add_event_guest(uuid, text, text, uuid) from public, anon;
grant execute on function public.admin_add_event_guest(uuid, text, text, uuid) to authenticated;
