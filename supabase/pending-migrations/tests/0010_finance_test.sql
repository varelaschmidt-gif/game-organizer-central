\set ON_ERROR_STOP 1
-- Run only on an isolated local database with 0000-0010 applied. Everything rolls back.
begin;
create or replace function pg_temp.as_user(u uuid) returns void language sql as $$ select set_config('request.uid', u::text, true) $$;
create or replace function pg_temp.expect_error(q text, pat text) returns void language plpgsql as $$
begin execute q; raise exception 'EXPECTED ERROR NOT RAISED: %', pat;
exception when others then if sqlerrm not ilike '%'||pat||'%' then raise exception 'wrong error: % (wanted %)', sqlerrm, pat; end if; end $$;
insert into auth.users(id,email) values ('00000000-0000-0000-0000-00000000000a','adm@x'),('00000000-0000-0000-0000-00000000000b','m@x'),
 ('00000000-0000-0000-0000-00000000000c','a@x'),('00000000-0000-0000-0000-00000000000d','other@x');
insert into public.groups(id,name,created_by) values ('10000000-0000-0000-0000-000000000001','G1','00000000-0000-0000-0000-00000000000a'),('10000000-0000-0000-0000-000000000002','G2','00000000-0000-0000-0000-00000000000d');
insert into public.group_members(group_id,user_id,role) values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a','admin'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000b','player'),('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000c','player'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000000d','admin');
insert into public.venues(id,group_id,name) values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Q1'),('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','Q2');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.players(id,group_id,venue_id,user_id,name,participation_type,is_monthly,status,joined_at) values
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000b','Mensal','mensalista',true,'active',current_date),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000c','Avulso','avulso',false,'active',current_date),
 ('30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',null,'Conv','convidado',false,'active',current_date),
 ('30000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',null,'Mensal2','mensalista',true,'active',current_date);
insert into public.events(id,group_id,venue_id,title,starts_at,max_participants,created_by,daily_fee_cents) values
 ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Jogo',now()+interval '2 day',20,'00000000-0000-0000-0000-00000000000a',1500);
select public.finance_save_settings('20000000-0000-0000-0000-000000000001','{"monthly_fee_cents":10000,"due_day":1,"opening_balance_cents":5000,"opening_balance_date":"2000-01-01"}');
-- manual generation is idempotent
select public.finance_generate_monthly('20000000-0000-0000-0000-000000000001') = 2 as t_monthly_first;
select public.finance_generate_monthly('20000000-0000-0000-0000-000000000001') = 0 as t_monthly_idempotent;
-- emulate an unused month to verify the scheduled generator and its idempotency
delete from public.finance_charges where venue_id='20000000-0000-0000-0000-000000000001' and kind='monthly'
  and period=date_trunc('month', public._fin_today())::date;
select public.finance_generate_due_monthly() = 2 as t_monthly_scheduler_first;
select public.finance_generate_due_monthly() = 0 as t_monthly_scheduler_idempotent;
select (select count(*) from cron.job where jobname = 'finance-generate-monthly-charges') = 1 as t_monthly_scheduler_installed;
select pg_temp.expect_error($$select public.finance_generate_monthly('20000000-0000-0000-0000-000000000001', '2001-01-01')$$,'mês atual');
-- overdue: force due date in past (test-only; superuser)
update public.finance_charges set due_date = current_date - 3 where venue_id='20000000-0000-0000-0000-000000000001' and kind='monthly';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.finance_player_overdue_cents('30000000-0000-0000-0000-000000000001') = 10000 as t_overdue;
select pg_temp.expect_error($$select public.rsvp_confirm('40000000-0000-0000-0000-000000000001', null)$$,'atraso');
-- player can't record payment
select pg_temp.expect_error($$select public.finance_record_payment((select id from finance_charges where player_id='30000000-0000-0000-0000-000000000001'),100,'pix',current_date,null,'player-key-1')$$,'Sem permissão');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
-- Admin can override monthly arrears, but this is audited.
select public.rsvp_confirm('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000004') = 'confirmed' as t_admin_monthly_override;
select exists(select 1 from public.audit_logs where group_id='10000000-0000-0000-0000-000000000001'
  and actor_id='00000000-0000-0000-0000-00000000000a' and action='attendance.finance_override'
  and entity_id='40000000-0000-0000-0000-000000000001'
  and details->>'player_id'='30000000-0000-0000-0000-000000000004') as t_admin_override_audited;
select pg_temp.expect_error($$select public.rsvp_confirm('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002')$$,'Diária pendente');
-- partial, overpay rejected, idempotent, settle
select public.finance_record_payment((select id from finance_charges where player_id='30000000-0000-0000-0000-000000000001'),4000,'pix',current_date,null,'pay-partial-1') is not null;
select public.finance_record_payment((select id from finance_charges where player_id='30000000-0000-0000-0000-000000000001'),4000,'pix',current_date,null,'pay-partial-1') is not null as replay;
select (select count(*) from finance_ledger where idempotency_key='pay-partial-1') = 1 as t_payment_idempotent;
select public.finance_player_overdue_cents('30000000-0000-0000-0000-000000000001') = 6000 as t_partial_still_overdue;
select pg_temp.expect_error($$select public.finance_record_payment((select id from finance_charges where player_id='30000000-0000-0000-0000-000000000001'),6001,'pix',current_date,null,'pay-over-1')$$,'excede');
select public.finance_record_payment((select id from finance_charges where player_id='30000000-0000-0000-0000-000000000001'),6000,'dinheiro',current_date,null,'pay-rest-01') is not null;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.rsvp_confirm('40000000-0000-0000-0000-000000000001', null) = 'confirmed' as t_paid_mensalista_confirms;
-- avulso blocked then allowed after paid daily
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect_error($$select public.rsvp_confirm('40000000-0000-0000-0000-000000000001', null)$$,'Diária pendente');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error($$select public.finance_create_charge('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000003','daily',null,null,null,'40000000-0000-0000-0000-000000000001','daily-conv-1')$$,'isentos');
select pg_temp.expect_error($$select public.finance_create_charge('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','daily',null,null,null,'40000000-0000-0000-0000-000000000001','daily-mens-1')$$,'não pagam');
select public.finance_record_payment(public.finance_create_charge('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','daily',null,null,null,'40000000-0000-0000-0000-000000000001','daily-avul-1'),1500,'pix',current_date,null,'pay-daily-1') is not null;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select public.rsvp_confirm('40000000-0000-0000-0000-000000000001', null) = 'confirmed' as t_paid_avulso_confirms;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
-- reversal keeps history and reopens debt
select public.finance_reverse_entry((select id from finance_ledger where idempotency_key='pay-rest-01'),'cheque devolvido','rev-rest-01') is not null;
select (select count(*) from finance_ledger where charge_id=(select id from finance_charges where player_id='30000000-0000-0000-0000-000000000001')) = 3 as t_reversal_history_kept;
select public.finance_player_overdue_cents('30000000-0000-0000-0000-000000000001') = 6000 as t_reversal_reopens;
select pg_temp.expect_error($$update finance_ledger set amount_cents=1$$,'não podem ser alterados');
-- split rounding: 1000 cents among 3 eligible (2 mensalistas + avulso; convidado excluded)
select public.finance_record_expense('20000000-0000-0000-0000-000000000001','Bola','material',current_date,null,1000,current_date,null,'exp-bola-01') is not null;
select public.finance_split_expense((select id from finance_expenses where idempotency_key='exp-bola-01'),'selected','equal',
  array['30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000004']::uuid[],null,null,current_date+10) = 3;
select (select sum(amount_cents) from finance_charges where kind='expense_share') = 1000 and (select max(amount_cents)-min(amount_cents) from finance_charges where kind='expense_share') = 1 as t_split_cents;
select pg_temp.expect_error($$select public.finance_split_expense((select id from finance_expenses where idempotency_key='exp-bola-01'),'monthly','equal',null,null,null,current_date)$$,'já foi rateada');
-- balance = opening + real movements: 5000 + 4000 + 6000 - 6000 + 1500 - 1000 = 9500
select (public.finance_summary('20000000-0000-0000-0000-000000000001','2000-01-01',current_date)->>'balance_cents')::bigint = 9500 as t_balance;
-- closing
select pg_temp.expect_error($$select public.finance_close_month('20000000-0000-0000-0000-000000000001', current_date)$$,'concluídos');
select public.finance_close_month('20000000-0000-0000-0000-000000000001', (date_trunc('month',current_date)-interval '1 month')::date);
select pg_temp.expect_error($$select public.finance_adjust_balance('20000000-0000-0000-0000-000000000001',100,(date_trunc('month',current_date)-interval '1 day')::date,'teste','adj-closed-1')$$,'fechado');
select pg_temp.expect_error($$select public.finance_reopen_month('20000000-0000-0000-0000-000000000001', (date_trunc('month',current_date)-interval '1 month')::date, '')$$,'motivo');
select public.finance_reopen_month('20000000-0000-0000-0000-000000000001', (date_trunc('month',current_date)-interval '1 month')::date, 'correção de lançamento');
-- isolation: other court admin sees nothing and cannot act
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
set local role authenticated;
select (select count(*) from finance_charges) = 0 and (select count(*) from finance_ledger) = 0 as t_isolation_rls;
select pg_temp.expect_error($$select public.finance_summary('20000000-0000-0000-0000-000000000001',current_date,current_date)$$,'Sem permissão');
reset role;
-- player sees only own charges
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
set local role authenticated;
select (select count(distinct player_id) from finance_charges) = 1 as t_player_own_only;
reset role;
rollback;
