
create type public.group_role as enum ('admin','organizer','player');
create type public.platform_role as enum ('group_creator');

create or replace function public.touch_updated_at() returns trigger language plpgsql set search_path=public as $$
begin new.updated_at = now(); return new; end $$;

-- profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  avatar_url text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create trigger trg_profiles_updated before update on public.profiles for each row execute function public.touch_updated_at();

-- platform roles (bootstrap)
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role platform_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;
create policy "own roles readable" on public.user_roles for select to authenticated using (user_id = auth.uid());

create or replace function public.has_platform_role(_role platform_role) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.user_roles where user_id = auth.uid() and role = _role) $$;

-- groups
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, update on public.groups to authenticated;
grant all on public.groups to service_role;
alter table public.groups enable row level security;
create trigger trg_groups_updated before update on public.groups for each row execute function public.touch_updated_at();

create table public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null,
  role group_role not null default 'player',
  permissions text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, user_id)
);
grant select, update, delete on public.group_members to authenticated;
grant all on public.group_members to service_role;
alter table public.group_members enable row level security;
create trigger trg_gm_updated before update on public.group_members for each row execute function public.touch_updated_at();

-- helpers (security definer -> no recursive RLS)
create or replace function public.is_group_member(_group_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.group_members where group_id=_group_id and user_id=auth.uid()) $$;
create or replace function public.is_group_admin(_group_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.group_members where group_id=_group_id and user_id=auth.uid() and role='admin') $$;
create or replace function public.has_group_permission(_group_id uuid, _perm text) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.group_members where group_id=_group_id and user_id=auth.uid()
    and (role='admin' or (role='organizer' and _perm = any(permissions)))) $$;
create or replace function public.shares_group_with(_user_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.group_members a join public.group_members b on a.group_id=b.group_id
    where a.user_id=auth.uid() and b.user_id=_user_id) $$;

create policy "profile self or groupmate read" on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_group_with(id));
create policy "profile self insert" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "profile self update" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "members read group" on public.groups for select to authenticated using (public.is_group_member(id));
create policy "admin updates group" on public.groups for update to authenticated using (public.is_group_admin(id)) with check (public.is_group_admin(id));

create policy "members read members" on public.group_members for select to authenticated using (public.is_group_member(group_id));
create policy "admin updates members" on public.group_members for update to authenticated
  using (public.is_group_admin(group_id) and user_id <> auth.uid()) with check (public.is_group_admin(group_id));
create policy "admin removes members" on public.group_members for delete to authenticated
  using (public.is_group_admin(group_id) and user_id <> auth.uid());

-- settings
create table public.group_settings (
  group_id uuid primary key references public.groups(id) on delete cascade,
  default_weekday smallint,
  default_time time,
  location text,
  max_players integer not null default 20,
  monthly_fee numeric(10,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, update on public.group_settings to authenticated;
grant all on public.group_settings to service_role;
alter table public.group_settings enable row level security;
create trigger trg_gs_updated before update on public.group_settings for each row execute function public.touch_updated_at();
create policy "members read settings" on public.group_settings for select to authenticated using (public.is_group_member(group_id));
create policy "settings permission update" on public.group_settings for update to authenticated
  using (public.has_group_permission(group_id,'settings')) with check (public.has_group_permission(group_id,'settings'));

-- players
create table public.players (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid,
  name text not null,
  nickname text,
  phone text,
  position text,
  skill_level smallint,
  status text not null default 'active',
  is_monthly boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, user_id)
);
grant select, insert, update, delete on public.players to authenticated;
grant all on public.players to service_role;
alter table public.players enable row level security;
create trigger trg_players_updated before update on public.players for each row execute function public.touch_updated_at();
create policy "members read players" on public.players for select to authenticated using (public.is_group_member(group_id));
create policy "managers insert players" on public.players for insert to authenticated with check (public.has_group_permission(group_id,'players'));
create policy "managers or self update players" on public.players for update to authenticated
  using (public.has_group_permission(group_id,'players') or user_id = auth.uid())
  with check (public.has_group_permission(group_id,'players') or user_id = auth.uid());
create policy "managers delete players" on public.players for delete to authenticated using (public.has_group_permission(group_id,'players'));

create or replace function public.guard_player_fields() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if public.has_group_permission(old.group_id,'players') then return new; end if;
  if new.group_id <> old.group_id or new.user_id is distinct from old.user_id
     or new.skill_level is distinct from old.skill_level or new.status <> old.status
     or new.is_monthly <> old.is_monthly then
    raise exception 'Campo administrativo não pode ser alterado pelo jogador';
  end if;
  return new;
end $$;
create trigger trg_guard_player before update on public.players for each row execute function public.guard_player_fields();

-- invites
create table public.group_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  email text not null,
  token text not null unique default encode(gen_random_bytes(24),'hex'),
  role group_role not null default 'player',
  invited_by uuid not null,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
grant select, delete on public.group_invites to authenticated;
grant all on public.group_invites to service_role;
alter table public.group_invites enable row level security;
create policy "managers read invites" on public.group_invites for select to authenticated using (public.has_group_permission(group_id,'members'));
create policy "managers delete invites" on public.group_invites for delete to authenticated using (public.has_group_permission(group_id,'members'));

-- audit
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.groups(id) on delete cascade,
  actor_id uuid,
  action text not null,
  entity text,
  entity_id uuid,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
grant select on public.audit_logs to authenticated;
grant all on public.audit_logs to service_role;
alter table public.audit_logs enable row level security;
create policy "admins read audit" on public.audit_logs for select to authenticated using (public.is_group_admin(group_id));

-- profile on signup
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id, full_name) values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- RPCs
create or replace function public.create_group(_name text, _as_player boolean default true) returns uuid
language plpgsql security definer set search_path=public as $$
declare gid uuid; pname text;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if not public.has_platform_role('group_creator') then raise exception 'Sem autorização para criar grupos'; end if;
  if length(trim(_name)) < 2 then raise exception 'Nome inválido'; end if;
  insert into public.groups(name, created_by) values (trim(_name), auth.uid()) returning id into gid;
  insert into public.group_members(group_id,user_id,role) values (gid, auth.uid(), 'admin');
  insert into public.group_settings(group_id) values (gid);
  if _as_player then
    select coalesce(nullif(full_name,''),'Administrador') into pname from public.profiles where id=auth.uid();
    insert into public.players(group_id,user_id,name) values (gid, auth.uid(), pname);
  end if;
  insert into public.audit_logs(group_id,actor_id,action,entity,entity_id) values (gid,auth.uid(),'group.created','group',gid);
  return gid;
end $$;

create or replace function public.create_invite(_group_id uuid, _email text, _role group_role default 'player') returns text
language plpgsql security definer set search_path=public as $$
declare t text;
begin
  if not public.has_group_permission(_group_id,'members') then raise exception 'Sem permissão'; end if;
  if _role = 'admin' and not public.is_group_admin(_group_id) then raise exception 'Sem permissão'; end if;
  if exists(select 1 from public.group_members gm join auth.users u on u.id=gm.user_id
     where gm.group_id=_group_id and lower(u.email)=lower(trim(_email))) then
    raise exception 'Este e-mail já participa do grupo';
  end if;
  insert into public.group_invites(group_id,email,role,invited_by) values (_group_id, lower(trim(_email)), _role, auth.uid()) returning token into t;
  insert into public.audit_logs(group_id,actor_id,action,details) values (_group_id,auth.uid(),'invite.created',jsonb_build_object('email',lower(trim(_email)),'role',_role));
  return t;
end $$;

create or replace function public.get_invite(_token text) returns table(group_name text, email text, role group_role, expired boolean, accepted boolean)
language sql stable security definer set search_path=public as $$
  select g.name, i.email, i.role, i.expires_at < now(), i.accepted_at is not null
  from public.group_invites i join public.groups g on g.id=i.group_id where i.token=_token $$;

create or replace function public.accept_invite(_token text) returns uuid
language plpgsql security definer set search_path=public as $$
declare inv public.group_invites; uemail text; pname text;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  select * into inv from public.group_invites where token=_token for update;
  if not found then raise exception 'Convite inválido'; end if;
  if inv.accepted_at is not null then raise exception 'Convite já utilizado'; end if;
  if inv.expires_at < now() then raise exception 'Convite expirado'; end if;
  select email into uemail from auth.users where id=auth.uid();
  if lower(uemail) <> inv.email then raise exception 'Este convite foi enviado para outro e-mail'; end if;
  insert into public.group_members(group_id,user_id,role) values (inv.group_id, auth.uid(), inv.role) on conflict (group_id,user_id) do nothing;
  select coalesce(nullif(full_name,''), split_part(uemail,'@',1)) into pname from public.profiles where id=auth.uid();
  insert into public.players(group_id,user_id,name) values (inv.group_id, auth.uid(), pname) on conflict (group_id,user_id) do nothing;
  update public.group_invites set accepted_at=now() where id=inv.id;
  insert into public.audit_logs(group_id,actor_id,action) values (inv.group_id,auth.uid(),'invite.accepted');
  return inv.group_id;
end $$;

revoke execute on function public.create_group(text,boolean), public.create_invite(uuid,text,group_role), public.accept_invite(text), public.get_invite(text) from public, anon;
grant execute on function public.create_group(text,boolean), public.create_invite(uuid,text,group_role), public.accept_invite(text), public.get_invite(text) to authenticated;
grant execute on function public.get_invite(text) to anon;
