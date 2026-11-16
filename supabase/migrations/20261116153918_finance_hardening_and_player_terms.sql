-- Incremental upgrade of the live finance_* model. No legacy financial_* tables.
-- Apply to the test copy first. Production requires explicit authorization.
create table public.finance_player_terms (
  player_id uuid primary key references public.players(id) on delete restrict,
  venue_id uuid not null references public.venues(id) on delete restrict,
  group_id uuid not null references public.groups(id) on delete restrict,
  monthly_fee_cents bigint check (monthly_fee_cents between 0 and 100000000),
  due_day smallint check (due_day between 1 and 28),
  reason text not null check (length(trim(reason)) between 3 and 500),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);
alter table public.finance_player_terms enable row level security;
grant select on public.finance_player_terms to authenticated;
grant all on public.finance_player_terms to service_role;
create policy "finance managers or own player read terms" on public.finance_player_terms
for select to authenticated using (public.can_manage_finance(group_id) or exists (
  select 1 from public.players p where p.id=player_id and p.user_id=auth.uid()
));

create or replace function public.finance_save_player_terms(
  _player_id uuid, _monthly_fee_cents bigint, _due_day smallint, _reason text
) returns void language plpgsql security definer set search_path=public as $$
declare p public.players; old jsonb;
begin
  select * into p from public.players where id=_player_id;
  if not found then raise exception 'Jogador não encontrado'; end if;
  perform public._fin_venue_for_manager(p.venue_id);
  perform pg_advisory_xact_lock(hashtextextended(p.venue_id::text,0));
  if p.is_event_guest or p.participation_type<>'mensalista' then raise exception 'Condições mensais exigem mensalista da quadra'; end if;
  select to_jsonb(t) into old from public.finance_player_terms t where player_id=p.id;
  insert into public.finance_player_terms(player_id,venue_id,group_id,monthly_fee_cents,due_day,reason,updated_by)
    values(p.id,p.venue_id,p.group_id,_monthly_fee_cents,_due_day,trim(_reason),auth.uid())
  on conflict(player_id) do update set monthly_fee_cents=excluded.monthly_fee_cents,
    due_day=excluded.due_day,reason=excluded.reason,updated_by=auth.uid(),updated_at=now();
  insert into public.audit_logs(group_id,actor_id,action,entity,entity_id,details)
    values(p.group_id,auth.uid(),'finance.player_terms_saved','player',p.id,
      jsonb_build_object('before',old,'monthly_fee_cents',_monthly_fee_cents,'due_day',_due_day,'reason',_reason));
end $$;
revoke all on function public.finance_save_player_terms(uuid,bigint,smallint,text) from public,anon;
grant execute on function public.finance_save_player_terms(uuid,bigint,smallint,text) to authenticated,service_role;

create or replace function public._fin_guard_settings() returns trigger
language plpgsql set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.venue_id::text,0));
  if new.opening_balance_date>public._fin_today() then raise exception 'Data do saldo inicial inválida'; end if;
  if tg_op='UPDATE' and (new.opening_balance_cents,new.opening_balance_date)
    is distinct from (old.opening_balance_cents,old.opening_balance_date) then
    raise exception 'Saldo inicial imutável; use ajuste auditável';
  end if;
  return new;
end $$;
create trigger finance_settings_history before insert or update on public.finance_settings
for each row execute function public._fin_guard_settings();

create or replace function public._fin_guard_obligation() returns trigger
language plpgsql security definer set search_path=public as $$
declare d date; v uuid; g uuid;
begin
  if tg_op='DELETE' then raise exception 'Histórico financeiro não pode ser excluído'; end if;
  select group_id into g from public.venues where id=new.venue_id;
  if g is distinct from new.group_id then raise exception 'Grupo e quadra divergentes'; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.venue_id::text,0));
  if tg_table_name='finance_charges' then
    d:=coalesce(new.period,new.due_date);
    if not exists(select 1 from public.players p where p.id=new.player_id and p.venue_id=new.venue_id and p.group_id=new.group_id) then
      raise exception 'Jogador não pertence a esta quadra'; end if;
    if new.event_id is not null and not exists(select 1 from public.events e where e.id=new.event_id and e.venue_id=new.venue_id and e.group_id=new.group_id) then
      raise exception 'Evento não pertence a esta quadra'; end if;
    if new.expense_id is not null and not exists(select 1 from public.finance_expenses x where x.id=new.expense_id and x.venue_id=new.venue_id and x.group_id=new.group_id) then
      raise exception 'Despesa não pertence a esta quadra'; end if;
    if tg_op='UPDATE' and (to_jsonb(new)-array['status','cancelled_at','cancelled_by','cancel_reason'])
       is distinct from (to_jsonb(old)-array['status','cancelled_at','cancelled_by','cancel_reason']) then
      raise exception 'Cobrança imutável; cancele sem pagamentos e crie uma correção auditável'; end if;
  else
    d:=new.incurred_on;
    if tg_op='UPDATE' and (to_jsonb(new)-'split_at') is distinct from (to_jsonb(old)-'split_at') then
      raise exception 'Despesa imutável; use correção auditável'; end if;
  end if;
  if exists(select 1 from public.finance_month_closings c where c.venue_id=new.venue_id and c.period=date_trunc('month',d)::date and c.status='closed') then
    raise exception 'Mês fechado; reabra o período antes de alterar obrigações'; end if;
  return new;
end $$;
create trigger finance_charges_history before insert or update or delete on public.finance_charges
for each row execute function public._fin_guard_obligation();
create trigger finance_expenses_history before insert or update or delete on public.finance_expenses
for each row execute function public._fin_guard_obligation();

-- Serialize all finance writes and month closing on the same venue lock.
-- The existing functions are replaced below without changing their public signatures.

CREATE OR REPLACE FUNCTION public.finance_save_settings(_venue_id uuid, _s jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v public.venues; old jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended((_venue_id)::text,0));
  v := public._fin_venue_for_manager(_venue_id);
  select to_jsonb(f) into old from public.finance_settings f where venue_id = _venue_id;
  insert into public.finance_settings as f (venue_id, group_id, monthly_court_cost_cents, monthly_capacity, monthly_fee_cents,
    daily_fee_cents, due_day, pix_key_type, pix_key, pix_receiver_name, payment_instructions,
    opening_balance_cents, opening_balance_date, updated_by)
  values (_venue_id, v.group_id, coalesce((_s->>'monthly_court_cost_cents')::int, 0), coalesce((_s->>'monthly_capacity')::int, 0),
    coalesce((_s->>'monthly_fee_cents')::int, 0), coalesce((_s->>'daily_fee_cents')::int, 0), coalesce((_s->>'due_day')::smallint, 10),
    nullif(_s->>'pix_key_type',''), nullif(trim(_s->>'pix_key'),''), nullif(trim(_s->>'pix_receiver_name'),''),
    nullif(trim(_s->>'payment_instructions'),''), coalesce((_s->>'opening_balance_cents')::bigint, 0),
    coalesce((_s->>'opening_balance_date')::date, public._fin_today()), auth.uid())
  on conflict (venue_id) do update set
    monthly_court_cost_cents = excluded.monthly_court_cost_cents, monthly_capacity = excluded.monthly_capacity,
    monthly_fee_cents = excluded.monthly_fee_cents, daily_fee_cents = excluded.daily_fee_cents, due_day = excluded.due_day,
    pix_key_type = excluded.pix_key_type, pix_key = excluded.pix_key, pix_receiver_name = excluded.pix_receiver_name,
    payment_instructions = excluded.payment_instructions, opening_balance_cents = excluded.opening_balance_cents,
    opening_balance_date = excluded.opening_balance_date, updated_by = auth.uid(), updated_at = now();
  insert into public.audit_logs(group_id, actor_id, action, entity, entity_id, details)
    values (v.group_id, auth.uid(), 'finance.settings_saved', 'venue', _venue_id, jsonb_build_object('before', old, 'after', _s));
end $function$
;

CREATE OR REPLACE FUNCTION public.finance_set_event_daily_fee(_event_id uuid, _cents integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ev public.events;
begin
  perform pg_advisory_xact_lock(hashtextextended(((select venue_id from public.events where id=_event_id))::text,0));
  select * into ev from public.events where id = _event_id;
  if not found then raise exception 'Evento não encontrado'; end if;
  perform public._fin_venue_for_manager(ev.venue_id);
  if _cents is not null and _cents < 0 then raise exception 'Valor inválido'; end if;
  update public.events set daily_fee_cents = nullif(_cents, 0) where id = _event_id;
  insert into public.audit_logs(group_id, actor_id, action, entity, entity_id, details)
    values (ev.group_id, auth.uid(), 'finance.event_daily_fee', 'event', _event_id,
      jsonb_build_object('before', ev.daily_fee_cents, 'after', _cents, 'venue_id', ev.venue_id));
end $function$
;

CREATE OR REPLACE FUNCTION public.finance_generate_monthly(_venue_id uuid, _period date DEFAULT NULL::date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v public.venues; s public.finance_settings; per date; due date; n int;
begin
  perform pg_advisory_xact_lock(hashtextextended((_venue_id)::text,0));
  v := public._fin_venue_for_manager(_venue_id);
  per := date_trunc('month', coalesce(_period, public._fin_today()))::date;
  if per <> date_trunc('month', public._fin_today())::date then
    raise exception 'Mensalidades recorrentes só podem ser geradas para o mês atual; use cobrança manual para outros casos';
  end if;
  select * into s from public.finance_settings where venue_id = _venue_id for update;
  if not found then raise exception 'Configure o valor mensal por jogador antes de gerar cobranças'; end if;
  due := per + (s.due_day - 1);
  insert into public.finance_charges(venue_id, group_id, player_id, kind, period, description, amount_cents, due_date, created_by, idempotency_key)
  select v.id, v.group_id, p.id, 'monthly', per, 'Mensalidade ' || to_char(per, 'MM/YYYY'), coalesce(t.monthly_fee_cents,s.monthly_fee_cents), per+(coalesce(t.due_day,s.due_day)-1), auth.uid(),
         'monthly:' || p.id || ':' || per
    from public.players p left join public.finance_player_terms t on t.player_id=p.id
   where p.venue_id = v.id and p.group_id = v.group_id and p.status = 'active'
     and p.participation_type = 'mensalista' and not p.is_event_guest and coalesce(t.monthly_fee_cents,s.monthly_fee_cents)>0
  on conflict do nothing;
  get diagnostics n = row_count;
  insert into public.audit_logs(group_id, actor_id, action, entity, entity_id, details)
    values (v.group_id, auth.uid(), 'finance.monthly_generated', 'venue', v.id, jsonb_build_object('period', per, 'created', n));
  return n;
end $function$
;

CREATE OR REPLACE FUNCTION public.finance_create_charge(_venue_id uuid, _player_id uuid, _kind text, _description text, _amount_cents bigint, _due_date date, _event_id uuid, _idempotency_key text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v public.venues; p public.players; ev public.events; k text := public._fin_require_key(_idempotency_key); cid uuid; amt bigint := _amount_cents;
begin
  perform pg_advisory_xact_lock(hashtextextended((_venue_id)::text,0));
  v := public._fin_venue_for_manager(_venue_id);
  select id into cid from public.finance_charges where venue_id = _venue_id and idempotency_key = k;
  if found then
    if not exists(select 1 from public.finance_charges where id=cid and player_id=_player_id and kind=_kind and event_id is not distinct from (case when _kind='daily' then _event_id end) and (_amount_cents is null or amount_cents=_amount_cents) and (_due_date is null or due_date=_due_date) and (nullif(trim(_description),'') is null or description=trim(_description))) then raise exception 'Chave de idempotência reutilizada com dados diferentes'; end if;
    return cid;
  end if;
  select * into p from public.players where id = _player_id and venue_id = _venue_id and group_id = v.group_id;
  if not found then raise exception 'Jogador não pertence a esta quadra'; end if;
  if _kind not in ('manual','daily') then raise exception 'Tipo de cobrança inválido'; end if;
  if _kind = 'daily' then
    select * into ev from public.events where id = _event_id and venue_id = _venue_id;
    if not found then raise exception 'Evento não pertence a esta quadra'; end if;
    if p.is_event_guest or p.participation_type = 'convidado' then raise exception 'Convidados são isentos de diária'; end if;
    if p.participation_type = 'mensalista' then raise exception 'Mensalistas não pagam diária'; end if;
    amt := coalesce(amt, ev.daily_fee_cents);
    if coalesce(amt, 0) <= 0 then raise exception 'Defina o valor da diária do evento'; end if;
    _description := coalesce(nullif(trim(_description), ''), 'Diária ' || to_char(ev.starts_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'));
    _due_date := coalesce(_due_date, (ev.starts_at at time zone 'America/Sao_Paulo')::date);
  end if;
  if amt is null or amt <= 0 then raise exception 'Valor deve ser maior que zero'; end if;
  if _due_date is null then raise exception 'Informe o vencimento'; end if;
  insert into public.finance_charges(venue_id, group_id, player_id, kind, event_id, description, amount_cents, due_date, created_by, idempotency_key)
    values (v.id, v.group_id, p.id, _kind, case when _kind = 'daily' then _event_id end, trim(_description), amt, _due_date, auth.uid(), k)
    returning id into cid;
  insert into public.audit_logs(group_id, actor_id, action, entity, entity_id, details)
    values (v.group_id, auth.uid(), 'finance.charge_created', 'finance_charge', cid,
      jsonb_build_object('player_id', p.id, 'kind', _kind, 'amount_cents', amt, 'venue_id', v.id));
  return cid;
end $function$
;

CREATE OR REPLACE FUNCTION public.finance_cancel_charge(_charge_id uuid, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c public.finance_charges;
begin
  perform pg_advisory_xact_lock(hashtextextended(((select venue_id from public.finance_charges where id=_charge_id))::text,0));
  select * into c from public.finance_charges where id = _charge_id for update;
  if not found then raise exception 'Cobrança não encontrada'; end if;
  perform public._fin_venue_for_manager(c.venue_id);
  if c.status = 'cancelled' then return; end if;
  if length(trim(coalesce(_reason, ''))) < 3 then raise exception 'Informe o motivo do cancelamento'; end if;
  if public._fin_charge_outstanding(c.id) <> c.amount_cents then
    raise exception 'Cobrança com pagamentos: estorne os pagamentos antes de cancelar';
  end if;
  update public.finance_charges set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = trim(_reason) where id = c.id;
  insert into public.audit_logs(group_id, actor_id, action, entity, entity_id, details)
    values (c.group_id, auth.uid(), 'finance.charge_cancelled', 'finance_charge', c.id, jsonb_build_object('reason', _reason, 'venue_id', c.venue_id));
end $function$
;

CREATE OR REPLACE FUNCTION public.finance_record_payment(_charge_id uuid, _amount_cents bigint, _method text, _received_on date, _notes text, _idempotency_key text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c public.finance_charges; k text := public._fin_require_key(_idempotency_key); lid uuid; outstanding bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(((select venue_id from public.finance_charges where id=_charge_id))::text,0));
  select * into c from public.finance_charges where id = _charge_id for update; -- serializes concurrent payments
  if not found then raise exception 'Cobrança não encontrada'; end if;
  perform public._fin_venue_for_manager(c.venue_id);
  select id into lid from public.finance_ledger where venue_id = c.venue_id and idempotency_key = k;
  if found then
    if not exists(select 1 from public.finance_ledger where id=lid and entry_type='payment' and charge_id=_charge_id and amount_cents=_amount_cents and method=_method and occurred_on=_received_on and notes is not distinct from nullif(trim(_notes),'')) then raise exception 'Chave de idempotência reutilizada com dados diferentes'; end if;
    return lid;
  end if;
  if c.status = 'cancelled' then raise exception 'Cobrança cancelada'; end if;
  if _method not in ('pix','dinheiro','transferencia','outro') then raise exception 'Método de pagamento inválido'; end if;
  if _amount_cents is null or _amount_cents <= 0 then raise exception 'Valor deve ser maior que zero'; end if;
  outstanding := public._fin_charge_outstanding(c.id);
  if _amount_cents > outstanding then
    raise exception 'Valor excede o saldo em aberto (R$ %)', to_char(outstanding / 100.0, 'FM999999990.00');
  end if;
  if _received_on is null or _received_on > public._fin_today() then raise exception 'Data de recebimento inválida'; end if;
  insert into public.finance_ledger(venue_id, group_id, entry_type, amount_cents, occurred_on, charge_id, player_id, method, notes, created_by, idempotency_key, category)
    values (c.venue_id, c.group_id, 'payment', _amount_cents, _received_on, c.id, c.player_id, _method, nullif(trim(_notes), ''), auth.uid(), k, c.kind)
    returning id into lid;
  insert into public.audit_logs(group_id, actor_id, action, entity, entity_id, details)
    values (c.group_id, auth.uid(), 'finance.payment_recorded', 'finance_ledger', lid,
      jsonb_build_object('charge_id', c.id, 'amount_cents', _amount_cents, 'method', _method, 'venue_id', c.venue_id));
  return lid;
end $function$
;

CREATE OR REPLACE FUNCTION public.finance_reverse_entry(_entry_id uuid, _reason text, _idempotency_key text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare e public.finance_ledger; k text := public._fin_require_key(_idempotency_key); lid uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(((select venue_id from public.finance_ledger where id=_entry_id))::text,0));
  select * into e from public.finance_ledger where id = _entry_id;
  if not found then raise exception 'Lançamento não encontrado'; end if;
  perform public._fin_venue_for_manager(e.venue_id);
  if e.charge_id is not null then perform 1 from public.finance_charges where id = e.charge_id for update; end if;
  select id into lid from public.finance_ledger where venue_id = e.venue_id and idempotency_key = k;
  if found then
    if not exists(select 1 from public.finance_ledger where id=lid and reverses_id=_entry_id and notes=trim(_reason)) then raise exception 'Chave de idempotência reutilizada com dados diferentes'; end if;
    return lid;
  end if;
  if e.entry_type not in ('payment','expense') then raise exception 'Somente pagamentos e despesas pagas podem ser estornados'; end if;
  if exists (select 1 from public.finance_ledger where reverses_id = e.id) then raise exception 'Lançamento já estornado'; end if;
  if length(trim(coalesce(_reason, ''))) < 3 then raise exception 'Informe o motivo do estorno'; end if;
  insert into public.finance_ledger(venue_id, group_id, entry_type, amount_cents, occurred_on, charge_id, player_id, expense_id,
      reverses_id, method, category, notes, created_by, idempotency_key)
    values (e.venue_id, e.group_id, case when e.entry_type = 'payment' then 'payment_reversal' else 'expense_reversal' end,
      -e.amount_cents, public._fin_today(), e.charge_id, e.player_id, e.expense_id, e.id, e.method, e.category, trim(_reason), auth.uid(), k)
    returning id into lid;
  insert into public.audit_logs(group_id, actor_id, action, entity, entity_id, details)
    values (e.group_id, auth.uid(), 'finance.entry_reversed', 'finance_ledger', lid, jsonb_build_object('reverses', e.id, 'reason', _reason, 'venue_id', e.venue_id));
  return lid;
end $function$
;

CREATE OR REPLACE FUNCTION public.finance_adjust_balance(_venue_id uuid, _amount_cents bigint, _occurred_on date, _reason text, _idempotency_key text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v public.venues; k text := public._fin_require_key(_idempotency_key); lid uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended((_venue_id)::text,0));
  v := public._fin_venue_for_manager(_venue_id);
  select id into lid from public.finance_ledger where venue_id = v.id and idempotency_key = k;
  if found then
    if not exists(select 1 from public.finance_ledger where id=lid and entry_type='adjustment' and amount_cents=_amount_cents and occurred_on=coalesce(_occurred_on,public._fin_today()) and notes=trim(_reason)) then raise exception 'Chave de idempotência reutilizada com dados diferentes'; end if;
    return lid;
  end if;
  if coalesce(_amount_cents, 0) = 0 then raise exception 'Valor do ajuste não pode ser zero'; end if;
  if length(trim(coalesce(_reason, ''))) < 3 then raise exception 'Informe o motivo do ajuste'; end if;
  insert into public.finance_ledger(venue_id, group_id, entry_type, amount_cents, occurred_on, notes, created_by, idempotency_key, category)
    values (v.id, v.group_id, 'adjustment', _amount_cents, coalesce(_occurred_on, public._fin_today()), trim(_reason), auth.uid(), k, 'ajuste')
    returning id into lid;
  insert into public.audit_logs(group_id, actor_id, action, entity, entity_id, details)
    values (v.group_id, auth.uid(), 'finance.adjustment', 'finance_ledger', lid, jsonb_build_object('amount_cents', _amount_cents, 'reason', _reason, 'venue_id', v.id));
  return lid;
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
    if _paid_on is not null and not exists(select 1 from public.finance_ledger where expense_id=eid and entry_type='expense' and occurred_on=_paid_on) then raise exception 'Chave de idempotência reutilizada com dados diferentes'; end if;
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

CREATE OR REPLACE FUNCTION public.finance_pay_expense(_expense_id uuid, _paid_on date, _idempotency_key text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare x public.finance_expenses; k text := public._fin_require_key(_idempotency_key); lid uuid; net bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(((select venue_id from public.finance_expenses where id=_expense_id))::text,0));
  select * into x from public.finance_expenses where id = _expense_id for update;
  if not found then raise exception 'Despesa não encontrada'; end if;
  perform public._fin_venue_for_manager(x.venue_id);
  select id into lid from public.finance_ledger where venue_id = x.venue_id and idempotency_key = k;
  if found then
    if not exists(select 1 from public.finance_ledger where id=lid and entry_type='expense' and expense_id=_expense_id and occurred_on=_paid_on) then raise exception 'Chave de idempotência reutilizada com dados diferentes'; end if;
    return lid;
  end if;
  select coalesce(sum(amount_cents), 0) into net from public.finance_ledger where expense_id = x.id and entry_type in ('expense','expense_reversal');
  if net <> 0 then raise exception 'Despesa já está paga'; end if;
  if _paid_on is null or _paid_on > public._fin_today() then raise exception 'Data de pagamento inválida'; end if;
  insert into public.finance_ledger(venue_id, group_id, entry_type, amount_cents, occurred_on, expense_id, category, notes, created_by, idempotency_key)
    values (x.venue_id, x.group_id, 'expense', -x.amount_cents, _paid_on, x.id, x.category, x.description, auth.uid(), k)
    returning id into lid;
  return lid;
end $function$
;

CREATE OR REPLACE FUNCTION public.finance_split_expense(_expense_id uuid, _target text, _mode text, _player_ids uuid[], _amounts bigint[], _event_id uuid, _due_date date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare x public.finance_expenses; ids uuid[]; n int; base bigint; rem bigint; i int; amt bigint; total bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(((select venue_id from public.finance_expenses where id=_expense_id))::text,0));
  select * into x from public.finance_expenses where id = _expense_id for update;
  if not found then raise exception 'Despesa não encontrada'; end if;
  perform public._fin_venue_for_manager(x.venue_id);
  if x.split_at is not null then raise exception 'Esta despesa já foi rateada'; end if;
  if _due_date is null then raise exception 'Informe o vencimento das parcelas'; end if;
  if _target = 'monthly' then
    select array_agg(p.id order by p.name, p.id) into ids from public.players p where p.venue_id = x.venue_id and p.status = 'active'
      and p.participation_type = 'mensalista' and not p.is_event_guest;
  elsif _target = 'selected' then
    select array_agg(p.id order by array_position(_player_ids, p.id)) into ids from public.players p
      where p.id = any(_player_ids) and p.venue_id = x.venue_id and not p.is_event_guest and p.participation_type <> 'convidado';
    if coalesce(array_length(ids, 1), 0) <> coalesce(array_length(_player_ids, 1), 0) then
      raise exception 'Seleção contém jogadores de outra quadra ou convidados';
    end if;
  elsif _target = 'event' then
    if not exists (select 1 from public.events where id = _event_id and venue_id = x.venue_id) then raise exception 'Evento não pertence a esta quadra'; end if;
    select array_agg(p.id order by p.name, p.id) into ids from public.attendances a join public.players p on p.id = a.player_id
      where a.event_id = _event_id and a.status = 'confirmed' and a.attended = true
        and p.venue_id=x.venue_id and p.group_id=x.group_id and not p.is_event_guest and p.participation_type <> 'convidado';
  else raise exception 'Destino de rateio inválido'; end if;
  n := coalesce(array_length(ids, 1), 0);
  if n = 0 then raise exception 'Nenhum participante elegível para o rateio'; end if;
  if _mode is null or _target is null then raise exception 'Modo e destino obrigatórios'; end if;
  if _mode = 'custom' then
    if coalesce(array_length(_amounts, 1), 0) <> n or _target <> 'selected' then raise exception 'Informe um valor para cada jogador selecionado'; end if;
    select sum(a) into total from unnest(_amounts) a;
    if total <> x.amount_cents then raise exception 'A soma das parcelas (% centavos) difere do total (% centavos)', total, x.amount_cents; end if;
    if exists (select 1 from unnest(_amounts) a where a is null or a <= 0) then raise exception 'Parcelas devem ser maiores que zero'; end if;
  elsif _mode <> 'equal' then raise exception 'Modo de rateio inválido'; end if;
  base := x.amount_cents / n; rem := x.amount_cents % n;
  for i in 1..n loop
    amt := case when _mode = 'custom' then _amounts[i] else base + case when i <= rem then 1 else 0 end end;
    if amt > 0 then
      insert into public.finance_charges(venue_id, group_id, player_id, kind, expense_id, description, amount_cents, due_date, created_by, idempotency_key)
        values (x.venue_id, x.group_id, ids[i], 'expense_share', x.id, 'Rateio: ' || x.description, amt, _due_date, auth.uid(), 'share:' || x.id || ':' || ids[i]);
    end if;
  end loop;
  update public.finance_expenses set split_at = now() where id = x.id;
  insert into public.audit_logs(group_id, actor_id, action, entity, entity_id, details)
    values (x.group_id, auth.uid(), 'finance.expense_split', 'finance_expense', x.id, jsonb_build_object('target', _target, 'mode', _mode, 'players', n, 'venue_id', x.venue_id));
  return n;
end $function$
;

CREATE OR REPLACE FUNCTION public.finance_close_month(_venue_id uuid, _period date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v public.venues; per date := date_trunc('month', _period)::date; snap jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended((_venue_id)::text,0));
  if _period is null then raise exception 'Período financeiro inválido'; end if;
  v := public._fin_venue_for_manager(_venue_id);
  if per >= date_trunc('month', public._fin_today())::date then raise exception 'Só é possível fechar meses já concluídos'; end if;
  if exists (select 1 from public.finance_month_closings where venue_id = v.id and period = per and status = 'closed') then
    raise exception 'Mês já está fechado';
  end if;
  snap := public.finance_summary(v.id, per, (per + interval '1 month - 1 day')::date);
  insert into public.finance_month_closings(venue_id, group_id, period, status, closed_by, closed_at, snapshot)
    values (v.id, v.group_id, per, 'closed', auth.uid(), now(), snap)
  on conflict (venue_id, period) do update set status = 'closed', closed_by = auth.uid(), closed_at = now(), snapshot = excluded.snapshot;
  insert into public.audit_logs(group_id, actor_id, action, entity, entity_id, details)
    values (v.group_id, auth.uid(), 'finance.month_closed', 'venue', v.id, jsonb_build_object('period', per, 'snapshot', snap));
end $function$
;

CREATE OR REPLACE FUNCTION public.finance_reopen_month(_venue_id uuid, _period date, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v public.venues; per date := date_trunc('month', _period)::date;
begin
  perform pg_advisory_xact_lock(hashtextextended((_venue_id)::text,0));
  if _period is null then raise exception 'Período financeiro inválido'; end if;
  v := public._fin_venue_for_manager(_venue_id);
  if not public.is_group_admin(v.group_id) then raise exception 'Somente o administrador pode reabrir um mês'; end if;
  if length(trim(coalesce(_reason, ''))) < 5 then raise exception 'Informe o motivo da reabertura'; end if;
  update public.finance_month_closings set status = 'reopened', reopened_by = auth.uid(), reopened_at = now(), reopen_reason = trim(_reason)
    where venue_id = v.id and period = per and status = 'closed';
  if not found then raise exception 'Mês não está fechado'; end if;
  insert into public.audit_logs(group_id, actor_id, action, entity, entity_id, details)
    values (v.group_id, auth.uid(), 'finance.month_reopened', 'venue', v.id, jsonb_build_object('period', per, 'reason', _reason));
end $function$
;

CREATE OR REPLACE FUNCTION public.finance_generate_due_monthly()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  today date := public._fin_today();
  per date := date_trunc('month', public._fin_today())::date;
  cfg record;
  created integer;
  total integer := 0;
begin
  for cfg in
    select s.venue_id, s.group_id, s.monthly_fee_cents, s.due_day
      from public.finance_settings s
     where true
     order by s.venue_id
  loop
    perform pg_advisory_xact_lock(hashtextextended(cfg.venue_id::text, 0));
    insert into public.finance_charges(venue_id, group_id, player_id, kind, period, description,
      amount_cents, due_date, created_by, idempotency_key)
    select cfg.venue_id, cfg.group_id, p.id, 'monthly', per,
      'Mensalidade ' || to_char(per, 'MM/YYYY'), coalesce(t.monthly_fee_cents,cfg.monthly_fee_cents),
      per + (coalesce(t.due_day,cfg.due_day) - 1), null, 'monthly:' || p.id || ':' || per
      from public.players p left join public.finance_player_terms t on t.player_id=p.id
     where p.venue_id = cfg.venue_id and p.group_id = cfg.group_id and p.status = 'active'
       and p.participation_type = 'mensalista' and not p.is_event_guest
       and coalesce(t.monthly_fee_cents,cfg.monthly_fee_cents)>0 and coalesce(t.due_day,cfg.due_day)<=extract(day from today)::int
    on conflict do nothing;
    get diagnostics created = row_count;
    total := total + created;
    if created > 0 then
      insert into public.audit_logs(group_id, actor_id, action, entity, entity_id, details)
        values (cfg.group_id, null, 'finance.monthly_generated_automatic', 'venue', cfg.venue_id,
          jsonb_build_object('period', per, 'created', created, 'due_day', cfg.due_day));
    end if;
  end loop;
  return total;
end $function$
;

CREATE OR REPLACE FUNCTION public._fin_guard_ledger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op <> 'INSERT' then raise exception 'Lançamentos do caixa não podem ser alterados nem excluídos; use estorno ou ajuste'; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.venue_id::text,0));
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

CREATE OR REPLACE FUNCTION public.finance_summary(_venue_id uuid, _from date, _to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v public.venues;
  s public.finance_settings;
  bal bigint;
  today date := public._fin_today();
  period_end date;
begin
  if _from is null or _to is null or _from > _to then raise exception 'Período financeiro inválido'; end if;
  v := public._fin_venue_for_manager(_venue_id);
  select * into s from public.finance_settings where venue_id = v.id;
  period_end := least(_to, today);
  select coalesce(s.opening_balance_cents, 0) + coalesce(sum(amount_cents), 0) into bal
    from public.finance_ledger
   where venue_id = v.id and occurred_on >= coalesce(s.opening_balance_date, '-infinity'::date)
     and occurred_on <= today;
  return jsonb_build_object(
    'balance_cents', bal,
    'opening_balance_cents', coalesce(s.opening_balance_cents, 0), 'opening_balance_date', s.opening_balance_date,
    'receivable_cents', (select coalesce(sum(outstanding_cents), 0) from public.finance_charge_balances where venue_id = v.id and status = 'open' and due_date >= today),
    'overdue_cents', (select coalesce(sum(outstanding_cents), 0) from public.finance_charge_balances where venue_id = v.id and status = 'open' and due_date < today),
    'period_in_cents', (select coalesce(sum(amount_cents), 0) from public.finance_ledger where venue_id = v.id and occurred_on between _from and period_end and entry_type in ('payment','payment_reversal')),
    'period_out_cents', (select coalesce(-sum(amount_cents), 0) from public.finance_ledger where venue_id = v.id and occurred_on between _from and period_end and entry_type in ('expense','expense_reversal')),
    'period_adjust_cents', (select coalesce(sum(amount_cents), 0) from public.finance_ledger where venue_id = v.id and occurred_on between _from and period_end and entry_type = 'adjustment'),
    'period_starting_balance_cents', case when s.opening_balance_date>_from then null else coalesce(s.opening_balance_cents,0)+coalesce((select sum(amount_cents) from public.finance_ledger where venue_id=v.id and occurred_on>=s.opening_balance_date and occurred_on<_from),0) end,
    'expense_pending_cents', (select coalesce(sum(greatest(x.amount_cents+coalesce((select sum(l.amount_cents) from public.finance_ledger l where l.expense_id=x.id and l.entry_type in ('expense','expense_reversal')),0),0)),0) from public.finance_expenses x where x.venue_id=v.id),
    'period_ending_balance_cents', case when s.opening_balance_date is null or s.opening_balance_date > period_end then null else
      coalesce(s.opening_balance_cents, 0) + coalesce((select sum(l.amount_cents) from public.finance_ledger l
        where l.venue_id = v.id and l.occurred_on >= s.opening_balance_date and l.occurred_on <= period_end), 0) end,
    'period_receivable_cents', (select coalesce(sum(greatest(c.amount_cents - coalesce((select sum(l.amount_cents)
        from public.finance_ledger l where l.charge_id = c.id and l.entry_type in ('payment','payment_reversal')
          and l.occurred_on <= period_end), 0), 0)), 0)
      from public.finance_charges c where c.venue_id = v.id and (c.status='open' or (c.cancelled_at at time zone 'America/Sao_Paulo')::date>period_end) and (c.created_at at time zone 'America/Sao_Paulo')::date <= period_end),
    'period_overdue_cents', (select coalesce(sum(greatest(c.amount_cents - coalesce((select sum(l.amount_cents)
        from public.finance_ledger l where l.charge_id = c.id and l.entry_type in ('payment','payment_reversal')
          and l.occurred_on <= period_end), 0), 0)), 0)
      from public.finance_charges c where c.venue_id = v.id and (c.status='open' or (c.cancelled_at at time zone 'America/Sao_Paulo')::date>period_end)
        and (c.created_at at time zone 'America/Sao_Paulo')::date <= period_end and c.due_date <= period_end),
    'period_expense_pending_cents', (select coalesce(sum(greatest(x.amount_cents - coalesce((select -sum(l.amount_cents)
        from public.finance_ledger l where l.expense_id = x.id and l.entry_type in ('expense','expense_reversal')
          and l.occurred_on <= period_end), 0), 0)), 0)
      from public.finance_expenses x where x.venue_id = v.id and (x.created_at at time zone 'America/Sao_Paulo')::date <= period_end),
    'by_category', (select coalesce(jsonb_object_agg(cat, total), '{}') from (select coalesce(category, entry_type) cat, sum(amount_cents) total
        from public.finance_ledger where venue_id = v.id and occurred_on between _from and period_end group by 1) t)
  );
end $function$
;

CREATE OR REPLACE FUNCTION public.finance_get_instructions(_venue_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v public.venues; s public.finance_settings; active_monthly int; mgr boolean;
begin
  select * into v from public.venues where id = _venue_id;
  if not found or not (public.is_court_member(_venue_id) or public.can_manage_finance(v.group_id)) then
    raise exception 'Sem acesso a esta quadra';
  end if;
  select * into s from public.finance_settings where venue_id = _venue_id;
  mgr := public.can_manage_finance(v.group_id);
  select count(*) into active_monthly from public.players p where p.venue_id = _venue_id and p.status = 'active'
    and p.participation_type = 'mensalista' and not p.is_event_guest;
  return jsonb_build_object(
    'finance_version', 15, 'configured', s.venue_id is not null, 'due_day', s.due_day, 'pix_key_type', s.pix_key_type, 'pix_key', s.pix_key,
    'pix_receiver_name', s.pix_receiver_name, 'payment_instructions', s.payment_instructions,
    'monthly_fee_cents', s.monthly_fee_cents, 'daily_fee_cents', s.daily_fee_cents,
    'scenarios', case when mgr then jsonb_build_object(
      'active_monthly_players', active_monthly,
      'per_active_monthly_cents', case when active_monthly > 0 then ceil(coalesce(s.monthly_court_cost_cents,0)::numeric / active_monthly) end,
      'per_capacity_cents', case when coalesce(s.monthly_capacity,0) > 0 then ceil(s.monthly_court_cost_cents::numeric / s.monthly_capacity) end)
    end);
end $function$
;

revoke all on function public._fin_guard_settings(), public._fin_guard_obligation() from public,anon,authenticated;
notify pgrst, 'reload schema';
