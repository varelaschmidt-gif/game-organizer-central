-- 0013: criação livre de quadra/grupo + até 3 administradores por grupo.
-- Aditiva. NÃO aplicada no banco remoto. Revisar antes de aplicar.

-- 1) create_group: remove só a exigência do papel global group_creator.
CREATE OR REPLACE FUNCTION public.create_group(_name text, _as_player boolean DEFAULT true)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare gid uuid; pid uuid; prof public.profiles; em text;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
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
end $function$;

-- 2) Limite de 3 admins e proteção do último admin, em qualquer caminho de escrita.
CREATE OR REPLACE FUNCTION public.guard_group_admins()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare n int; gid uuid := coalesce(NEW.group_id, OLD.group_id);
begin
  perform 1 from public.groups where id=gid for update; -- serializa por grupo
  if TG_OP in ('INSERT','UPDATE') and NEW.role='admin' and (TG_OP='INSERT' or OLD.role<>'admin') then
    select count(*) into n from public.group_members where group_id=gid and role='admin';
    if n >= 3 then raise exception 'Limite de 3 administradores por quadra atingido'; end if;
  end if;
  if (TG_OP='DELETE' and OLD.role='admin') or (TG_OP='UPDATE' and OLD.role='admin' and NEW.role<>'admin') then
    if exists(select 1 from public.groups where id=gid) then
      select count(*) into n from public.group_members where group_id=gid and role='admin' and id<>OLD.id;
      if n < 1 then raise exception 'A quadra precisa de pelo menos um administrador'; end if;
    end if;
  end if;
  return coalesce(NEW, OLD);
end $function$;

DROP TRIGGER IF EXISTS trg_gm_guard_admins ON public.group_members;
CREATE TRIGGER trg_gm_guard_admins BEFORE INSERT OR UPDATE OF role OR DELETE ON public.group_members
  FOR EACH ROW EXECUTE FUNCTION public.guard_group_admins();

-- 3) Listagem de membros para administradores.
CREATE OR REPLACE FUNCTION public.list_group_members(_group_id uuid)
 RETURNS TABLE(member_id uuid, user_id uuid, full_name text, email text, role group_role, is_creator boolean)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if not public.is_group_admin(_group_id) then raise exception 'Apenas administradores'; end if;
  return query
    select gm.id, gm.user_id, coalesce(nullif(p.full_name,''), u.email::text), u.email::text, gm.role, g.created_by = gm.user_id
    from public.group_members gm
    join public.groups g on g.id=gm.group_id
    left join public.profiles p on p.id=gm.user_id
    left join auth.users u on u.id=gm.user_id
    where gm.group_id=_group_id
    order by (gm.role='admin') desc, 3;
end $function$;

-- 4) Promover/rebaixar atomicamente, com auditoria.
CREATE OR REPLACE FUNCTION public.set_group_admin(_group_id uuid, _user_id uuid, _admin boolean)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare m public.group_members; newrole group_role;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  perform 1 from public.groups where id=_group_id for update;
  if not public.is_group_admin(_group_id) then raise exception 'Apenas administradores podem alterar administradores'; end if;
  select * into m from public.group_members where group_id=_group_id and user_id=_user_id for update;
  if not found then raise exception 'Membro não encontrado nesta quadra'; end if;
  newrole := case when _admin then 'admin'::group_role else 'player'::group_role end;
  if m.role = newrole then return; end if;
  if not _admin and m.role <> 'admin' then return; end if;
  update public.group_members set role=newrole where id=m.id; -- trigger valida limite/último admin
  insert into public.audit_logs(group_id,actor_id,action,entity,entity_id,details)
    values(_group_id,auth.uid(),case when _admin then 'member.promoted_admin' else 'member.demoted_admin' end,
           'group_member',m.id,jsonb_build_object('user_id',_user_id,'from',m.role,'to',newrole));
end $function$;

REVOKE ALL ON FUNCTION public.list_group_members(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_group_admin(uuid,uuid,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guard_group_admins() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_group_members(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_group_admin(uuid,uuid,boolean) TO authenticated;
