-- Randomize eligible attendees while avoiding repeated positions within a team.
-- Fill each team to the configured size before starting the next one.

create or replace function public.generate_event_teams(_event_id uuid) returns int
language plpgsql security definer set search_path=public as $$
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
end $$;

revoke execute on function public.generate_event_teams(uuid) from public,anon;
grant execute on function public.generate_event_teams(uuid) to authenticated;
notify pgrst, 'reload schema';
