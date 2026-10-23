-- Personal information required before a player can join or create a court group.
alter table public.profiles
  add column age smallint,
  add column address text,
  add column city text,
  add column neighborhood text;

alter table public.profiles
  add constraint profiles_age_range check (age is null or age between 1 and 120);

drop policy if exists "profile self or groupmate read" on public.profiles;
create policy "profile self read" on public.profiles for select to authenticated using (id=auth.uid());

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id, full_name, age, address, city, neighborhood)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name',''),
    nullif(new.raw_user_meta_data->>'age','')::smallint,
    nullif(trim(new.raw_user_meta_data->>'address'),''),
    nullif(trim(new.raw_user_meta_data->>'city'),''),
    nullif(trim(new.raw_user_meta_data->>'neighborhood'),'')
  );
  return new;
end $$;

-- All authenticated users can create a free group/court; its creator is the admin.
-- Require profile completion in the database as well as in the UI.
create or replace function public.create_group(_name text, _as_player boolean default true) returns uuid
language plpgsql security definer set search_path=public as $$
declare gid uuid; pname text; prof public.profiles;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if length(trim(_name)) < 2 then raise exception 'Nome da quadra inválido'; end if;
  select * into prof from public.profiles where id=auth.uid() for update;
  if not found or nullif(trim(prof.full_name),'') is null or prof.age is null or nullif(trim(prof.address),'') is null
     or nullif(trim(prof.city),'') is null or nullif(trim(prof.neighborhood),'') is null then
    raise exception 'Complete idade, endereço, cidade e bairro no seu perfil antes de criar uma quadra';
  end if;
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

revoke execute on function public.create_group(text,boolean) from authenticated;

create or replace function public.create_court(
  _name text,
  _address text,
  _weekday smallint,
  _time time
) returns uuid
language plpgsql security definer set search_path=public as $$
declare gid uuid;
begin
  if nullif(trim(_address),'') is null then raise exception 'Informe o endereço da quadra'; end if;
  if _weekday is null or _weekday not between 0 and 6 then raise exception 'Dia da semana inválido'; end if;
  if _time is null then raise exception 'Informe o horário de uso'; end if;
  gid := public.create_group(_name, true);
  update public.group_settings
    set default_weekday=_weekday, default_time=_time, location=trim(_address)
    where group_id=gid;
  insert into public.venues(group_id,name,address,created_by)
    values (gid,trim(_name),trim(_address),auth.uid());
  return gid;
end $$;
revoke execute on function public.create_court(text,text,smallint,time) from public,anon;
grant execute on function public.create_court(text,text,smallint,time) to authenticated;

-- New accounts request access through an individual invite; a court admin must approve.
create table public.group_join_requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  invite_id uuid not null unique references public.group_invites(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  player_id uuid references public.players(id) on delete set null,
  court_name text not null,
  name text not null,
  email text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users(id)
);
create index group_join_requests_pending_idx on public.group_join_requests(group_id,created_at) where status='pending';
create unique index group_join_requests_one_pending_user_idx on public.group_join_requests(group_id,user_id) where status='pending';
grant select on public.group_join_requests to authenticated;
grant all on public.group_join_requests to service_role;
alter table public.group_join_requests enable row level security;
create policy "court admins read join requests" on public.group_join_requests for select to authenticated
  using (public.is_group_admin(group_id) or user_id=auth.uid());

create or replace function public.accept_invite(_token text) returns uuid
language plpgsql security definer set search_path=public as $$
declare inv public.group_invites; uemail text; pname text; prof public.profiles; p public.players;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  select * into inv from public.group_invites where token=_token for update;
  if not found then raise exception 'Convite inválido'; end if;
  if inv.role <> 'player' then raise exception 'Este convite não pode conceder privilégios'; end if;
  if inv.revoked_at is not null then raise exception 'Convite revogado'; end if;
  if inv.accepted_at is not null then raise exception 'Convite já utilizado'; end if;
  if inv.expires_at < now() then raise exception 'Convite expirado'; end if;
  select email into uemail from auth.users where id=auth.uid();
  if lower(uemail) <> inv.email then raise exception 'Este convite foi enviado para outro e-mail'; end if;
  select * into prof from public.profiles where id=auth.uid();
  if not found or nullif(trim(prof.full_name),'') is null or prof.age is null or nullif(trim(prof.address),'') is null
     or nullif(trim(prof.city),'') is null or nullif(trim(prof.neighborhood),'') is null then
    raise exception 'Complete idade, endereço, cidade e bairro no seu perfil antes de solicitar entrada';
  end if;
  pname := coalesce(nullif(trim(prof.full_name),''),split_part(uemail,'@',1));
  if inv.player_id is not null then
    select * into p from public.players where id=inv.player_id and group_id=inv.group_id for update;
    if not found then raise exception 'Jogador do convite não existe mais'; end if;
    if p.user_id is not null and p.user_id <> auth.uid() then raise exception 'Este jogador já está vinculado a outra conta'; end if;
    if p.email is not null and lower(p.email) <> lower(uemail) then raise exception 'O convite não corresponde ao e-mail deste jogador'; end if;
  end if;
  if exists(select 1 from public.group_members where group_id=inv.group_id and user_id=auth.uid()) then
    raise exception 'Sua conta já participa desta quadra';
  end if;
  insert into public.group_join_requests(group_id,invite_id,user_id,player_id,court_name,name,email)
    values (inv.group_id,inv.id,auth.uid(),inv.player_id,(select name from public.groups where id=inv.group_id),pname,lower(uemail));
  update public.group_invites set accepted_at=now() where id=inv.id;
  insert into public.audit_logs(group_id,actor_id,action,entity,entity_id,details)
    values (inv.group_id,auth.uid(),'join.requested','join_request',inv.id,jsonb_build_object('player_id',inv.player_id));
  return inv.group_id;
end $$;

create or replace function public.review_join_request(_request_id uuid, _approve boolean) returns uuid
language plpgsql security definer set search_path=public as $$
declare req public.group_join_requests; p public.players; gid uuid;
begin
  select * into req from public.group_join_requests where id=_request_id for update;
  if not found then raise exception 'Solicitação não encontrada'; end if;
  if not public.is_group_admin(req.group_id) then raise exception 'Somente o administrador da quadra pode aprovar'; end if;
  if req.status <> 'pending' then raise exception 'Esta solicitação já foi analisada'; end if;
  gid := req.group_id;
  if not _approve then
    update public.group_join_requests set status='rejected',decided_at=now(),decided_by=auth.uid() where id=req.id;
    insert into public.audit_logs(group_id,actor_id,action,entity,entity_id,details)
      values (gid,auth.uid(),'join.rejected','join_request',req.id,jsonb_build_object('user_id',req.user_id));
    return gid;
  end if;
  if exists(select 1 from public.group_members where group_id=gid and user_id=req.user_id) then
    raise exception 'Esta conta já pertence à quadra';
  end if;
  if exists(select 1 from public.players where group_id=gid and user_id=req.user_id and id is distinct from req.player_id) then
    raise exception 'Esta conta já está vinculada a outro jogador da quadra';
  end if;
  if req.player_id is not null then
    select * into p from public.players where id=req.player_id and group_id=gid for update;
    if not found then raise exception 'Cadastro do jogador não existe mais'; end if;
    if p.user_id is not null and p.user_id <> req.user_id then raise exception 'Este jogador está vinculado a outra conta'; end if;
    if p.email is not null and lower(p.email) <> lower(req.email) then raise exception 'O e-mail do cadastro foi alterado; valide a associação antes de aprovar'; end if;
    update public.players set user_id=req.user_id where id=p.id;
  else
    select * into p from public.players where group_id=gid and lower(email)=lower(req.email) for update;
    if found then
      if p.user_id is not null and p.user_id <> req.user_id then raise exception 'Este jogador está vinculado a outra conta'; end if;
      update public.players set user_id=req.user_id where id=p.id;
    else
      insert into public.players(group_id,user_id,name,email) values (gid,req.user_id,req.name,req.email) returning * into p;
    end if;
  end if;
  insert into public.group_members(group_id,user_id,role) values (gid,req.user_id,'player');
  update public.group_join_requests set status='approved',decided_at=now(),decided_by=auth.uid() where id=req.id;
  insert into public.audit_logs(group_id,actor_id,action,entity,entity_id,details)
    values (gid,auth.uid(),'join.approved','player',p.id,jsonb_build_object('request_id',req.id,'user_id',req.user_id));
  return gid;
end $$;
revoke execute on function public.review_join_request(uuid,boolean) from public,anon;
grant execute on function public.review_join_request(uuid,boolean) to authenticated;
