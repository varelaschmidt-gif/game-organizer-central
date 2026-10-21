create table public.venues (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  address text,
  phone text,
  surface text,
  covered boolean not null default false,
  price_per_hour numeric(10,2) check (price_per_hour is null or price_per_hour >= 0),
  notes text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index venues_group_active_name_idx on public.venues(group_id, lower(name)) where is_active;
create index venues_group_id_idx on public.venues(group_id);

grant select, insert, update on public.venues to authenticated;
grant all on public.venues to service_role;
alter table public.venues enable row level security;
create trigger trg_venues_updated before update on public.venues
  for each row execute function public.touch_updated_at();

create policy "group members read venues" on public.venues for select to authenticated
  using (public.is_group_member(group_id));
create policy "event managers insert venues" on public.venues for insert to authenticated
  with check (public.has_group_permission(group_id, 'events') and created_by = auth.uid());
create policy "event managers update venues" on public.venues for update to authenticated
  using (public.has_group_permission(group_id, 'events'))
  with check (public.has_group_permission(group_id, 'events'));

create or replace function public.log_venue_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare gid uuid; vid uuid; action_name text;
begin
  if tg_op = 'DELETE' then gid := old.group_id; vid := old.id; action_name := 'venue.deleted';
  elsif tg_op = 'INSERT' then gid := new.group_id; vid := new.id; action_name := 'venue.created';
  else gid := new.group_id; vid := new.id; action_name := 'venue.updated'; end if;
  insert into public.audit_logs(group_id, actor_id, action, entity, entity_id, details)
  values (gid, auth.uid(), action_name, 'venue', vid,
    jsonb_build_object('name', case when tg_op = 'DELETE' then old.name else new.name end));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create trigger trg_venues_audit after insert or update or delete on public.venues
  for each row execute function public.log_venue_change();
