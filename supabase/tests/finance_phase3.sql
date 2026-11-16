-- ONLY the independent Supabase test copy. Random disposable fixtures, all rolled back.
begin;
set local timezone='America/Sao_Paulo';
create function pg_temp.assert_finance(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'TEST FAILED: %',label; end if; end $$;
create function pg_temp.reject_finance(q text, pattern text) returns void language plpgsql as $$
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
  adm uuid:=gen_random_uuid(); usr uuid:=gen_random_uuid(); other_adm uuid:=gen_random_uuid();
  grp uuid:=gen_random_uuid(); other_grp uuid:=gen_random_uuid(); venue uuid:=gen_random_uuid(); other_venue uuid:=gen_random_uuid();
  p1 uuid:=gen_random_uuid(); p2 uuid:=gen_random_uuid(); p3 uuid:=gen_random_uuid(); ev uuid:=gen_random_uuid();
  p4 uuid:=gen_random_uuid(); p5 uuid:=gen_random_uuid();
  c1 uuid; c2 uuid; daily uuid; exp uuid; exp2 uuid; atomic_exp uuid; pay uuid; pay2 uuid; outgoing uuid; result uuid;
  per date:=date_trunc('month',public._fin_today())::date;
  previous date:=(date_trunc('month',public._fin_today())-interval '1 month')::date;
  today date:=public._fin_today(); n int; report jsonb;
begin
  insert into auth.users(id,email) values(adm,adm||'@finance-test.invalid'),(usr,usr||'@finance-test.invalid'),(other_adm,other_adm||'@finance-test.invalid');
  insert into public.groups(id,name,created_by) values(grp,'Finance test A',adm),(other_grp,'Finance test B',other_adm);
  insert into public.group_members(group_id,user_id,role) values(grp,adm,'admin'),(grp,usr,'player'),(other_grp,other_adm,'admin');
  insert into public.venues(id,group_id,name) values(venue,grp,'Finance test A'),(other_venue,other_grp,'Finance test B');
  insert into public.players(id,venue_id,group_id,user_id,name,participation_type,is_monthly,status)
    values(p1,venue,grp,usr,'Monthly A','mensalista',true,'active'),
      (p2,venue,grp,null,'Monthly B','mensalista',true,'active'),(p3,venue,grp,null,'Daily','avulso',false,'active');
  insert into public.events(id,venue_id,group_id,title,starts_at,max_participants,created_by)
    values(ev,venue,grp,'Finance test',now()+interval '2 days',20,adm);
  perform set_config('request.jwt.claim.sub',adm::text,true);
  execute 'set local role authenticated';
  c1:=public.finance_create_charge(venue,p1,'manual','Configuração inicial',100,today,null,'phase3-before-opening');
  perform pg_temp.reject_finance(format('select public.finance_record_payment(%L,100,%L,%L,null,%L)',c1,'pix',today,'phase3-before-opening-pay'),'saldo inicial');
  perform public.finance_cancel_charge(c1,'Teste anterior à configuração');
  perform public.finance_save_settings(venue,jsonb_build_object('monthly_fee_cents',10000,'due_day',1,'opening_balance_cents',5000,'opening_balance_date','2000-01-01'));
  perform pg_temp.reject_finance(format('select public.finance_save_settings(%L,%L::jsonb)',venue,jsonb_build_object('opening_balance_cents',9007199254740992::bigint,'opening_balance_date','2000-01-01')),'precisão');
  perform public.finance_save_player_terms(p2,12500,5::smallint,'Condição individual');
  perform pg_temp.assert_finance(public.finance_generate_monthly(venue)=2,'monthly generation');
  perform pg_temp.assert_finance(public.finance_generate_monthly(venue)=0,'monthly deduplication');
  select id into c1 from public.finance_charges where venue_id=venue and player_id=p1 and kind='monthly';
  select id into c2 from public.finance_charges where venue_id=venue and player_id=p2 and kind='monthly';
  perform pg_temp.assert_finance((select amount_cents=12500 and due_date=per+4 from public.finance_charges where id=c2),'individual frozen terms');
  perform public.finance_save_settings(venue,jsonb_build_object('monthly_fee_cents',15000,'due_day',1,'opening_balance_cents',5000,'opening_balance_date','2000-01-01'));
  perform pg_temp.assert_finance((select amount_cents=10000 from public.finance_charges where id=c1),'settings preserve existing charge');
  perform pg_temp.assert_finance((public.finance_summary(venue,per,today)->>'balance_cents')::bigint=5000,'unpaid charges are not cash');
  pay:=public.finance_record_payment(c1,4000,'pix',today,'Parcial','phase3-partial-1');
  perform pg_temp.assert_finance((select outstanding_cents=6000 and paid_cents=4000 from public.finance_charge_balances where id=c1),'partial payment');
  perform pg_temp.assert_finance(public.finance_record_payment(c1,4000,'pix',today,'Parcial','phase3-partial-1')=pay,'payment replay');
  perform pg_temp.reject_finance(format('select public.finance_record_payment(%L,4001,%L,%L,%L,%L)',c1,'pix',today,'Parcial','phase3-partial-1'),'dados diferentes');
  perform pg_temp.reject_finance(format('select public.finance_record_payment(%L,6001,%L,%L,null,%L)',c1,'pix',today,'phase3-overpay-1'),'excede');
  perform pg_temp.reject_finance(format('select public.finance_record_payment(%L,0,%L,%L,null,%L)',c1,'pix',today,'phase3-zero-pay'),'maior que zero');
  pay2:=public.finance_record_payment(c1,6000,'dinheiro',today,null,'phase3-settled-1');
  perform pg_temp.assert_finance((select outstanding_cents=0 from public.finance_charge_balances where id=c1),'settlement');
  result:=public.finance_reverse_entry(pay2,'Correção do recebimento','phase3-reversal-1');
  perform pg_temp.assert_finance(public.finance_reverse_entry(pay2,'Correção do recebimento','phase3-reversal-1')=result,'reversal replay');
  perform pg_temp.assert_finance((select outstanding_cents=6000 from public.finance_charge_balances where id=c1),'reversal restores balance');
  perform pg_temp.reject_finance(format('select public.finance_reverse_entry(%L,%L,%L)',pay2,'Duplicado','phase3-reversal-2'),'já estornado');
  perform pg_temp.assert_finance((select count(*)=0 from public.finance_charges where event_id=ev),'no daily without explicit charge');
  perform public.finance_set_event_daily_fee(ev,1500);
  daily:=public.finance_create_charge(venue,p3,'daily','Diária teste',null,today,ev,'phase3-daily-1');
  perform pg_temp.reject_finance(format('select public.finance_create_charge(%L,%L,%L,%L,1500,%L,%L,%L)',venue,p3,'daily','Diária teste',today,ev,'phase3-daily-2'),'duplicate key');
  perform public.finance_record_payment(daily,1500,'pix',today,null,'phase3-daily-payment');
  exp:=public.finance_record_expense(venue,'Bola de teste','Material',today,today,1001,null,null,'phase3-expense-1');
  perform pg_temp.assert_finance((public.finance_summary(venue,per,today)->>'balance_cents')::bigint=10500,'pending expense excluded from cash');
  perform pg_temp.assert_finance(public.finance_split_expense(exp,'selected','equal',array[p1,p2],null,null,today)=2,'equal split');
  perform pg_temp.assert_finance((select sum(amount_cents)=1001 and max(amount_cents)-min(amount_cents)=1 from public.finance_charges where expense_id=exp),'no lost cents');
  outgoing:=public.finance_pay_expense(exp,today,'phase3-expense-payment');
  perform pg_temp.assert_finance(public.finance_pay_expense(exp,today,'phase3-expense-payment')=outgoing,'expense payment replay');
  report:=public.finance_summary(venue,per,today);
  perform pg_temp.assert_finance((report->>'balance_cents')::bigint=9499,'cash reconciliation opening + receipts - paid expenses');
  perform pg_temp.assert_finance((report->>'period_in_cents')::bigint=5500 and (report->>'period_out_cents')::bigint=1001,'net real receipts/expenses');
  perform public.finance_reverse_entry(outgoing,'Despesa paga por engano','phase3-expense-reverse');
  perform pg_temp.assert_finance((public.finance_summary(venue,per,today)->>'expense_pending_cents')::bigint=1001,'expense reversal restores pending');
  exp2:=public.finance_record_expense(venue,'Rateio personalizado','Material',today,today,1000,null,null,'phase3-custom-expense');
  perform pg_temp.reject_finance(format('select public.finance_split_expense(%L,%L,%L,%L::uuid[],%L::bigint[],null,%L)',exp2,'selected','custom',array[p1,p2],array[500,499],today),'difere');
  perform pg_temp.reject_finance(format('select public.finance_split_expense(%L,%L,%L,%L::uuid[],%L::bigint[],null,%L)',exp2,'selected','custom',array[p1,p2],array[1000,null],today),'maiores que zero');
  perform pg_temp.assert_finance(public.finance_split_expense(exp2,'selected','custom',array[p1,p2],array[600,400]::bigint[],null,today)=2,'custom split');
  perform pg_temp.reject_finance(format('select public.finance_record_expense_with_split(%L,%L,%L,%L,null,1000,null,null,%L,%L,%L,%L::uuid[],%L::bigint[],null,%L)',venue,'Atomic invalid','Material',today,'phase3-atomic-fail','selected','custom',array[p1,p2],array[500,400],today),'difere');
  perform pg_temp.assert_finance((select count(*)=0 from public.finance_expenses where venue_id=venue and idempotency_key='phase3-atomic-fail'),'invalid split rolls back expense');
  atomic_exp:=public.finance_record_expense_with_split(venue,'Atomic valid','Material',today,null,1000,null,null,'phase3-atomic-valid','selected','custom',array[p1,p2],array[500,500]::bigint[],null,today);
  perform pg_temp.assert_finance(public.finance_record_expense_with_split(venue,'Atomic valid','Material',today,null,1000,null,null,'phase3-atomic-valid','selected','custom',array[p1,p2],array[500,500]::bigint[],null,today)=atomic_exp,'atomic replay');
  perform pg_temp.reject_finance(format('select public.finance_record_expense_with_split(%L,%L,%L,%L,null,1000,null,null,%L,%L,%L,%L::uuid[],%L::bigint[],null,%L)',venue,'Atomic valid','Material',today,'phase3-atomic-valid','selected','custom',array[p1,p2],array[600,400],today),'rateio diferente');
  outgoing:=public.finance_pay_expense(atomic_exp,today,'phase3-atomic-pay');
  perform pg_temp.reject_finance(format('select public.finance_cancel_expense(%L,%L)',atomic_exp,'Cancelamento teste'),'Estorne');
  perform public.finance_reverse_entry(outgoing,'Correção despesa cancelada','phase3-atomic-reverse');
  perform public.finance_cancel_expense(atomic_exp,'Cancelamento autorizado');
  perform pg_temp.assert_finance((select bool_and(status='cancelled') from public.finance_charges where expense_id=atomic_exp),'cancel expense preserves and cancels shares');
  perform pg_temp.reject_finance(format('select public.finance_pay_expense(%L,%L,%L)',atomic_exp,today,'phase3-cancelled-pay'),'cancelada');
  perform pg_temp.assert_finance((public.finance_summary(venue,per,today)->>'expense_pending_cents')::bigint=2001,'cancelled expense excluded from pending');
  perform pg_temp.reject_finance(format('select public.finance_adjust_balance(%L,100,%L,%L,%L)',venue,today+1,'Data futura','phase3-future-1'),'futura');
  perform pg_temp.reject_finance(format('update public.finance_ledger set amount_cents=1 where id=%L',pay),'permission denied');
  perform pg_temp.reject_finance(format('select public.finance_save_settings(%L,%L::jsonb)',venue,jsonb_build_object('opening_balance_cents',1,'opening_balance_date','2000-01-01')),'imutável');
  perform pg_temp.reject_finance(format('select public.finance_close_month(%L,%L)',venue,per),'concluídos');
  perform public.finance_close_month(venue,previous);
  perform pg_temp.assert_finance((select (snapshot->>'period_ending_balance_cents')::bigint=5000 from public.finance_month_closings where venue_id=venue and period=previous),'historical close excludes later payments');
  perform pg_temp.reject_finance(format('select public.finance_adjust_balance(%L,100,%L,%L,%L)',venue,previous,'Fechado','phase3-closed-1'),'fechado');
  perform pg_temp.reject_finance(format('select public.finance_create_charge(%L,%L,%L,%L,100,%L,null,%L)',venue,p1,'manual','Histórico',previous,'phase3-closed-charge'),'fechado');
  perform public.finance_reopen_month(venue,previous,'Correção autorizada');
  perform public.finance_adjust_balance(venue,100,previous,'Correção autorizada','phase3-reopened-1');
  perform public.finance_close_month(venue,previous);
  perform pg_temp.assert_finance((select (snapshot->>'period_ending_balance_cents')::bigint=5100 from public.finance_month_closings where venue_id=venue and period=previous),'reclosing audited correction');
  execute 'reset role';
  insert into public.players(id,venue_id,group_id,name,participation_type,is_monthly,status)
    values(p4,venue,grp,'Automatic override','mensalista',true,'active'),(p5,venue,grp,'Exempt override','mensalista',true,'active');
  execute 'set local role authenticated';
  perform public.finance_save_player_terms(p4,1234,1::smallint,'Valor específico automático');
  perform public.finance_save_player_terms(p5,0,1::smallint,'Isenção autorizada');
  execute 'reset role';
  n:=public.finance_generate_due_monthly();
  perform pg_temp.assert_finance((select count(*)=1 and max(amount_cents)=1234 from public.finance_charges where venue_id=venue and player_id=p4),'automatic generation uses player terms');
  perform pg_temp.assert_finance((select count(*)=0 from public.finance_charges where venue_id=venue and player_id=p5),'zero terms exempt future generation');
  perform set_config('request.jwt.claim.sub',usr::text,true);
  execute 'set local role authenticated';
  perform pg_temp.assert_finance((select count(distinct player_id)=1 and bool_and(player_id=p1) from public.finance_charges where venue_id=venue),'player reads only own charges');
  perform pg_temp.assert_finance((select count(*)=0 from public.finance_expenses where venue_id=venue),'player cannot read private expenses');
  perform pg_temp.assert_finance((select count(*)=0 from public.finance_player_terms where venue_id=venue and player_id<>p1),'player cannot read other player terms');
  perform pg_temp.reject_finance(format('select public.finance_record_payment(%L,100,%L,%L,null,%L)',c1,'pix',today,'phase3-player-payment'),'Sem permissão');
  perform pg_temp.reject_finance(format('select public.finance_save_player_terms(%L,1,1::smallint,%L)',p1,'Próprio desconto'),'Sem permissão');
  perform pg_temp.reject_finance(format('select public.finance_reopen_month(%L,%L,%L)',venue,previous,'Própria alteração'),'Sem permissão');
  execute 'reset role';
  perform set_config('request.jwt.claim.sub',other_adm::text,true);
  execute 'set local role authenticated';
  perform pg_temp.assert_finance((select count(*)=0 from public.finance_charges where venue_id=venue),'cross-group charge isolation');
  perform pg_temp.assert_finance((select count(*)=0 from public.finance_ledger where venue_id=venue),'cross-group cash isolation');
  perform pg_temp.reject_finance(format('select public.finance_summary(%L,%L,%L)',venue,per,today),'Sem permissão');
  execute 'reset role';
end $$;
select 'PASSOU: financial RPCs, centavos, partial/settlement/reversal, terms, daily deduplication, rateios, cash, closing/reopening, idempotency, direct writes and RLS' as result;
rollback;
