-- Preserve saved teams once an event is closed for evaluation.
-- Existing algorithms, authorization and persistence are unchanged.
CREATE OR REPLACE FUNCTION public.add_player_to_event_team(_event_id uuid, _team_id uuid, _player_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ev public.events;
begin
  ev:=public._lock_event(_event_id);
  if ev.status<>'scheduled' then raise exception 'Evento encerrado ou cancelado; não é possível alterar os times'; end if;
  if not public.is_group_admin(ev.group_id) then raise exception 'Somente o administrador pode adicionar jogadores aos times'; end if;
  if not exists(select 1 from public.event_teams where id=_team_id and event_id=_event_id and venue_id=ev.venue_id) then raise exception 'Time não pertence a este evento'; end if;
  if not exists(select 1 from public.players where id=_player_id and group_id=ev.group_id and venue_id=ev.venue_id) then raise exception 'Jogador não pertence a esta quadra'; end if;
  insert into public.attendances(event_id,group_id,player_id,status,confirmed_at,attended,updated_by)
    values(_event_id,ev.group_id,_player_id,'confirmed',now(),true,auth.uid())
    on conflict(event_id,player_id) do update set status='confirmed',attended=true,updated_by=auth.uid();
  insert into public.event_team_players(event_id,team_id,player_id,group_id,venue_id,assigned_by)
    values(_event_id,_team_id,_player_id,ev.group_id,ev.venue_id,auth.uid())
    on conflict(event_id,player_id) do update set team_id=excluded.team_id,assigned_by=auth.uid();
end $function$;

CREATE OR REPLACE FUNCTION public.create_player_for_event_team(_event_id uuid, _team_id uuid, _name text, _email text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ev public.events; pid uuid; em text:=nullif(lower(trim(_email)),'');
begin
  ev:=public._lock_event(_event_id);
  if ev.status<>'scheduled' then raise exception 'Evento encerrado ou cancelado; não é possível alterar os times'; end if;
  if not public.is_group_admin(ev.group_id) then raise exception 'Somente o administrador pode incluir jogadores manualmente'; end if;
  if not exists(select 1 from public.event_teams where id=_team_id and event_id=_event_id and venue_id=ev.venue_id) then raise exception 'Time não pertence a esta quadra'; end if;
  if length(trim(_name))<2 then raise exception 'Informe o nome do jogador'; end if;
  if em is not null and exists(select 1 from public.players where venue_id=ev.venue_id and lower(email)=em) then raise exception 'Já existe jogador com este e-mail nesta quadra'; end if;
  insert into public.players(group_id,venue_id,name,email,participation_type,is_monthly,status,joined_at)
    values(ev.group_id,ev.venue_id,trim(_name),em,'avulso',false,'active',current_date) returning id into pid;
  insert into public.attendances(event_id,group_id,player_id,status,confirmed_at,attended,updated_by)
    values(_event_id,ev.group_id,pid,'confirmed',now(),true,auth.uid());
  insert into public.event_team_players(event_id,team_id,player_id,group_id,venue_id,assigned_by)
    values(_event_id,_team_id,pid,ev.group_id,ev.venue_id,auth.uid());
  insert into public.audit_logs(group_id,actor_id,action,entity,entity_id,details)
    values(ev.group_id,auth.uid(),'player.created_for_event','player',pid,jsonb_build_object('event_id',_event_id,'venue_id',ev.venue_id));
  return pid;
end $function$;

CREATE OR REPLACE FUNCTION public.generate_event_teams(_event_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  ev public.events;
  assigned_count int := 0;
  team_no int;
  slot_no int;
  team_id uuid;
  player_id uuid;
  player_position text;
  assigned_players uuid[] := '{}';
  team_positions text[];
begin
  ev := public._lock_event(_event_id);
  if ev.status<>'scheduled' then raise exception 'Evento encerrado ou cancelado; não é possível alterar os times'; end if;
  if not public.is_group_admin(ev.group_id) then
    raise exception 'Somente o administrador pode tirar os times';
  end if;
  if ev.status='cancelled' then raise exception 'Evento cancelado'; end if;

  delete from public.event_teams where event_id=_event_id;
  insert into public.event_teams(event_id,group_id,venue_id,name,created_by)
    select _event_id,ev.group_id,ev.venue_id,'Time '||g,auth.uid()
    from generate_series(1,ev.teams_count) g;

  -- Team-first assignment: with 15 players, 3 teams and 6 per team,
  -- the result is 6, 6 and 3 instead of spreading them 5, 5 and 5.
  for team_no in 1..ev.teams_count loop
    select t.id into team_id
      from public.event_teams t
      where t.event_id=_event_id and t.name='Time '||team_no;
    team_positions := '{}';

    for slot_no in 1..ev.players_per_team loop
      -- Prefer a random player whose position is not already represented.
      select p.id,p.position into player_id,player_position
        from public.attendances a
        join public.players p on p.id=a.player_id
        where a.event_id=_event_id and p.group_id=ev.group_id and p.venue_id=ev.venue_id
          and a.status='confirmed' and a.attended is distinct from false
          and not (p.id=any(assigned_players))
          and (p.position is null or not (p.position=any(team_positions)))
        order by random()
        limit 1;

      -- If every remaining position is already represented, fill the slot anyway.
      if not found then
        select p.id,p.position into player_id,player_position
          from public.attendances a
          join public.players p on p.id=a.player_id
          where a.event_id=_event_id and p.group_id=ev.group_id and p.venue_id=ev.venue_id
            and a.status='confirmed' and a.attended is distinct from false
            and not (p.id=any(assigned_players))
          order by random()
          limit 1;
      end if;
      if not found then exit; end if;

      insert into public.event_team_players(event_id,team_id,player_id,group_id,venue_id,assigned_by)
        values(_event_id,team_id,player_id,ev.group_id,ev.venue_id,auth.uid());
      assigned_players := array_append(assigned_players,player_id);
      if player_position is not null then
        team_positions := array_append(team_positions,player_position);
      end if;
      assigned_count := assigned_count+1;
    end loop;
  end loop;

  insert into public.audit_logs(group_id,actor_id,action,entity,entity_id,details)
    values(ev.group_id,auth.uid(),'teams.generated','event',_event_id,
      jsonb_build_object('venue_id',ev.venue_id,'players',assigned_count,'randomized',true));
  return assigned_count;
end $function$;
