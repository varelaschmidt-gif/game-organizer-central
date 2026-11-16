-- SELECT-only tests, with synthetic rows; no persistent fixtures or DDL.
with fixture_players as (select * from (values ('two-fives-then-absent','two-fives-then-absent',null,'group-a','court-a'),
('default-three','default-three',null,'group-a','court-a'),
('explicit-minimum','explicit-minimum',null,'group-a','court-a'),
('not-listed','not-listed',null,'group-a','court-a'),
('waiting-not-eligible','waiting-not-eligible',null,'group-a','court-a'),
('ten-days','ten-days',null,'group-a','court-a'),
('eleven-days','eleven-days',null,'group-a','court-a'),
('partial-overdue','partial-overdue',null,'group-a','court-a'),
('paid-late-new-default','paid-late-new-default',null,'group-a','court-a'),
('paid-early','paid-early',null,'group-a','court-a'),
('cancelled-late-new-four','cancelled-late-new-four',null,'group-a','court-a'),
('paid-late-no-new-events','paid-late-no-new-events',null,'group-a','court-a'),
('other-court-debt','other-court-debt',null,'group-a','court-a'),
('reversed-then-paid','reversed-then-paid',null,'group-a','court-a'),
('paid-early-cancelled-later','paid-early-cancelled-later',null,'group-a','court-a'),
('mixed-real-default','mixed-real-default',null,'group-a','court-a'),
('unknown-presence','unknown-presence',null,'group-a','court-a'),
('unfinished-event','unfinished-event',null,'group-a','court-a'),
('wrong-event-court','wrong-event-court',null,'group-a','court-a'),
('cancelled-early','cancelled-early',null,'group-a','court-a'),
('two-debts-last-clearance','two-debts-last-clearance',null,'group-a','court-a'),
('one-debt-still-open','one-debt-still-open',null,'group-a','court-a'),
('payment-reversal-same-instant','payment-reversal-same-instant',null,'group-a','court-a'),
('wrong-rating-scope','wrong-rating-scope',null,'group-a','court-a'),
('cancelled-attendance','cancelled-attendance',null,'group-a','court-a'),
('late-partials-then-full','late-partials-then-full',null,'group-a','court-a'),
('outsider','outsider',null,'group-b','court-b')) as v(id,name,nickname,group_id,venue_id)),
fixture_events as (select id,group_id,venue_id,status,starts_at::timestamptz from (select * from (values ('event-1','group-a','court-a','done','2026-11-01T18:00:00Z'),
('event-2','group-a','court-a','done','2026-11-01T18:00:00Z'),
('event-3','group-a','court-a','done','2026-11-01T18:00:00Z'),
('event-4','group-a','court-a','done','2026-11-01T18:00:00Z'),
('event-5','group-a','court-a','done','2026-11-01T18:00:00Z'),
('event-6','group-a','court-a','done','2026-11-01T18:00:00Z'),
('event-7','group-a','court-a','done','2026-11-01T18:00:00Z'),
('event-8','group-a','court-a','done','2026-11-01T18:00:00Z'),
('event-9','group-a','court-a','done','2026-11-01T18:00:00Z'),
('event-11','group-a','court-a','done','2026-11-01T18:00:00Z'),
('event-13','group-a','court-a','done','2026-11-01T18:00:00Z'),
('event-15','group-a','court-a','done','2026-11-01T18:00:00Z'),
('event-17','group-a','court-a','done','2026-11-15T18:00:00Z'),
('event-18','group-a','court-a','done','2026-11-01T18:00:00Z'),
('event-20','group-a','court-a','done','2026-11-01T18:00:00Z'),
('event-22','group-a','court-a','done','2026-11-15T18:00:00Z'),
('event-23','group-a','court-a','done','2026-11-01T18:00:00Z'),
('event-25','group-a','court-a','done','2026-11-01T18:00:00Z'),
('event-27','group-a','court-a','done','2026-11-01T18:00:00Z'),
('event-29','group-a','court-a','done','2026-11-15T18:00:00Z'),
('event-30','group-a','court-a','done','2026-11-01T18:00:00Z'),
('event-32','group-a','court-a','done','2026-11-01T18:00:00Z'),
('event-33','group-a','court-a','done','2026-11-01T18:00:00Z'),
('event-34','group-a','court-a','done','2026-11-01T18:00:00Z'),
('event-35','group-a','court-a','scheduled','2026-11-01T18:00:00Z'),
('event-36','group-a','court-b','done','2026-11-01T18:00:00Z'),
('event-37','group-a','court-a','done','2026-11-01T18:00:00Z'),
('event-39','group-a','court-a','done','2026-11-01T18:00:00Z'),
('event-42','group-a','court-a','done','2026-11-14T18:00:00Z'),
('event-43','group-a','court-a','done','2026-11-16T18:00:00Z'),
('event-44','group-a','court-a','done','2026-11-01T18:00:00Z'),
('event-47','group-a','court-a','done','2026-11-01T18:00:00Z'),
('event-49','group-a','court-a','done','2026-11-01T18:00:00Z'),
('event-50','group-a','court-a','done','2026-11-01T18:00:00Z'),
('event-51','group-a','court-a','done','2026-11-01T18:00:00Z'),
('event-53','group-a','court-a','done','2026-11-14T18:00:00Z'),
('event-54','group-a','court-a','done','2026-11-16T18:00:00Z'),
('event-55','group-b','court-b','done','2026-11-01T18:00:00Z')) as v(id,group_id,venue_id,status,starts_at)) x),
fixture_attendances as (select * from (values ('two-fives-then-absent','event-1','group-a','confirmed',true),
('two-fives-then-absent','event-2','group-a','confirmed',true),
('two-fives-then-absent','event-3','group-a','confirmed',false),
('two-fives-then-absent','event-4','group-a','confirmed',false),
('default-three','event-5','group-a','confirmed',true),
('explicit-minimum','event-6','group-a','confirmed',true),
('waiting-not-eligible','event-8','group-a','waitlist',true),
('ten-days','event-9','group-a','confirmed',true),
('eleven-days','event-11','group-a','confirmed',true),
('partial-overdue','event-13','group-a','confirmed',true),
('paid-late-new-default','event-15','group-a','confirmed',true),
('paid-late-new-default','event-17','group-a','confirmed',true),
('paid-early','event-18','group-a','confirmed',true),
('cancelled-late-new-four','event-20','group-a','confirmed',true),
('cancelled-late-new-four','event-22','group-a','confirmed',true),
('paid-late-no-new-events','event-23','group-a','confirmed',true),
('other-court-debt','event-25','group-a','confirmed',true),
('reversed-then-paid','event-27','group-a','confirmed',true),
('reversed-then-paid','event-29','group-a','confirmed',true),
('paid-early-cancelled-later','event-30','group-a','confirmed',true),
('mixed-real-default','event-32','group-a','confirmed',true),
('mixed-real-default','event-33','group-a','confirmed',true),
('unknown-presence','event-34','group-a','confirmed',null),
('unfinished-event','event-35','group-a','confirmed',true),
('wrong-event-court','event-36','group-a','confirmed',true),
('cancelled-early','event-37','group-a','confirmed',true),
('two-debts-last-clearance','event-39','group-a','confirmed',true),
('two-debts-last-clearance','event-42','group-a','confirmed',true),
('two-debts-last-clearance','event-43','group-a','confirmed',true),
('one-debt-still-open','event-44','group-a','confirmed',true),
('payment-reversal-same-instant','event-47','group-a','confirmed',true),
('wrong-rating-scope','event-49','group-a','confirmed',true),
('cancelled-attendance','event-50','group-a','cancelled',true),
('late-partials-then-full','event-51','group-a','confirmed',true),
('late-partials-then-full','event-53','group-a','confirmed',true),
('late-partials-then-full','event-54','group-a','confirmed',true),
('outsider','event-55','group-b','confirmed',true)) as v(player_id,event_id,group_id,status,attended)),
fixture_event_player_ratings as (select * from (values ('two-fives-then-absent','event-1','group-a','court-a',5),
('two-fives-then-absent','event-2','group-a','court-a',5),
('explicit-minimum','event-6','group-a','court-a',1),
('not-listed','event-7','group-a','court-a',5),
('waiting-not-eligible','event-8','group-a','court-a',5),
('ten-days','event-9','group-a','court-a',5),
('eleven-days','event-11','group-a','court-a',5),
('partial-overdue','event-13','group-a','court-a',5),
('paid-late-new-default','event-15','group-a','court-a',5),
('paid-early','event-18','group-a','court-a',5),
('cancelled-late-new-four','event-20','group-a','court-a',5),
('cancelled-late-new-four','event-22','group-a','court-a',4),
('paid-late-no-new-events','event-23','group-a','court-a',5),
('other-court-debt','event-25','group-a','court-a',5),
('reversed-then-paid','event-27','group-a','court-a',5),
('reversed-then-paid','event-29','group-a','court-a',2),
('paid-early-cancelled-later','event-30','group-a','court-a',5),
('mixed-real-default','event-32','group-a','court-a',5),
('unknown-presence','event-34','group-a','court-a',5),
('unfinished-event','event-35','group-a','court-a',5),
('wrong-event-court','event-36','group-a','court-b',5),
('cancelled-early','event-37','group-a','court-a',5),
('two-debts-last-clearance','event-39','group-a','court-a',5),
('two-debts-last-clearance','event-42','group-a','court-a',5),
('two-debts-last-clearance','event-43','group-a','court-a',4),
('one-debt-still-open','event-44','group-a','court-a',5),
('payment-reversal-same-instant','event-47','group-a','court-a',5),
('wrong-rating-scope','event-49','group-a','court-b',5),
('cancelled-attendance','event-50','group-a','court-a',5),
('late-partials-then-full','event-51','group-a','court-a',5),
('late-partials-then-full','event-53','group-a','court-a',5),
('outsider','event-55','group-b','court-b',5)) as v(player_id,event_id,group_id,venue_id,rating)),
fixture_finance_charges as (select id,player_id,group_id,venue_id,amount_cents,due_date::date,status,created_at::timestamptz,cancelled_at::timestamptz from (select * from (values ('charge-10','ten-days','group-a','court-a',100,'2026-11-06','open','2026-11-01T00:00:00Z',null),
('charge-12','eleven-days','group-a','court-a',100,'2026-11-05','open','2026-11-01T00:00:00Z',null),
('charge-14','partial-overdue','group-a','court-a',100,'2026-11-01','open','2026-11-01T00:00:00Z',null),
('charge-16','paid-late-new-default','group-a','court-a',100,'2026-11-01','open','2026-11-01T00:00:00Z',null),
('charge-19','paid-early','group-a','court-a',100,'2026-11-01','open','2026-11-01T00:00:00Z',null),
('charge-21','cancelled-late-new-four','group-a','court-a',100,'2026-11-01','cancelled','2026-11-01T00:00:00Z','2026-11-14T12:00:00Z'),
('charge-24','paid-late-no-new-events','group-a','court-a',100,'2026-11-01','open','2026-11-01T00:00:00Z',null),
('charge-26','other-court-debt','group-a','court-b',100,'2026-11-01','open','2026-11-01T00:00:00Z',null),
('charge-28','reversed-then-paid','group-a','court-a',100,'2026-11-01','open','2026-11-01T00:00:00Z',null),
('charge-31','paid-early-cancelled-later','group-a','court-a',100,'2026-11-01','cancelled','2026-11-01T00:00:00Z','2026-11-15T12:00:00Z'),
('charge-38','cancelled-early','group-a','court-a',100,'2026-11-01','cancelled','2026-11-01T00:00:00Z','2026-11-05T12:00:00Z'),
('charge-40','two-debts-last-clearance','group-a','court-a',100,'2026-11-01','open','2026-11-01T00:00:00Z',null),
('charge-41','two-debts-last-clearance','group-a','court-a',100,'2026-11-01','open','2026-11-01T00:00:00Z',null),
('charge-45','one-debt-still-open','group-a','court-a',100,'2026-11-01','open','2026-11-01T00:00:00Z',null),
('charge-46','one-debt-still-open','group-a','court-a',100,'2026-11-01','open','2026-11-01T00:00:00Z',null),
('charge-48','payment-reversal-same-instant','group-a','court-a',100,'2026-11-01','open','2026-11-01T00:00:00Z',null),
('charge-52','late-partials-then-full','group-a','court-a',100,'2026-11-01','open','2026-11-01T00:00:00Z',null)) as v(id,player_id,group_id,venue_id,amount_cents,due_date,status,created_at,cancelled_at)) x),
fixture_finance_ledger as (select charge_id,player_id,group_id,venue_id,amount_cents,created_at::timestamptz,entry_type from (select * from (values ('charge-14','partial-overdue','group-a','court-a',40,'2026-11-14T12:00:00Z','payment'),
('charge-16','paid-late-new-default','group-a','court-a',100,'2026-11-13T12:00:00Z','payment'),
('charge-19','paid-early','group-a','court-a',100,'2026-11-05T12:00:00Z','payment'),
('charge-24','paid-late-no-new-events','group-a','court-a',100,'2026-11-13T12:00:00Z','payment'),
('charge-28','reversed-then-paid','group-a','court-a',100,'2026-11-05T12:00:00Z','payment'),
('charge-28','reversed-then-paid','group-a','court-a',-100,'2026-11-13T12:00:00Z','payment_reversal'),
('charge-28','reversed-then-paid','group-a','court-a',100,'2026-11-14T12:00:00Z','payment'),
('charge-31','paid-early-cancelled-later','group-a','court-a',100,'2026-11-05T12:00:00Z','payment'),
('charge-40','two-debts-last-clearance','group-a','court-a',100,'2026-11-13T12:00:00Z','payment'),
('charge-41','two-debts-last-clearance','group-a','court-a',100,'2026-11-15T12:00:00Z','payment'),
('charge-45','one-debt-still-open','group-a','court-a',100,'2026-11-13T12:00:00Z','payment'),
('charge-48','payment-reversal-same-instant','group-a','court-a',100,'2026-11-13T12:00:00Z','payment'),
('charge-48','payment-reversal-same-instant','group-a','court-a',-100,'2026-11-13T12:00:00Z','payment_reversal'),
('charge-52','late-partials-then-full','group-a','court-a',40,'2026-11-13T12:00:00Z','payment'),
('charge-52','late-partials-then-full','group-a','court-a',60,'2026-11-15T12:00:00Z','payment')) as v(charge_id,player_id,group_id,venue_id,amount_cents,created_at,entry_type)) x),
expected as (select * from (values ('two-fives-then-absent',5,2,2,0,false,false),
('default-three',3,1,0,1,false,false),
('explicit-minimum',1,1,1,0,false,false),
('not-listed',null,0,0,0,false,false),
('waiting-not-eligible',null,0,0,0,false,false),
('ten-days',5,1,1,0,false,false),
('eleven-days',0,0,0,0,true,false),
('partial-overdue',0,0,0,0,true,false),
('paid-late-new-default',3,1,0,1,false,true),
('paid-early',5,1,1,0,false,false),
('cancelled-late-new-four',4,1,1,0,false,true),
('paid-late-no-new-events',0,0,0,0,false,true),
('other-court-debt',5,1,1,0,false,false),
('reversed-then-paid',2,1,1,0,false,true),
('paid-early-cancelled-later',5,1,1,0,false,false),
('mixed-real-default',4,2,1,1,false,false),
('unknown-presence',null,0,0,0,false,false),
('unfinished-event',null,0,0,0,false,false),
('wrong-event-court',null,0,0,0,false,false),
('cancelled-early',5,1,1,0,false,false),
('two-debts-last-clearance',4,1,1,0,false,true),
('one-debt-still-open',0,0,0,0,true,true),
('payment-reversal-same-instant',0,0,0,0,true,false),
('wrong-rating-scope',3,1,0,1,false,false),
('cancelled-attendance',null,0,0,0,false,false),
('late-partials-then-full',3,1,0,1,false,true)) as v(player_id,average,events_count,explicit_count,default_count,blocked,restarted)),
actual as (-- Query body for the proposed ranking RPC. 'court-a' is the court UUID.
-- Read-only: financial history is never changed to calculate a score.
with scoped_players as (
  select p.id, p.name, p.nickname, p.group_id, p.venue_id
  from fixture_players p
  where p.venue_id = 'court-a'
    and true and true
), charges as (
  select c.*,
    greatest(c.created_at, ((c.due_date + 11)::timestamp at time zone 'America/Sao_Paulo')) as penalty_at
  from fixture_finance_charges c
  join scoped_players p on p.id=c.player_id and p.group_id=c.group_id and p.venue_id=c.venue_id
), payment_steps as (
  -- Group transaction timestamps so a payment and its reversal at the same instant
  -- are evaluated as one financial state, without relying on random UUID ordering.
  select l.charge_id, l.created_at as changed_at, sum(l.amount_cents) as delta
  from fixture_finance_ledger l join charges c on c.id=l.charge_id
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
  where c.status='open' and c.due_date<date '2026-11-16'-10
    and c.amount_cents>coalesce((select sum(s.delta) from payment_steps s where s.charge_id=c.id),0)
), participations as (
  select p.id as player_id, e.id as event_id, r.rating
  from scoped_players p
  join fixture_attendances a on a.player_id=p.id and a.group_id=p.group_id
  join fixture_events e on e.id=a.event_id and e.venue_id=p.venue_id and e.group_id=p.group_id
  left join restarts x on x.player_id=p.id
  left join fixture_event_player_ratings r on r.event_id=e.id and r.player_id=p.id
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
order by s.average desc nulls last,lower(coalesce(nullif(s.nickname,''),s.name)),s.player_id)
select e.player_id,
  (a.player_id is not null and a.average is not distinct from e.average and a.events_count=e.events_count
    and a.explicit_count=e.explicit_count and a.default_count=e.default_count and a.blocked=e.blocked and a.restarted=e.restarted) as passed,
  a.average,a.events_count,a.explicit_count,a.default_count,a.blocked,a.restarted,
  (select count(*)=0 from actual where player_id='outsider') as other_court_excluded,
  (select min(rank)=max(rank) from actual where average=5) as equal_scores_share_rank
from expected e left join actual a using(player_id) order by e.player_id;
