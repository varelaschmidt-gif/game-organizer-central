-- ONLY iuwgpfhvauyhxfzlxlbu. Disposable fixtures, all changes rolled back.
begin;
set local timezone='America/Sao_Paulo';
create function pg_temp.assert_ranking(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'TEST FAILED: %',label; end if; end $$;
create function pg_temp.reject_ranking(q text,pattern text) returns void language plpgsql as $$
begin
  begin execute q;
  exception when others then
    if sqlerrm ilike '%'||pattern||'%' then return; end if;
    raise exception 'Wrong rejection: %, expected %',sqlerrm,pattern;
  end;
  raise exception 'TEST FAILED: expected rejection %',pattern;
end $$;
do $$
declare
  adm uuid:=gen_random_uuid(); member_id uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
  grp uuid:=gen_random_uuid(); other_grp uuid:=gen_random_uuid();
  court uuid:=gen_random_uuid(); other_court uuid:=gen_random_uuid();
  p1 uuid:=gen_random_uuid(); p2 uuid:=gen_random_uuid(); p3 uuid:=gen_random_uuid();
  e1 uuid:=gen_random_uuid(); e2 uuid:=gen_random_uuid(); e3 uuid:=gen_random_uuid();
  e4 uuid:=gen_random_uuid(); e5 uuid:=gen_random_uuid(); e6 uuid:=gen_random_uuid();
  c10 uuid; c11 uuid; partial_charge uuid; pay uuid; result record;
  today date:=public._fin_today();
begin
  insert into auth.users(id,email) values(adm,adm||'@ranking-test.invalid'),
    (member_id,member_id||'@ranking-test.invalid'),(outsider,outsider||'@ranking-test.invalid');
  insert into public.groups(id,name,created_by) values(grp,'Ranking RPC test A',adm),(other_grp,'Ranking RPC test B',outsider);
  insert into public.group_members(group_id,user_id,role) values(grp,adm,'admin'),(grp,member_id,'player'),(other_grp,outsider,'admin');
  insert into public.venues(id,group_id,name) values(court,grp,'Ranking RPC test A'),(other_court,other_grp,'Ranking RPC test B');
  insert into public.players(id,venue_id,group_id,user_id,name,participation_type,is_monthly,status)
    values(p1,court,grp,member_id,'Five twice','mensalista',true,'active'),
      (p2,court,grp,null,'Default score','mensalista',true,'active'),
      (p3,court,grp,null,'Never listed','mensalista',true,'active');
  insert into public.events(id,venue_id,group_id,title,starts_at,max_participants,status,created_by)
    values(e1,court,grp,'Ranking fixture 1',now()-interval '6 days',20,'done',adm),
      (e2,court,grp,'Ranking fixture 2',now()-interval '5 days',20,'done',adm),
      (e3,court,grp,'Ranking absent 1',now()-interval '4 days',20,'done',adm),
      (e4,court,grp,'Ranking absent 2',now()-interval '3 days',20,'done',adm),
      (e5,court,grp,'Ranking open',now()+interval '2 days',20,'scheduled',adm),
      -- Synthetic future done event solely tests the post-settlement boundary.
      (e6,court,grp,'Ranking new cycle',now()+interval '1 day',20,'done',adm);
  insert into public.attendances(event_id,group_id,player_id,status,attended)
    values(e1,grp,p1,'confirmed',true),(e2,grp,p1,'confirmed',true),
      (e3,grp,p1,'confirmed',false),(e4,grp,p1,'confirmed',false),
      (e1,grp,p2,'confirmed',true),(e5,grp,p1,'confirmed',true);
  perform set_config('request.jwt.claim.sub',adm::text,true);
  execute 'set local role authenticated';
  perform public.set_player_rating(e1,p1,5::smallint);
  perform public.set_player_rating(e2,p1,5::smallint);
  select * into result from public.get_court_player_ranking(court) where player_id=p1;
  perform pg_temp.assert_ranking(result.average=5 and result.events_count=2 and result.explicit_count=2 and result.default_count=0,'two fives then two absences stays five; open event ignored');
  perform pg_temp.assert_ranking((select average=3 and events_count=1 and explicit_count=0 and default_count=1 from public.get_court_player_ranking(court) where player_id=p2),'unrated present gets default three');
  perform pg_temp.assert_ranking((select average is null and rank is null and events_count=0 from public.get_court_player_ranking(court) where player_id=p3),'not listed gets no score');
  perform pg_temp.assert_ranking((select count(*)=2 from public.event_player_ratings where venue_id=court),'default three is not a stored vote');
  perform pg_temp.reject_ranking(format('select public.set_player_rating(%L,%L,5::smallint)',e1,p2),'cinco estrelas');
  perform pg_temp.reject_ranking(format('select public.set_player_rating(%L,%L,0::smallint)',e1,p2),'1 a 5');
  perform pg_temp.reject_ranking(format('select public.set_player_rating(%L,%L,6::smallint)',e1,p2),'1 a 5');
  perform pg_temp.reject_ranking(format('select public.set_player_rating(%L,%L,4::smallint)',e3,p1),'presença');
  perform pg_temp.reject_ranking(format('select public.set_player_rating(%L,%L,4::smallint)',e5,p1),'finalização');
  perform public.set_player_rating(e1,p2,4::smallint);
  perform pg_temp.assert_ranking((select average=4 and events_count=1 and explicit_count=1 from public.get_court_player_ranking(court) where player_id=p2),'corrected evaluation counts event once');
  perform public.remove_player_rating(e1,p2);
  perform pg_temp.assert_ranking((select average=3 and default_count=1 from public.get_court_player_ranking(court) where player_id=p2),'removed evaluation falls back to three');
  perform public.finance_save_settings(court,jsonb_build_object('opening_balance_cents',0,'opening_balance_date','2000-01-01'));
  c10:=public.finance_create_charge(court,p1,'manual','Ranking ten days',100,today-10,null,'ranking-ten');
  perform pg_temp.assert_ranking((select average=5 and not blocked from public.get_court_player_ranking(court) where player_id=p1),'exactly ten days does not reset');
  c11:=public.finance_create_charge(court,p1,'manual','Ranking eleven days',100,today-11,null,'ranking-eleven');
  perform pg_temp.assert_ranking((select average=0 and blocked and events_count=0 from public.get_court_player_ranking(court) where player_id=p1),'eleven days zeros entire score');
  pay:=public.finance_record_payment(c11,40,'pix',today,null,'ranking-partial');
  perform pg_temp.assert_ranking((select average=0 and blocked from public.get_court_player_ranking(court) where player_id=p1),'partial settlement retains zero');
  perform public.finance_record_payment(c11,60,'pix',today,null,'ranking-settled');
  perform pg_temp.assert_ranking((select average=0 and not blocked and restarted and events_count=0 from public.get_court_player_ranking(court) where player_id=p1),'late settlement does not restore historical score');
  execute 'reset role';
  insert into public.attendances(event_id,group_id,player_id,status,attended) values(e6,grp,p1,'confirmed',true);
  execute 'set local role authenticated';
  perform pg_temp.assert_ranking((select average=3 and restarted and events_count=1 and default_count=1 from public.get_court_player_ranking(court) where player_id=p1),'new participation starts a fresh average');
  perform public.finance_reverse_entry(pay,'Ranking reversal test','ranking-reversal');
  perform pg_temp.assert_ranking((select average=0 and blocked from public.get_court_player_ranking(court) where player_id=p1),'payment reversal reopens old debt');
  perform public.finance_record_payment(c11,40,'pix',today,null,'ranking-repaid');
  perform pg_temp.assert_ranking((select average=3 and not blocked and restarted from public.get_court_player_ranking(court) where player_id=p1),'requittance keeps old scores excluded');
  partial_charge:=public.finance_create_charge(court,p2,'manual','Private other player debt',100,today-11,null,'ranking-private');
  execute 'reset role';
  perform set_config('request.jwt.claim.sub',member_id::text,true);
  execute 'set local role authenticated';
  perform pg_temp.assert_ranking((select count(*)=3 from public.get_court_player_ranking(court)),'member can read court ranking');
  perform pg_temp.assert_ranking((select average=0 and blocked from public.get_court_player_ranking(court) where player_id=p2),'ranking includes penalty without finance row access');
  perform pg_temp.assert_ranking((select count(*)=0 from public.finance_charges where id=partial_charge),'member cannot read another player debt');
  perform pg_temp.reject_ranking(format('select public.set_player_rating(%L,%L,4::smallint)',e1,p1),'administrador');
  perform pg_temp.reject_ranking(format('select public.remove_player_rating(%L,%L)',e1,p1),'administrador');
  perform pg_temp.reject_ranking(format('update public.event_player_ratings set rating=1 where player_id=%L',p1),'permission denied');
  perform pg_temp.assert_ranking((select count(*)=0 from public.get_court_player_ranking(other_court)),'member cannot read other court');
  execute 'reset role';
  perform set_config('request.jwt.claim.sub',outsider::text,true);
  execute 'set local role authenticated';
  perform pg_temp.assert_ranking((select count(*)=0 from public.get_court_player_ranking(court)),'other group admin cannot read ranking');
  perform pg_temp.assert_ranking((select count(*)=0 from public.event_player_ratings where venue_id=court),'other group cannot read rating rows');
  perform pg_temp.reject_ranking(format('select public.set_player_rating(%L,%L,4::smallint)',e1,p1),'Sem acesso');
  execute 'reset role';
  perform set_config('request.jwt.claim.sub','',true);
  execute 'set local role authenticated';
  perform pg_temp.assert_ranking((select count(*)=0 from public.get_court_player_ranking(court)),'missing identity returns no ranking');
  execute 'reset role';
  execute 'set local role anon';
  perform pg_temp.reject_ranking(format('select * from public.get_court_player_ranking(%L)',court),'permission denied');
  execute 'reset role';
end $$;
select 'PASSOU: ranking RPC, real rating/payment RPCs, default scores, ten/eleven days, partial/settled/reversed, restart, roles and group isolation; rollback follows' as result;
rollback;
