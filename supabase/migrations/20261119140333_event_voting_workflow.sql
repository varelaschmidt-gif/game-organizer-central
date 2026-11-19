-- Guided administrator evaluation: confirm attendance, close, choose 5 and 1.
-- No changes to teams, financial data or the peer-voting subsystem.
CREATE OR REPLACE FUNCTION public.set_player_rating(_event_id uuid, _player_id uuid, _rating smallint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ev public.events; old_rating smallint;
begin
  ev := public._lock_event(_event_id);
  if not public.is_group_admin(ev.group_id) then raise exception 'Somente o administrador pode avaliar jogadores'; end if;
  if ev.status<>'done' then raise exception 'A avaliação só é liberada após a finalização do evento'; end if;
  if _rating is null or _rating not between 1 and 5 then raise exception 'A nota deve ser de 1 a 5 estrelas'; end if;
  if not exists(select 1 from public.attendances a join public.players p on p.id=a.player_id
    where a.event_id=_event_id and a.player_id=_player_id and a.attended=true and a.status='confirmed' and p.venue_id=ev.venue_id and p.group_id=ev.group_id) then
    raise exception 'Só jogadores com presença registrada podem ser avaliados';
  end if;
  if _rating=1 and exists(select 1 from public.event_player_ratings where event_id=_event_id and rating=1 and player_id<>_player_id) then
    raise exception 'Somente um jogador pode receber uma estrela neste evento';
  end if;
  if _rating=5 and exists(select 1 from public.event_player_ratings where event_id=_event_id and rating=5 and player_id<>_player_id) then
    raise exception 'Somente um jogador pode receber cinco estrelas neste evento';
  end if;
  select rating into old_rating from public.event_player_ratings where event_id=_event_id and player_id=_player_id;
  insert into public.event_player_ratings(event_id,group_id,venue_id,player_id,rating,rated_by)
    values(_event_id,ev.group_id,ev.venue_id,_player_id,_rating,auth.uid())
    on conflict(event_id,player_id) do update set rating=excluded.rating,rated_by=auth.uid(),updated_at=now();
  insert into public.audit_logs(group_id,actor_id,action,entity,entity_id,details)
    values(ev.group_id,auth.uid(),case when old_rating is null then 'rating.set' else 'rating.changed' end,'event',_event_id,
      jsonb_build_object('player_id',_player_id,'venue_id',ev.venue_id,'from',old_rating,'to',_rating));
end $function$;
create unique index if not exists event_player_ratings_one_one_star
  on public.event_player_ratings(event_id) where rating=1;

create schema if not exists ranking_internal;
revoke all on schema ranking_internal from public,anon;
grant usage on schema ranking_internal to authenticated;

create or replace function ranking_internal.start_event_voting(_event_id uuid,_present_ids uuid[])
returns void language plpgsql security definer set search_path='' as $$
declare ev public.events; current_ids uuid[];
begin
  if auth.uid() is null then raise exception 'Autenticação necessária'; end if;
  ev:=public._lock_event(_event_id);
  if not public.is_group_admin(ev.group_id) then raise exception 'Somente o administrador pode iniciar a votação'; end if;
  if ev.status not in ('scheduled','done') then raise exception 'Evento cancelado'; end if;
  if not exists(select 1 from public.event_teams t join public.event_team_players tp on tp.team_id=t.id
    where t.event_id=ev.id and tp.event_id=ev.id and t.group_id=ev.group_id and t.venue_id=ev.venue_id) then
    raise exception 'Tire os times antes de iniciar a votação';
  end if;
  if coalesce(cardinality(_present_ids),0)<2 then raise exception 'Confirme pelo menos dois presentes para escolher jogadores diferentes'; end if;
  if (select count(distinct x) from unnest(_present_ids) x)<>cardinality(_present_ids) then
    raise exception 'A lista de presentes contém jogadores repetidos ou inválidos';
  end if;
  if (select count(*) from public.attendances a join public.players p on p.id=a.player_id
    where a.event_id=ev.id and a.group_id=ev.group_id and a.status='confirmed'
      and p.group_id=ev.group_id and p.venue_id=ev.venue_id and p.id=any(_present_ids))<>cardinality(_present_ids) then
    raise exception 'Selecione somente jogadores confirmados deste evento';
  end if;
  if ev.status='done' then
    current_ids:=array(select a.player_id from public.attendances a where a.event_id=ev.id and a.status='confirmed' and a.attended is true order by a.player_id);
    if current_ids is distinct from array(select x from unnest(_present_ids) x order by x) then
      raise exception 'Evento já encerrado; atualize a lista de presentes';
    end if;
    return; -- Safe replay after a lost response; do not change attendance again.
  end if;
  update public.attendances a set attended=(a.player_id=any(_present_ids)),updated_by=auth.uid()
    where a.event_id=ev.id and a.group_id=ev.group_id and a.status='confirmed';
  -- Explicit early closure is authorized by the administrator's confirmation.
  -- Keep finish_event's normal end-time restriction unchanged for other flows.
  update public.events set status='done',updated_at=now() where id=ev.id;
  insert into public.audit_logs(group_id,actor_id,action,entity,entity_id,details)
    values(ev.group_id,auth.uid(),'event.voting_started','event',ev.id,
      jsonb_build_object('venue_id',ev.venue_id,'present_player_ids',to_jsonb(_present_ids),'previous_status',ev.status));
end $$;

create or replace function ranking_internal.complete_event_voting(
  _event_id uuid,_best_player_id uuid,_worst_player_id uuid,_expected_player_ids uuid[],_expected_ratings jsonb
) returns void language plpgsql security definer set search_path='' as $$
declare ev public.events; present_ids uuid[]; old_ratings jsonb; target_ratings jsonb;
begin
  if auth.uid() is null then raise exception 'Autenticação necessária'; end if;
  ev:=public._lock_event(_event_id);
  if not public.is_group_admin(ev.group_id) then raise exception 'Somente o administrador pode concluir a votação'; end if;
  if ev.status<>'done' then raise exception 'Inicie a votação e encerre o evento antes de salvar'; end if;
  if not exists(select 1 from public.event_teams t join public.event_team_players tp on tp.team_id=t.id
    where t.event_id=ev.id and tp.event_id=ev.id and t.group_id=ev.group_id and t.venue_id=ev.venue_id) then
    raise exception 'Este evento não possui times formados';
  end if;
  present_ids:=array(select a.player_id from public.attendances a join public.players p on p.id=a.player_id
    where a.event_id=ev.id and a.group_id=ev.group_id and a.status='confirmed' and a.attended is true
      and p.group_id=ev.group_id and p.venue_id=ev.venue_id order by a.player_id);
  if cardinality(present_ids)<2 then raise exception 'São necessários pelo menos dois presentes'; end if;
  if present_ids is distinct from array(select x from unnest(_expected_player_ids) x order by x) then
    raise exception using message='A lista de presentes foi alterada. Atualize e recomece a votação.',errcode='40001';
  end if;
  if _best_player_id is null or _worst_player_id is null or _best_player_id=_worst_player_id then
    raise exception 'Escolha um craque e um pereba diferentes';
  end if;
  if not (_best_player_id=any(present_ids)) or not (_worst_player_id=any(present_ids)) then
    raise exception 'Os escolhidos precisam estar presentes neste evento';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('player_id',r.player_id,'rating',r.rating) order by r.player_id),'[]'::jsonb)
    into old_ratings from public.event_player_ratings r where r.event_id=ev.id;
  select jsonb_agg(jsonb_build_object('player_id',x.id,'rating',x.rating) order by x.id)
    into target_ratings from (values(_best_player_id,5),(_worst_player_id,1)) x(id,rating);
  if old_ratings=target_ratings then return; end if; -- Identical retry is idempotent.
  if old_ratings is distinct from _expected_ratings then
    raise exception using message='A votação foi alterada por outra operação. Atualize e recomece.',errcode='40001';
  end if;
  delete from public.event_player_ratings where event_id=ev.id;
  insert into public.event_player_ratings(event_id,group_id,venue_id,player_id,rating,rated_by)
    values(ev.id,ev.group_id,ev.venue_id,_best_player_id,5,auth.uid()),
          (ev.id,ev.group_id,ev.venue_id,_worst_player_id,1,auth.uid());
  -- The remaining present participants contribute the existing default 3.
  -- Do not manufacture explicit votes for them.
  insert into public.audit_logs(group_id,actor_id,action,entity,entity_id,details)
    values(ev.group_id,auth.uid(),'event.voting_completed','event',ev.id,
      jsonb_build_object('venue_id',ev.venue_id,'before_ratings',old_ratings,'ratings',target_ratings,
        'present_player_ids',to_jsonb(present_ids),'default_rating',3));
end $$;

create or replace function public.start_event_voting(_event_id uuid,_present_ids uuid[])
returns void language sql security invoker set search_path='' as $$
  select ranking_internal.start_event_voting(_event_id,_present_ids);
$$;
create or replace function public.complete_event_voting(
  _event_id uuid,_best_player_id uuid,_worst_player_id uuid,_expected_player_ids uuid[],_expected_ratings jsonb
) returns void language sql security invoker set search_path='' as $$
  select ranking_internal.complete_event_voting(_event_id,_best_player_id,_worst_player_id,_expected_player_ids,_expected_ratings);
$$;
revoke all on function ranking_internal.start_event_voting(uuid,uuid[]),
  ranking_internal.complete_event_voting(uuid,uuid,uuid,uuid[],jsonb),
  public.start_event_voting(uuid,uuid[]),public.complete_event_voting(uuid,uuid,uuid,uuid[],jsonb) from public,anon;
grant execute on function ranking_internal.start_event_voting(uuid,uuid[]),
  ranking_internal.complete_event_voting(uuid,uuid,uuid,uuid[],jsonb),
  public.start_event_voting(uuid,uuid[]),public.complete_event_voting(uuid,uuid,uuid,uuid[],jsonb) to authenticated;
