-- Player invitations are membership-only and can never grant organizer/admin roles.
create or replace function public.create_invite(
  _group_id uuid,
  _email text,
  _role public.group_role default 'player',
  _player_id uuid default null
) returns text
language plpgsql security definer set search_path=public as $$
declare
  t text;
  p public.players;
  em text := lower(trim(_email));
begin
  if not public.has_group_permission(_group_id,'members') and not public.has_group_permission(_group_id,'players') then
    raise exception 'Sem permissão';
  end if;
  if _role <> 'player' then
    raise exception 'Convites individuais só podem incluir jogadores';
  end if;
  if em is null or em = '' or position('@' in em) < 2 then
    raise exception 'E-mail inválido';
  end if;
  if _player_id is not null then
    select * into p from public.players where id=_player_id and group_id=_group_id for update;
    if not found then raise exception 'Jogador não encontrado neste grupo'; end if;
    if p.user_id is not null then raise exception 'Este jogador já tem conta vinculada'; end if;
    if p.email is not null and lower(p.email) <> em then raise exception 'O e-mail não corresponde ao cadastro deste jogador'; end if;
    update public.players set email=em where id=p.id and email is null;
    update public.group_invites set revoked_at=now()
      where player_id=p.id and accepted_at is null and revoked_at is null;
  end if;
  if exists(
    select 1 from public.group_members gm join auth.users u on u.id=gm.user_id
    where gm.group_id=_group_id and lower(u.email)=em
  ) then raise exception 'Este e-mail já participa do grupo'; end if;
  insert into public.group_invites(group_id,email,role,invited_by,player_id)
    values (_group_id,em,'player',auth.uid(),_player_id) returning token into t;
  insert into public.audit_logs(group_id,actor_id,action,entity,entity_id,details)
    values (_group_id,auth.uid(),'invite.created','player',_player_id,jsonb_build_object('email',em,'role','player'));
  return t;
end $$;

-- A pending legacy invite carrying elevated permissions must not be accepted.
create or replace function public.accept_invite(_token text) returns uuid
language plpgsql security definer set search_path=public as $$
declare inv public.group_invites; uemail text; pname text; p public.players;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  select * into inv from public.group_invites where token=_token for update;
  if not found then raise exception 'Convite inválido'; end if;
  if inv.role <> 'player' then raise exception 'Este convite não pode conceder privilégios. Peça um novo convite de jogador.'; end if;
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
  insert into public.group_members(group_id,user_id,role) values (inv.group_id,auth.uid(),'player')
    on conflict (group_id,user_id) do nothing;
  if inv.player_id is not null then
    update public.players set user_id=auth.uid() where id=inv.player_id;
  else
    select coalesce(nullif(full_name,''),split_part(uemail,'@',1)) into pname from public.profiles where id=auth.uid();
    insert into public.players(group_id,user_id,name,email) values (inv.group_id,auth.uid(),pname,lower(uemail))
      on conflict (group_id,user_id) do nothing;
  end if;
  update public.group_invites set accepted_at=now() where id=inv.id;
  insert into public.audit_logs(group_id,actor_id,action,entity,entity_id)
    values (inv.group_id,auth.uid(),'invite.accepted','player',inv.player_id);
  return inv.group_id;
end $$;

revoke execute on function public.create_invite(uuid,text,public.group_role,uuid), public.accept_invite(text) from public,anon;
grant execute on function public.create_invite(uuid,text,public.group_role,uuid), public.accept_invite(text) to authenticated;
