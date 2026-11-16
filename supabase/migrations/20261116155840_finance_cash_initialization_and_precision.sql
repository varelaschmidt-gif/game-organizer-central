-- Enforce the documented cash opening and exact-cent boundary on the server.
create or replace function public._fin_guard_settings() returns trigger
language plpgsql set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.venue_id::text,0));
  if abs(new.opening_balance_cents::numeric)>9007199254740991 then raise exception 'Saldo inicial fora da precisão monetária suportada'; end if;
  if new.opening_balance_date>public._fin_today() then raise exception 'Data do saldo inicial inválida'; end if;
  if tg_op='UPDATE' and (new.opening_balance_cents,new.opening_balance_date)
    is distinct from (old.opening_balance_cents,old.opening_balance_date) then
    raise exception 'Saldo inicial imutável; use ajuste auditável';
  end if;
  return new;
end $$;

CREATE OR REPLACE FUNCTION public._fin_guard_ledger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op <> 'INSERT' then raise exception 'Lançamentos do caixa não podem ser alterados nem excluídos; use estorno ou ajuste'; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.venue_id::text,0));
  if not exists(select 1 from public.finance_settings s where s.venue_id=new.venue_id) then raise exception 'Configure o saldo inicial antes de movimentar o caixa'; end if;
  if abs(new.amount_cents::numeric)>9007199254740991 then raise exception 'Valor fora da precisão monetária suportada'; end if;
  if abs((select s.opening_balance_cents::numeric+coalesce((select sum(l.amount_cents) from public.finance_ledger l where l.venue_id=new.venue_id and l.occurred_on>=s.opening_balance_date),0)+new.amount_cents from public.finance_settings s where s.venue_id=new.venue_id))>9007199254740991 then raise exception 'Saldo fora da precisão monetária suportada'; end if;
  if new.occurred_on>public._fin_today() then raise exception 'Data futura inválida'; end if;
  if exists(select 1 from public.finance_settings s where s.venue_id=new.venue_id and new.occurred_on<s.opening_balance_date) then raise exception 'Movimento anterior ao saldo inicial'; end if;
  if not exists(select 1 from public.venues v where v.id=new.venue_id and v.group_id=new.group_id) then raise exception 'Grupo e quadra divergentes'; end if;
  if new.charge_id is not null and not exists(select 1 from public.finance_charges c where c.id=new.charge_id and c.venue_id=new.venue_id and c.group_id=new.group_id and c.player_id=new.player_id) then raise exception 'Cobrança e jogador divergentes'; end if;
  if new.expense_id is not null and not exists(select 1 from public.finance_expenses x where x.id=new.expense_id and x.venue_id=new.venue_id and x.group_id=new.group_id) then raise exception 'Despesa de outra quadra'; end if;
  if exists (select 1 from public.finance_month_closings c where c.venue_id = new.venue_id
      and c.period = date_trunc('month', new.occurred_on)::date and c.status = 'closed') then
    raise exception 'O mês de % está fechado; reabra-o ou lance com a data atual', to_char(new.occurred_on, 'MM/YYYY');
  end if;
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.finance_record_expense(_venue_id uuid, _description text, _category text, _incurred_on date, _due_on date, _amount_cents bigint, _paid_on date, _notes text, _idempotency_key text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v public.venues; k text := public._fin_require_key(_idempotency_key); eid uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended((_venue_id)::text,0));
  v := public._fin_venue_for_manager(_venue_id);
  select id into eid from public.finance_expenses where venue_id = v.id and idempotency_key = k;
  if found then
    if not exists(select 1 from public.finance_expenses where id=eid and description=trim(_description) and category=trim(_category) and incurred_on=_incurred_on and due_on is not distinct from _due_on and amount_cents=_amount_cents and notes is not distinct from nullif(trim(_notes),'')) then raise exception 'Chave de idempotência reutilizada com dados diferentes'; end if;
    if (select occurred_on from public.finance_ledger where venue_id=v.id and expense_id=eid and idempotency_key='pay:'||k) is distinct from _paid_on then raise exception 'Chave de idempotência reutilizada com dados diferentes'; end if;
    return eid;
  end if;
  if _incurred_on is null then raise exception 'Informe a data da despesa'; end if;
  insert into public.finance_expenses(venue_id, group_id, description, category, incurred_on, due_on, amount_cents, notes, created_by, idempotency_key)
    values (v.id, v.group_id, trim(_description), trim(_category), _incurred_on, _due_on, _amount_cents, nullif(trim(_notes), ''), auth.uid(), k)
    returning id into eid;
  if _paid_on is not null then perform public.finance_pay_expense(eid, _paid_on, 'pay:' || k); end if;
  insert into public.audit_logs(group_id, actor_id, action, entity, entity_id, details)
    values (v.group_id, auth.uid(), 'finance.expense_recorded', 'finance_expense', eid, jsonb_build_object('amount_cents', _amount_cents, 'venue_id', v.id));
  return eid;
end $function$
;
