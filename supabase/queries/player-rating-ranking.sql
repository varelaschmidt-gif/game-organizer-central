-- Query body for the proposed ranking RPC. $1 is the court UUID.
-- Read-only: financial history is never changed to calculate a score.
with scoped_players as (
  select p.id, p.name, p.nickname, p.group_id, p.venue_id
  from public.players p
  where p.venue_id = $1
    and auth.uid() is not null and public.is_court_member($1)
), charges as (
  select c.*,
    greatest(c.created_at, ((c.due_date + 11)::timestamp at time zone 'America/Sao_Paulo')) as penalty_at
  from public.finance_charges c
  join scoped_players p on p.id=c.player_id and p.group_id=c.group_id and p.venue_id=c.venue_id
), payment_steps as (
  -- Group transaction timestamps so a payment and its reversal at the same instant
  -- are evaluated as one financial state, without relying on random UUID ordering.
  select l.charge_id, l.created_at as changed_at, sum(l.amount_cents) as delta
  from public.finance_ledger l join charges c on c.id=l.charge_id
  where l.entry_type in ('payment','payment_reversal')
    and l.group_id=c.group_id and l.venue_id=c.venue_id and l.player_id=c.player_id
  group by l.charge_id, l.created_at
), running_payments as (
  select s.*, sum(s.delta) over (partition by s.charge_id order by s.changed_at) as paid_after
  from payment_steps s
), resolved_penalties as (
  -- A late settlement permanently excludes earlier participations, even after
  -- the debt is paid. Keep the source evaluations intact for audit/history.
  select c.player_id, r.changed_at as restart_at
  from charges c join running_payments r on r.charge_id=c.id
  where r.changed_at>=c.penalty_at and r.paid_after-r.delta<c.amount_cents
    and r.paid_after>=c.amount_cents
    and (c.cancelled_at is null or r.changed_at<=c.cancelled_at)
  union all
  select c.player_id, c.cancelled_at
  from charges c
  where c.status='cancelled' and c.cancelled_at>=c.penalty_at
    and coalesce((select sum(s.delta) from payment_steps s
      where s.charge_id=c.id and s.changed_at<=c.cancelled_at),0)<c.amount_cents
), restarts as (
  select player_id,max(restart_at) as restart_at from resolved_penalties group by player_id
), blocked_players as (
  select distinct c.player_id from charges c
  where c.status='open' and c.due_date<public._fin_today()-10
    and c.amount_cents>coalesce((select sum(s.delta) from payment_steps s where s.charge_id=c.id),0)
), participations as (
  select p.id as player_id, e.id as event_id, r.rating
  from scoped_players p
  join public.attendances a on a.player_id=p.id and a.group_id=p.group_id
  join public.events e on e.id=a.event_id and e.venue_id=p.venue_id and e.group_id=p.group_id
  left join restarts x on x.player_id=p.id
  left join public.event_player_ratings r on r.event_id=e.id and r.player_id=p.id
    and r.group_id=p.group_id and r.venue_id=p.venue_id
  where e.status='done' and a.status='confirmed' and a.attended is true
    and (x.restart_at is null or e.starts_at>=x.restart_at)
), averages as (
  select player_id, round(avg(coalesce(rating,3))::numeric,2) as average,
    count(*) as events_count, count(rating) as explicit_count,
    count(*) filter (where rating is null) as default_count
  from participations group by player_id
), scores as (
  select p.id as player_id,p.name,p.nickname,
    case when b.player_id is not null or (x.restart_at is not null and a.average is null)
      then 0::numeric else a.average end as average,
    case when b.player_id is not null then 0::bigint else coalesce(a.events_count,0) end as events_count,
    case when b.player_id is not null then 0::bigint else coalesce(a.explicit_count,0) end as explicit_count,
    case when b.player_id is not null then 0::bigint else coalesce(a.default_count,0) end as default_count,
    b.player_id is not null as blocked, x.restart_at is not null as restarted
  from scoped_players p
  left join averages a on a.player_id=p.id
  left join blocked_players b on b.player_id=p.id
  left join restarts x on x.player_id=p.id
)
select s.*,case when s.average is not null then dense_rank() over (order by s.average desc nulls last) end as rank
from scores s
order by s.average desc nulls last,lower(coalesce(nullif(s.nickname,''),s.name)),s.player_id;
