-- 0011 — cadastro básico do perfil e foto de conta
-- PENDENTE DE APLICAÇÃO. A migration é aditiva; mantém os dados de endereço de quadras.
-- O perfil pessoal não exige nem grava endereço, cidade ou bairro.

alter table public.profiles
  add column if not exists age smallint,
  add column if not exists position text,
  add column if not exists dominant_foot text;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.profiles'::regclass and conname='profiles_age_range_check') then
    alter table public.profiles add constraint profiles_age_range_check
      check (age is null or age between 1 and 120);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.profiles'::regclass and conname='profiles_position_check') then
    alter table public.profiles add constraint profiles_position_check
      check (position is null or position in ('Goleiro','Zagueiro','Lateral','Volante','Meia','Ponta','Atacante'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.profiles'::regclass and conname='profiles_dominant_foot_check') then
    alter table public.profiles add constraint profiles_dominant_foot_check
      check (dominant_foot is null or dominant_foot in ('direito','esquerdo','ambos'));
  end if;
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('rdq-profile-avatars','rdq-profile-avatars',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists "rdq profile avatars read" on storage.objects;
create policy "rdq profile avatars read" on storage.objects
for select to authenticated using (
  bucket_id='rdq-profile-avatars' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (
      select 1 from public.group_members viewer
      join public.group_members owner on owner.group_id=viewer.group_id
      where viewer.user_id=auth.uid()
        and owner.user_id::text=(storage.foldername(name))[1]
    )
  )
);

drop policy if exists "rdq profile avatars insert own" on storage.objects;
create policy "rdq profile avatars insert own" on storage.objects
for insert to authenticated with check (
  bucket_id='rdq-profile-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
  and cardinality(storage.foldername(name)) = 1
);

drop policy if exists "rdq profile avatars update own" on storage.objects;
create policy "rdq profile avatars update own" on storage.objects
for update to authenticated
using (
  bucket_id='rdq-profile-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
  and cardinality(storage.foldername(name)) = 1
)
with check (
  bucket_id='rdq-profile-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
  and cardinality(storage.foldername(name)) = 1
);

drop policy if exists "rdq profile avatars delete own" on storage.objects;
create policy "rdq profile avatars delete own" on storage.objects
for delete to authenticated using (
  bucket_id='rdq-profile-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
  and cardinality(storage.foldername(name)) = 1
);

-- Perfil completo agora significa nome, celular, idade, posição e pé dominante.
-- E-mail continua sendo a identidade gerenciada pelo Supabase Auth.
create or replace function public.create_group(_name text, _as_player boolean default true) returns uuid
language plpgsql security definer set search_path=public as $$
declare gid uuid; pid uuid; prof public.profiles; em text;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if not public.has_platform_role('group_creator') then raise exception 'Sem autorização para criar grupos'; end if;
  if length(trim(_name)) < 2 then raise exception 'Nome da quadra inválido'; end if;

  select * into prof from public.profiles where id=auth.uid() for update;
  select lower(email) into em from auth.users where id=auth.uid();
  if not found or nullif(trim(prof.full_name),'') is null or nullif(trim(prof.phone),'') is null
     or prof.age is null or prof.position is null or prof.dominant_foot is null or em is null then
    raise exception 'Complete nome, e-mail, celular, idade, posição e pé dominante no seu perfil antes de criar uma quadra';
  end if;

  insert into public.groups(name,created_by) values(trim(_name),auth.uid()) returning id into gid;
  insert into public.group_members(group_id,user_id,role) values(gid,auth.uid(),'admin');
  insert into public.group_settings(group_id) values(gid);
  insert into public.venues(group_id,name,address,city,neighborhood,created_by)
    values(gid,trim(_name),null,null,null,auth.uid()) returning id into pid;
  if _as_player then
    insert into public.players(group_id,venue_id,user_id,name,email,phone,position,dominant_foot)
      values(gid,pid,auth.uid(),trim(prof.full_name),em,trim(prof.phone),prof.position,prof.dominant_foot);
  end if;
  insert into public.audit_logs(group_id,actor_id,action,entity,entity_id)
    values(gid,auth.uid(),'group.created','group',gid);
  return gid;
end $$;
revoke execute on function public.create_group(text,boolean) from public,anon,authenticated;

create or replace function public.request_court_membership(
  _venue_id uuid,_dominant_foot text,_position text,_secondary_positions text[] default '{}'
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  v public.venues; prof public.profiles; uemail text; pname text; reqid uuid;
  foot text; pos text;
begin
  if auth.uid() is null then raise exception 'Entre ou crie uma conta antes de solicitar participação'; end if;
  select * into v from public.venues where id=_venue_id and is_active;
  if not found then raise exception 'Esta quadra não está disponível'; end if;
  select * into prof from public.profiles where id=auth.uid();
  select email into uemail from auth.users where id=auth.uid();
  if not found or nullif(trim(prof.full_name),'') is null or nullif(trim(prof.phone),'') is null
     or prof.age is null or prof.position is null or prof.dominant_foot is null or uemail is null then
    raise exception 'Complete nome, e-mail, celular, idade, posição e pé dominante no seu perfil';
  end if;

  foot := coalesce(nullif(_dominant_foot,''), prof.dominant_foot);
  pos := coalesce(nullif(_position,''), prof.position);
  if foot not in ('direito','esquerdo','ambos') then raise exception 'Selecione seu pé dominante'; end if;
  if pos not in ('Goleiro','Zagueiro','Lateral','Volante','Meia','Ponta','Atacante') then raise exception 'Selecione sua posição principal'; end if;
  if exists(select 1 from unnest(coalesce(_secondary_positions,'{}')) x where x not in ('Goleiro','Zagueiro','Lateral','Volante','Meia','Ponta','Atacante')) then
    raise exception 'Posição secundária inválida';
  end if;
  if exists(select 1 from public.players where venue_id=v.id and user_id=auth.uid()) then
    raise exception 'Você já participa desta quadra';
  end if;
  select id into reqid from public.group_join_requests where venue_id=v.id and user_id=auth.uid() and status='pending' limit 1;
  if reqid is not null then return reqid; end if;

  pname := trim(prof.full_name);
  insert into public.group_join_requests(group_id,venue_id,invite_id,user_id,court_name,name,email,dominant_foot,position,secondary_positions)
    values(v.group_id,v.id,null,auth.uid(),v.name,pname,lower(uemail),foot,pos,coalesce(_secondary_positions,'{}')) returning id into reqid;
  insert into public.audit_logs(group_id,actor_id,action,entity,entity_id,details)
    values(v.group_id,auth.uid(),'join.requested','join_request',reqid,jsonb_build_object('venue_id',v.id,'position',pos));
  return reqid;
end $$;
revoke execute on function public.request_court_membership(uuid,text,text,text[]) from public,anon;
grant execute on function public.request_court_membership(uuid,text,text,text[]) to authenticated;

create or replace function public.accept_invite(_token text) returns uuid
language plpgsql security definer set search_path=public as $$
declare inv public.group_invites; uemail text; pname text; prof public.profiles; reqid uuid;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  select * into inv from public.group_invites where token=_token for update;
  if not found then raise exception 'Convite inválido'; end if;
  if inv.role<>'player' then raise exception 'Este convite não pode conceder privilégios'; end if;
  if inv.revoked_at is not null then raise exception 'Convite revogado'; end if;
  if inv.accepted_at is not null then raise exception 'Convite já utilizado'; end if;
  if inv.expires_at<now() then raise exception 'Convite expirado'; end if;

  select email into uemail from auth.users where id=auth.uid();
  if uemail is null or lower(uemail)<>inv.email then raise exception 'Este convite foi enviado para outro e-mail'; end if;
  select * into prof from public.profiles where id=auth.uid();
  if not found or nullif(trim(prof.full_name),'') is null or nullif(trim(prof.phone),'') is null
     or prof.age is null or prof.position is null or prof.dominant_foot is null then
    raise exception 'Complete nome, celular, idade, posição e pé dominante no seu perfil antes de solicitar entrada';
  end if;

  if inv.player_id is not null then
    perform 1 from public.players where id=inv.player_id and group_id=inv.group_id and venue_id=inv.venue_id for update;
    if not found then raise exception 'Jogador do convite não existe mais'; end if;
    if exists(select 1 from public.players where id=inv.player_id and user_id is not null and user_id<>auth.uid()) then
      raise exception 'Este jogador já está vinculado a outra conta';
    end if;
    if exists(select 1 from public.players where id=inv.player_id and email is not null and lower(email)<>lower(uemail)) then
      raise exception 'O convite não corresponde ao e-mail deste jogador';
    end if;
  end if;
  if exists(select 1 from public.players where group_id=inv.group_id and venue_id=inv.venue_id and user_id=auth.uid()) then
    raise exception 'Sua conta já participa desta quadra';
  end if;

  pname := coalesce(nullif(trim(prof.full_name),''),split_part(uemail,'@',1));
  insert into public.group_join_requests(group_id,venue_id,invite_id,user_id,player_id,court_name,name,email,dominant_foot,position)
    values(inv.group_id,inv.venue_id,inv.id,auth.uid(),inv.player_id,
      (select name from public.venues where id=inv.venue_id),pname,lower(uemail),prof.dominant_foot,prof.position)
    returning id into reqid;
  update public.group_invites set accepted_at=now() where id=inv.id;
  insert into public.audit_logs(group_id,actor_id,action,entity,entity_id,details)
    values(inv.group_id,auth.uid(),'join.requested','join_request',reqid,jsonb_build_object('player_id',inv.player_id,'venue_id',inv.venue_id));
  return inv.group_id;
end $$;
