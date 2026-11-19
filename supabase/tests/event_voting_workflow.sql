-- Independent Supabase test copy only. No persistent fixtures.
begin;
create function pg_temp.check_voting(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'TEST FAILED: %',label; end if; end $$;
create function pg_temp.reject_voting(q text,pattern text) returns void language plpgsql as $$
begin
  begin execute q;
  exception when others then if sqlerrm ilike '%'||pattern||'%' then return; end if;
    raise exception 'Wrong rejection: %, expected %',sqlerrm,pattern;
  end;
  raise exception 'TEST FAILED: expected rejection %',pattern;
end $$;
do $$
declare
  adm uuid:=gen_random_uuid(); member_id uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
  grp uuid:=gen_random_uuid(); other_grp uuid:=gen_random_uuid(); court uuid:=gen_random_uuid(); other_court uuid:=gen_random_uuid();
  p1 uuid:=gen_random_uuid(); p2 uuid:=gen_random_uuid(); p3 uuid:=gen_random_uuid(); absent_id uuid:=gen_random_uuid(); waiting_id uuid:=gen_random_uuid(); foreign_id uuid:=gen_random_uuid();
  ev uuid:=gen_random_uuid(); open_ev uuid:=gen_random_uuid(); cancelled_ev uuid:=gen_random_uuid();
  present_ids uuid[]; team_ids uuid[]; old_ratings jsonb; fresh_ratings jsonb;
begin
  insert into auth.users(id,email) values(adm,adm||'@voting-test.invalid'),(member_id,member_id||'@voting-test.invalid'),(outsider,outsider||'@voting-test.invalid');
  insert into public.groups(id,name,created_by) values(grp,'Voting workflow fixture A',adm),(other_grp,'Voting workflow fixture B',outsider);
  insert into public.group_members(group_id,user_id,role) values(grp,adm,'admin'),(grp,member_id,'player'),(other_grp,outsider,'admin');
  insert into public.venues(id,group_id,name) values(court,grp,'Voting workflow fixture A'),(other_court,other_grp,'Voting workflow fixture B');
  insert into public.players(id,venue_id,group_id,user_id,name,status)
    values(p1,court,grp,member_id,'Craque','active'),(p2,court,grp,null,'Pereba','active'),(p3,court,grp,null,'Default three','active'),
      (absent_id,court,grp,null,'Absent','active'),(waiting_id,court,grp,null,'Waiting','active'),(foreign_id,other_court,other_grp,outsider,'Foreign','active');
  insert into public.events(id,venue_id,group_id,title,starts_at,max_participants,teams_count,players_per_team,status,created_by)
    values(ev,court,grp,'Voting workflow future',now()+interval '2 days',20,2,6,'scheduled',adm),
      (open_ev,court,grp,'Voting workflow open',now()+interval '2 days',20,2,6,'scheduled',adm),
      (cancelled_ev,court,grp,'Voting workflow cancelled',now()+interval '2 days',20,2,6,'cancelled',adm);
  insert into public.attendances(event_id,group_id,player_id,status,attended)
    values(ev,grp,p1,'confirmed',true),(ev,grp,p2,'confirmed',null),(ev,grp,p3,'confirmed',null),
      (ev,grp,absent_id,'confirmed',false),(ev,grp,waiting_id,'waitlist',null);
  present_ids:=array(select x from unnest(array[p1,p2,p3]) x order by x);
  perform set_config('request.jwt.claim.sub',adm::text,true);
  execute 'set local role authenticated';
  perform pg_temp.reject_voting(format('select public.start_event_voting(%L,%L::uuid[])',ev,present_ids),'Tire os times');
  perform pg_temp.check_voting((select status='scheduled' from public.events where id=ev),'failed start does not close event');
  perform public.generate_event_teams(ev);
  select array_agg(id order by id) into team_ids from public.event_teams where event_id=ev;
  perform pg_temp.reject_voting(format('select public.start_event_voting(%L,%L::uuid[])',ev,array[p1]),'dois presentes');
  perform pg_temp.reject_voting(format('select public.start_event_voting(%L,%L::uuid[])',ev,array[p1,p1]),'repetidos');
  perform pg_temp.reject_voting(format('select public.start_event_voting(%L,%L::uuid[])',ev,array[p1,waiting_id]),'confirmados');
  perform pg_temp.reject_voting(format('select public.start_event_voting(%L,%L::uuid[])',ev,array[p1,foreign_id]),'confirmados');
  perform pg_temp.reject_voting(format('select public.start_event_voting(%L,%L::uuid[])',cancelled_ev,present_ids),'cancelado');
  perform pg_temp.reject_voting(format('select public.complete_event_voting(%L,%L,%L,%L::uuid[],%L::jsonb)',open_ev,p1,p2,present_ids,'[]'),'Inicie');
  perform public.start_event_voting(ev,present_ids);
  perform pg_temp.check_voting((select status='done' from public.events where id=ev),'start closes even before scheduled end');
  perform pg_temp.check_voting((select count(*)=3 from public.attendances where event_id=ev and status='confirmed' and attended is true),'selected attendance confirmed');
  perform pg_temp.check_voting((select attended is false from public.attendances where event_id=ev and player_id=absent_id),'absence retained');
  perform pg_temp.check_voting((select status='waitlist' and attended is null from public.attendances where event_id=ev and player_id=waiting_id),'waitlist unchanged');
  perform pg_temp.check_voting((select array_agg(id order by id)=team_ids from public.event_teams where event_id=ev),'saved teams preserved');
  perform pg_temp.reject_voting(format('select public.generate_event_teams(%L)',ev),'Evento encerrado');
  perform pg_temp.reject_voting(format('select public.add_player_to_event_team(%L,%L,%L)',ev,team_ids[1],p1),'Evento encerrado');
  perform pg_temp.reject_voting(format('select public.create_player_for_event_team(%L,%L,%L)',ev,team_ids[1],'Late player'),'Evento encerrado');
  perform pg_temp.check_voting((select count(*)=0 from public.event_player_ratings where event_id=ev),'start does not save votes');
  perform public.start_event_voting(ev,present_ids);
  perform pg_temp.check_voting((select count(*)=1 from public.audit_logs where entity_id=ev and action='event.voting_started'),'start replay is idempotent');
  perform pg_temp.reject_voting(format('select public.start_event_voting(%L,%L::uuid[])',ev,array[p1,p2]),'já encerrado');
  perform pg_temp.reject_voting(format('select public.complete_event_voting(%L,%L,%L,%L::uuid[],%L::jsonb)',ev,p1,p1,present_ids,'[]'),'diferentes');
  perform pg_temp.reject_voting(format('select public.complete_event_voting(%L,%L,%L,%L::uuid[],%L::jsonb)',ev,p1,absent_id,present_ids,'[]'),'presentes neste evento');
  perform pg_temp.reject_voting(format('select public.complete_event_voting(%L,%L,%L,%L::uuid[],%L::jsonb)',ev,p1,foreign_id,present_ids,'[]'),'presentes neste evento');
  perform pg_temp.reject_voting(format('select public.complete_event_voting(%L,%L,%L,%L::uuid[],%L::jsonb)',ev,p1,p2,array[p1,p2],'[]'),'lista de presentes foi alterada');
  perform public.set_player_rating(ev,p1,5::smallint);
  perform public.set_player_rating(ev,p2,1::smallint);
  perform public.set_player_rating(ev,p3,4::smallint);
  perform pg_temp.reject_voting(format('select public.set_player_rating(%L,%L,1::smallint)',ev,p3),'uma estrela');
  perform pg_temp.reject_voting(format('select public.set_player_rating(%L,%L,5::smallint)',ev,p3),'cinco estrelas');
  select jsonb_agg(jsonb_build_object('player_id',player_id,'rating',rating) order by player_id) into old_ratings from public.event_player_ratings where event_id=ev;
  perform pg_temp.reject_voting(format('select public.complete_event_voting(%L,%L,%L,%L::uuid[],%L::jsonb)',ev,p1,p2,present_ids,'[]'),'votação foi alterada');
  perform pg_temp.check_voting((select rating=4 from public.event_player_ratings where event_id=ev and player_id=p3),'failed stale save preserves old evaluations');
  perform public.complete_event_voting(ev,p1,p2,present_ids,old_ratings);
  perform pg_temp.check_voting((select count(*)=2 from public.event_player_ratings where event_id=ev),'only chosen extremes stored');
  perform pg_temp.check_voting((select rating=5 from public.event_player_ratings where event_id=ev and player_id=p1),'best gets five');
  perform pg_temp.check_voting((select rating=1 from public.event_player_ratings where event_id=ev and player_id=p2),'worst gets one');
  perform pg_temp.check_voting((select average=3 and default_count=1 and explicit_count=0 from public.get_court_player_ranking(court) where player_id=p3),'others use default three without fake votes');
  perform pg_temp.check_voting((select average is null from public.get_court_player_ranking(court) where player_id=absent_id),'absent not scored');
  perform pg_temp.check_voting((select details->'before_ratings'=old_ratings from public.audit_logs where entity_id=ev and action='event.voting_completed'),'old notes preserved in audit');
  perform public.complete_event_voting(ev,p1,p2,present_ids,'[]'::jsonb);
  perform pg_temp.check_voting((select count(*)=1 from public.audit_logs where entity_id=ev and action='event.voting_completed'),'same result replay is idempotent');
  perform pg_temp.reject_voting(format('select public.complete_event_voting(%L,%L,%L,%L::uuid[],%L::jsonb)',ev,p2,p1,present_ids,old_ratings),'votação foi alterada');
  select jsonb_agg(jsonb_build_object('player_id',player_id,'rating',rating) order by player_id) into fresh_ratings from public.event_player_ratings where event_id=ev;
  perform public.complete_event_voting(ev,p2,p1,present_ids,fresh_ratings);
  perform pg_temp.check_voting((select rating=5 from public.event_player_ratings where event_id=ev and player_id=p2),'authorized revision can swap extremes atomically');
  execute 'reset role';
  perform set_config('request.jwt.claim.sub',member_id::text,true);execute 'set local role authenticated';
  perform pg_temp.reject_voting(format('select public.start_event_voting(%L,%L::uuid[])',ev,present_ids),'administrador');
  perform pg_temp.reject_voting(format('select public.complete_event_voting(%L,%L,%L,%L::uuid[],%L::jsonb)',ev,p1,p2,present_ids,'[]'),'administrador');
  perform pg_temp.check_voting((select count(*)=2 from public.event_player_ratings where event_id=ev),'member can read saved evaluations');
  execute 'reset role';
  perform set_config('request.jwt.claim.sub',outsider::text,true);execute 'set local role authenticated';
  perform pg_temp.reject_voting(format('select public.start_event_voting(%L,%L::uuid[])',ev,present_ids),'Sem acesso');
  perform pg_temp.reject_voting(format('select public.complete_event_voting(%L,%L,%L,%L::uuid[],%L::jsonb)',ev,p1,p2,present_ids,'[]'),'Sem acesso');
  execute 'reset role';perform set_config('request.jwt.claim.sub','',true);execute 'set local role authenticated';
  perform pg_temp.reject_voting(format('select public.start_event_voting(%L,%L::uuid[])',ev,present_ids),'Autenticação');
  execute 'reset role';execute 'set local role anon';
  perform pg_temp.reject_voting(format('select public.start_event_voting(%L,%L::uuid[])',ev,present_ids),'permission denied');
  perform pg_temp.reject_voting(format('select public.set_player_rating(%L,%L,4::smallint)',ev,p1),'permission denied');
  execute 'reset role';
end $$;
select 'PASSOU: real voting RPCs, attendance, early closure, saved teams, 5/1/default3, revision, stale snapshots, replay and permissions; fixtures rolled back' as result;
rollback;
