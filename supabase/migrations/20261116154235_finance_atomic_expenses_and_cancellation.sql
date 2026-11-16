-- Additive continuation: atomic expense + split and audited cancellation.
alter table public.finance_expenses add column cancelled_at timestamptz;
alter table public.finance_expenses add column cancelled_by uuid references auth.users(id);
alter table public.finance_expenses add column cancel_reason text;

create or replace function public.finance_record_expense_with_split(
  _venue_id uuid, _description text, _category text, _incurred_on date, _due_on date,
  _amount_cents bigint, _paid_on date, _notes text, _idempotency_key text,
  _target text, _mode text, _player_ids uuid[], _amounts bigint[], _event_id uuid, _due_date date
) returns uuid language plpgsql security definer set search_path=public as $$
declare eid uuid; spec jsonb; old_spec jsonb;
begin
  perform public._fin_venue_for_manager(_venue_id);
  perform pg_advisory_xact_lock(hashtextextended(_venue_id::text,0));
  spec:=jsonb_build_object('target',_target,'mode',_mode,'player_ids',_player_ids,'amounts',_amounts,'event_id',_event_id,'due_date',_due_date);
  eid:=public.finance_record_expense(_venue_id,_description,_category,_incurred_on,_due_on,_amount_cents,_paid_on,_notes,_idempotency_key);
  select details into old_spec from public.audit_logs where entity='finance_expense' and entity_id=eid and action='finance.expense_created_with_split' order by created_at desc limit 1;
  if found then
    if old_spec is distinct from spec then raise exception 'Chave de idempotência reutilizada com rateio diferente'; end if;
    return eid;
  end if;
  if _target is null then raise exception 'Informe a regra de rateio'; end if;
  if _target<>'none' then
    perform public.finance_split_expense(eid,_target,_mode,_player_ids,_amounts,_event_id,_due_date);
  end if;
  insert into public.audit_logs(group_id,actor_id,action,entity,entity_id,details)
    select group_id,auth.uid(),'finance.expense_created_with_split','finance_expense',eid,spec from public.finance_expenses where id=eid;
  return eid;
end $$;
revoke all on function public.finance_record_expense_with_split(uuid,text,text,date,date,bigint,date,text,text,text,text,uuid[],bigint[],uuid,date) from public,anon;
grant execute on function public.finance_record_expense_with_split(uuid,text,text,date,date,bigint,date,text,text,text,text,uuid[],bigint[],uuid,date) to authenticated,service_role;

create or replace function public.finance_cancel_expense(_expense_id uuid,_reason text) returns void
language plpgsql security definer set search_path=public as $$
declare x public.finance_expenses; c record;
begin
  perform pg_advisory_xact_lock(hashtextextended((select venue_id::text from public.finance_expenses where id=_expense_id),0));
  select * into x from public.finance_expenses where id=_expense_id for update;
  if not found then raise exception 'Despesa não encontrada'; end if;
  perform public._fin_venue_for_manager(x.venue_id);
  if x.cancelled_at is not null then return; end if;
  if length(trim(coalesce(_reason,'')))<3 then raise exception 'Informe o motivo do cancelamento'; end if;
  if (select coalesce(sum(amount_cents),0) from public.finance_ledger where expense_id=x.id)<>0 then
    raise exception 'Estorne o pagamento da despesa antes de cancelar'; end if;
  if exists(select 1 from public.finance_charge_balances where expense_id=x.id and paid_cents<>0) then
    raise exception 'Estorne os recebimentos das parcelas antes de cancelar'; end if;
  for c in select id from public.finance_charges where expense_id=x.id and status='open' order by id loop
    perform public.finance_cancel_charge(c.id,_reason);
  end loop;
  update public.finance_expenses set cancelled_at=now(),cancelled_by=auth.uid(),cancel_reason=trim(_reason) where id=x.id;
  insert into public.audit_logs(group_id,actor_id,action,entity,entity_id,details)
    values(x.group_id,auth.uid(),'finance.expense_cancelled','finance_expense',x.id,jsonb_build_object('reason',_reason));
end $$;
revoke all on function public.finance_cancel_expense(uuid,text) from public,anon;
grant execute on function public.finance_cancel_expense(uuid,text) to authenticated,service_role;

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
    if tg_op='UPDATE' and (to_jsonb(new)-array['split_at','cancelled_at','cancelled_by','cancel_reason']) is distinct from (to_jsonb(old)-array['split_at','cancelled_at','cancelled_by','cancel_reason']) then
      raise exception 'Despesa imutável; use correção auditável'; end if;
  end if;
  if exists(select 1 from public.finance_month_closings c where c.venue_id=new.venue_id and c.period=date_trunc('month',d)::date and c.status='closed') then
    raise exception 'Mês fechado; reabra o período antes de alterar obrigações'; end if;
  return new;
end $$;


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
    'expense_pending_cents', (select coalesce(sum(greatest(x.amount_cents+coalesce((select sum(l.amount_cents) from public.finance_ledger l where l.expense_id=x.id and l.entry_type in ('expense','expense_reversal')),0),0)),0) from public.finance_expenses x where x.venue_id=v.id and x.cancelled_at is null),
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
      from public.finance_expenses x where x.venue_id = v.id and (x.cancelled_at is null or (x.cancelled_at at time zone 'America/Sao_Paulo')::date>period_end) and (x.created_at at time zone 'America/Sao_Paulo')::date <= period_end),
    'by_category', (select coalesce(jsonb_object_agg(cat, total), '{}') from (select coalesce(category, entry_type) cat, sum(amount_cents) total
        from public.finance_ledger where venue_id = v.id and occurred_on between _from and period_end group by 1) t)
  );
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
  if x.cancelled_at is not null then raise exception 'Despesa cancelada'; end if;
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
  if x.cancelled_at is not null then raise exception 'Despesa cancelada'; end if;
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
    'finance_version', 16, 'configured', s.venue_id is not null, 'due_day', s.due_day, 'pix_key_type', s.pix_key_type, 'pix_key', s.pix_key,
    'pix_receiver_name', s.pix_receiver_name, 'payment_instructions', s.payment_instructions,
    'monthly_fee_cents', s.monthly_fee_cents, 'daily_fee_cents', s.daily_fee_cents,
    'scenarios', case when mgr then jsonb_build_object(
      'active_monthly_players', active_monthly,
      'per_active_monthly_cents', case when active_monthly > 0 then ceil(coalesce(s.monthly_court_cost_cents,0)::numeric / active_monthly) end,
      'per_capacity_cents', case when coalesce(s.monthly_capacity,0) > 0 then ceil(s.monthly_court_cost_cents::numeric / s.monthly_capacity) end)
    end);
end $function$
;
notify pgrst, 'reload schema';
