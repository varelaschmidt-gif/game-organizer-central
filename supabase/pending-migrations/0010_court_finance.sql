-- 0010 — Módulo financeiro da quadra (PENDENTE DE APROVAÇÃO — NÃO APLICADA)
-- Somente acréscimos. Nenhuma tabela/coluna existente é removida ou alterada de tipo.
-- Todos os valores em centavos inteiros. Todas as escritas passam por RPCs security definer.
-- Supabase Cron (pg_cron) agenda a geração recorrente das mensalidades.
create extension if not exists pg_cron;
-- Única função existente substituída: rsvp_confirm (implementação da 0008 reproduzida
-- integralmente + verificação financeira para autoconfirmação).

-- ---------------------------------------------------------------- helpers
create or replace function public._fin_today() returns date
language sql stable set search_path = public as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;

create or replace function public.can_manage_finance(_group_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_group_permission(_group_id, 'finance') $$;

-- ---------------------------------------------------------------- events: diária por evento
alter table public.events add column if not exists daily_fee_cents integer
  check (daily_fee_cents is null or daily_fee_cents between 0 and 10000000);
comment on column public.events.daily_fee_cents is 'Diária cobrada de avulsos neste evento; null/0 = sem cobrança';

-- ---------------------------------------------------------------- settings (1 por quadra)
create table public.finance_settings (
  venue_id uuid primary key references public.venues(id) on delete restrict,
  group_id uuid not null references public.groups(id) on delete restrict,
  monthly_court_cost_cents integer not null default 0 check (monthly_court_cost_cents between 0 and 1000000000),
  monthly_capacity integer not null default 0 check (monthly_capacity between 0 and 1000),
  monthly_fee_cents integer not null default 0 check (monthly_fee_cents between 0 and 100000000),
  daily_fee_cents integer not null default 0 check (daily_fee_cents between 0 and 10000000),
  due_day smallint not null default 10 check (due_day between 1 and 28),
  pix_key_type text check (pix_key_type is null or pix_key_type in ('cpf','cnpj','email','telefone','aleatoria')),
  pix_key text check (pix_key is null or length(pix_key) <= 140),
  pix_receiver_name text check (pix_receiver_name is null or length(pix_receiver_name) <= 120),
  payment_instructions text check (payment_instructions is null or length(payment_instructions) <= 2000),
  opening_balance_cents bigint not null default 0,
  opening_balance_date date not null default current_date,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.finance_settings to authenticated;
grant all on public.finance_settings to service_role;
alter table public.finance_settings enable row level security;
create policy "finance managers read settings" on public.finance_settings for select to authenticated
  using (public.can_manage_finance(group_id));

-- ---------------------------------------------------------------- expenses
create table public.finance_expenses (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete restrict,
  group_id uuid not null references public.groups(id) on delete restrict,
  description text not null check (length(trim(description)) between 2 and 200),
  category text not null check (length(trim(category)) between 2 and 60),
  incurred_on date not null,
  due_on date,
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 1000000000),
  notes text check (notes is null or length(notes) <= 2000),
  split_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  idempotency_key text not null,
  unique (venue_id, idempotency_key)
);
grant select on public.finance_expenses to authenticated;
grant all on public.finance_expenses to service_role;
alter table public.finance_expenses enable row level security;
create policy "finance managers read expenses" on public.finance_expenses for select to authenticated
  using (public.can_manage_finance(group_id));

-- ---------------------------------------------------------------- charges (contas a receber)
create table public.finance_charges (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete restrict,
  group_id uuid not null references public.groups(id) on delete restrict,
  player_id uuid not null references public.players(id) on delete restrict,
  kind text not null check (kind in ('monthly','daily','expense_share','manual')),
  period date check (period is null or extract(day from period) = 1),
  event_id uuid references public.events(id) on delete restrict,
  expense_id uuid references public.finance_expenses(id) on delete restrict,
  description text not null check (length(trim(description)) between 2 and 200),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 1000000000),
  due_date date not null,
  status text not null default 'open' check (status in ('open','cancelled')),
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  idempotency_key text not null,
  unique (venue_id, idempotency_key),
  check ((kind = 'monthly') = (period is not null)),
  check (kind <> 'daily' or event_id is not null),
  check (kind <> 'expense_share' or expense_id is not null)
);
create unique index finance_charges_monthly_once on public.finance_charges(venue_id, player_id, period) where kind = 'monthly';
create unique index finance_charges_daily_once on public.finance_charges(event_id, player_id) where kind = 'daily' and status = 'open';
create unique index finance_charges_share_once on public.finance_charges(expense_id, player_id) where kind = 'expense_share';
create index finance_charges_player_idx on public.finance_charges(player_id, due_date);
create index finance_charges_venue_idx on public.finance_charges(venue_id, due_date);
grant select on public.finance_charges to authenticated;
grant all on public.finance_charges to service_role;
alter table public.finance_charges enable row level security;
create policy "finance managers or own player read charges" on public.finance_charges for select to authenticated
  using (public.can_manage_finance(group_id)
    or exists (select 1 from public.players p where p.id = player_id and p.user_id = auth.uid()));

-- ---------------------------------------------------------------- ledger (caixa: só movimentações reais)
create table public.finance_ledger (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete restrict,
  group_id uuid not null references public.groups(id) on delete restrict,
  entry_type text not null check (entry_type in ('payment','payment_reversal','expense','expense_reversal','adjustment')),
  amount_cents bigint not null check (amount_cents <> 0),
  occurred_on date not null,
  charge_id uuid references public.finance_charges(id) on delete restrict,
  player_id uuid references public.players(id) on delete restrict,
  expense_id uuid references public.finance_expenses(id) on delete restrict,
  reverses_id uuid unique references public.finance_ledger(id) on delete restrict,
  method text check (method is null or method in ('pix','dinheiro','transferencia','outro')),
  category text,
  notes text check (notes is null or length(notes) <= 2000),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  idempotency_key text not null,
  unique (venue_id, idempotency_key),
  check (entry_type not in ('payment') or (amount_cents > 0 and charge_id is not null and method is not null)),
  check (entry_type not in ('expense') or (amount_cents < 0 and expense_id is not null)),
  check (entry_type not in ('payment_reversal','expense_reversal') or reverses_id is not null)
);
create index finance_ledger_venue_idx on public.finance_ledger(venue_id, occurred_on);
create index finance_ledger_charge_idx on public.finance_ledger(charge_id);
grant select on public.finance_ledger to authenticated;
grant all on public.finance_ledger to service_role;
alter table public.finance_ledger enable row level security;
create policy "finance managers or own player read ledger" on public.finance_ledger for select to authenticated
  using (public.can_manage_finance(group_id)
    or (player_id is not null and exists (select 1 from public.players p where p.id = player_id and p.user_id = auth.uid())));

-- ---------------------------------------------------------------- monthly closings
create table public.finance_month_closings (
  venue_id uuid not null references public.venues(id) on delete restrict,
  group_id uuid not null references public.groups(id) on delete restrict,
  period date not null check (extract(day from period) = 1),
  status text not null check (status in ('closed','reopened')),
  closed_by uuid not null,
  closed_at timestamptz not null,
  reopened_by uuid,
  reopened_at timestamptz,
  reopen_reason text,
  snapshot jsonb not null default '{}',
  primary key (venue_id, period)
);
grant select on public.finance_month_closings to authenticated;
grant all on public.finance_month_closings to service_role;
alter table public.finance_month_closings enable row level security;
create policy "finance managers read closings" on public.finance_month_closings for select to authenticated
  using (public.can_manage_finance(group_id));

-- Ledger rows are append-only and cannot land in a closed month.
create or replace function public._fin_guard_ledger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op <> 'INSERT' then raise exception 'Lançamentos do caixa não podem ser alterados nem excluídos; use estorno ou ajuste'; end if;
  if exists (select 1 from public.finance_month_closings c where c.venue_id = new.venue_id
      and c.period = date_trunc('month', new.occurred_on)::date and c.status = 'closed') then
    raise exception 'O mês de % está fechado; reabra-o ou lance com a data atual', to_char(new.occurred_on, 'MM/YYYY');
  end if;
  return new;
end $$;
create trigger trg_fin_guard_ledger before insert or update or delete on public.finance_ledger
  for each row execute function public._fin_guard_ledger();
revoke all on function public._fin_guard_ledger() from public, anon, authenticated;

-- ---------------------------------------------------------------- derived balances (RLS of base tables applies)
create view public.finance_charge_balances with (security_invoker = true) as
select c.*,
  coalesce((select sum(l.amount_cents) from public.finance_ledger l
     where l.charge_id = c.id and l.entry_type in ('payment','payment_reversal')), 0)::bigint as paid_cents,
  case when c.status = 'cancelled' then 0 else greatest(c.amount_cents - coalesce((select sum(l.amount_cents)
     from public.finance_ledger l where l.charge_id = c.id and l.entry_type in ('payment','payment_reversal')), 0), 0) end::bigint as outstanding_cents
from public.finance_charges c;
grant select on public.finance_charge_balances to authenticated, service_role;

create or replace function public._fin_charge_outstanding(_charge_id uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select c.amount_cents - coalesce((select sum(l.amount_cents) from public.finance_ledger l
    where l.charge_id = c.id and l.entry_type in ('payment','payment_reversal')), 0)
  from public.finance_charges c where c.id = _charge_id $$;
revoke all on function public._fin_charge_outstanding(uuid) from public, anon, authenticated;

create or replace function public.finance_player_overdue_cents(_player_id uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(greatest(public._fin_charge_outstanding(c.id), 0)), 0)::bigint
  from public.finance_charges c
  where c.player_id = _player_id and c.status = 'open' and c.due_date < public._fin_today()
    and (public.can_manage_finance(c.group_id)
      or exists (select 1 from public.players p where p.id = _player_id and p.user_id = auth.uid())) $$;
revoke all on function public.finance_player_overdue_cents(uuid) from public, anon;
grant execute on function public.finance_player_overdue_cents(uuid) to authenticated;

-- Raises when a player may not self-confirm for financial reasons.
create or replace function public._fin_assert_can_confirm(_ev public.events, _player_id uuid) returns void
language plpgsql stable security definer set search_path = public as $$
declare p public.players; overdue bigint; paid_ok boolean;
begin
  select * into p from public.players where id = _player_id;
  if p.is_event_guest or p.participation_type = 'convidado' then return; end if;
  if p.participation_type = 'mensalista' then
    select coalesce(sum(greatest(public._fin_charge_outstanding(c.id), 0)), 0) into overdue
      from public.finance_charges c
      where c.player_id = _player_id and c.venue_id = _ev.venue_id and c.status = 'open' and c.due_date < public._fin_today();
    if overdue > 0 then
      raise exception 'Pagamento em atraso (R$ %): regularize com o administrador para confirmar presença',
        to_char(overdue / 100.0, 'FM999999990.00');
    end if;
  elsif p.participation_type = 'avulso' and coalesce(_ev.daily_fee_cents, 0) > 0 then
    select exists (select 1 from public.finance_charges c where c.event_id = _ev.id and c.player_id = _player_id
        and c.kind = 'daily' and c.status = 'open' and public._fin_charge_outstanding(c.id) <= 0) into paid_ok;
    if not paid_ok then
      raise exception 'Diária pendente: a presença só pode ser confirmada após o administrador conferir o pagamento';
    end if;
  end if;
end $$;
revoke all on function public._fin_assert_can_confirm(public.events, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- rsvp_confirm (0008 + finance check)
create or replace function public.rsvp_confirm(_event_id uuid, _player_id uuid default null)
returns text language plpgsql security definer set search_path to 'public' as $$
declare ev public.events; p public.players; pid uuid; cur public.attendances; taken int; is_adm boolean; st text; overdue bigint := 0; has_attendance boolean; on_behalf boolean;
begin
  ev := public._lock_event(_event_id);
  pid := public._resolve_player(ev, _player_id);
  is_adm := public.is_group_admin(ev.group_id);
  on_behalf := not exists(select 1 from public.players where id=pid and user_id=auth.uid());
  if ev.status <> 'scheduled' then raise exception 'Este evento não está aberto'; end if;
  if not is_adm and ev.confirm_deadline is not null and now() > ev.confirm_deadline then raise exception 'Prazo de confirmação encerrado'; end if;
  select * into p from public.players where id=pid;
  if p.status <> 'active' and not is_adm then raise exception 'Jogador inativo ou suspenso'; end if;
  perform public._expire_offers(_event_id);
  select * into cur from public.attendances where event_id=_event_id and player_id=pid for update;
  has_attendance := found;
  if has_attendance and cur.status in ('confirmed','waitlist') then return cur.status; end if;
  -- Finance (0010): players cannot self-confirm while overdue or before avulso payment.
  -- An administrator may override monthly arrears, but not an unpaid event daily fee.
  if not is_adm or p.participation_type <> 'mensalista' or p.is_event_guest then
    perform public._fin_assert_can_confirm(ev, pid);
  else
    select coalesce(sum(greatest(public._fin_charge_outstanding(c.id), 0)), 0) into overdue
      from public.finance_charges c
     where c.player_id = pid and c.venue_id = ev.venue_id and c.status = 'open'
       and c.due_date < public._fin_today();
  end if;
  if has_attendance and cur.status = 'offered' then
    update public.attendances set status='confirmed', confirmed_at=now(), offer_expires_at=null, updated_by=auth.uid() where id=cur.id;
    st := 'confirmed';
  else
    select count(*) into taken from public.attendances where event_id=_event_id and status in ('confirmed','offered');
    if taken < ev.max_participants and not exists(select 1 from public.attendances where event_id=_event_id and status in ('waitlist')) then st := 'confirmed'; else st := 'waitlist'; end if;
    if has_attendance then
      update public.attendances set status=st, confirmed_at=case when st='confirmed' then now() end,
        waitlisted_at=case when st='waitlist' then now() end, cancelled_at=null, updated_by=auth.uid() where id=cur.id;
    else
      insert into public.attendances(event_id,group_id,player_id,status,confirmed_at,waitlisted_at,updated_by)
      values (_event_id, ev.group_id, pid, st, case when st='confirmed' then now() end, case when st='waitlist' then now() end, auth.uid());
    end if;
  end if;
  if on_behalf then
    insert into public.audit_logs(group_id,actor_id,action,entity,entity_id,details)
      values (ev.group_id,auth.uid(),'attendance.admin_added','event',_event_id,jsonb_build_object('player_id',pid,'venue_id',ev.venue_id,'status',st));
  end if;
  if is_adm and overdue > 0 then
    insert into public.audit_logs(group_id,actor_id,action,entity,entity_id,details)
      values (ev.group_id,auth.uid(),'attendance.finance_override','event',_event_id,
        jsonb_build_object('player_id',pid,'venue_id',ev.venue_id,'overdue_cents',overdue,'status',st));
  end if;
  return st;
end $$;

-- ---------------------------------------------------------------- RPC helpers
create or replace function public._fin_venue_for_manager(_venue_id uuid) returns public.venues
language plpgsql security definer set search_path = public as $$
declare v public.venues;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  select * into v from public.venues where id = _venue_id;
  if not found then raise exception 'Quadra não encontrada'; end if;
  if not public.can_manage_finance(v.group_id) then raise exception 'Sem permissão para o financeiro desta quadra'; end if;
  return v;
end $$;
revoke all on function public._fin_venue_for_manager(uuid) from public, anon, authenticated;

create or replace function public._fin_require_key(_key text) returns text
language plpgsql immutable as $$
begin
  if _key is null or length(trim(_key)) < 8 or length(_key) > 120 then raise exception 'Chave de idempotência inválida'; end if;
  return trim(_key);
end $$;

-- ---------------------------------------------------------------- settings RPCs
create or replace function public.finance_save_settings(_venue_id uuid, _s jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v public.venues; old jsonb;
begin
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
end $$;

-- Shared payment instructions + cost scenarios (scenarios only for managers).
create or replace function public.finance_get_instructions(_venue_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
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
    'configured', s.venue_id is not null, 'due_day', s.due_day, 'pix_key_type', s.pix_key_type, 'pix_key', s.pix_key,
    'pix_receiver_name', s.pix_receiver_name, 'payment_instructions', s.payment_instructions,
    'monthly_fee_cents', s.monthly_fee_cents, 'daily_fee_cents', s.daily_fee_cents,
    'scenarios', case when mgr then jsonb_build_object(
      'active_monthly_players', active_monthly,
      'per_active_monthly_cents', case when active_monthly > 0 then ceil(coalesce(s.monthly_court_cost_cents,0)::numeric / active_monthly) end,
      'per_capacity_cents', case when coalesce(s.monthly_capacity,0) > 0 then ceil(s.monthly_court_cost_cents::numeric / s.monthly_capacity) end)
    end);
end $$;

create or replace function public.finance_set_event_daily_fee(_event_id uuid, _cents integer) returns void
language plpgsql security definer set search_path = public as $$
declare ev public.events;
begin
  select * into ev from public.events where id = _event_id;
  if not found then raise exception 'Evento não encontrado'; end if;
  perform public._fin_venue_for_manager(ev.venue_id);
  if _cents is not null and _cents < 0 then raise exception 'Valor inválido'; end if;
  update public.events set daily_fee_cents = nullif(_cents, 0) where id = _event_id;
  insert into public.audit_logs(group_id, actor_id, action, entity, entity_id, details)
    values (ev.group_id, auth.uid(), 'finance.event_daily_fee', 'event', _event_id,
      jsonb_build_object('before', ev.daily_fee_cents, 'after', _cents, 'venue_id', ev.venue_id));
end $$;

-- ---------------------------------------------------------------- charges RPCs
-- Idempotent: one monthly charge per court/player/period; re-running creates nothing new.
create or replace function public.finance_generate_monthly(_venue_id uuid, _period date default null) returns integer
language plpgsql security definer set search_path = public as $$
declare v public.venues; s public.finance_settings; per date; due date; n int;
begin
  v := public._fin_venue_for_manager(_venue_id);
  per := date_trunc('month', coalesce(_period, public._fin_today()))::date;
  if per <> date_trunc('month', public._fin_today())::date then
    raise exception 'Mensalidades recorrentes só podem ser geradas para o mês atual; use cobrança manual para outros casos';
  end if;
  select * into s from public.finance_settings where venue_id = _venue_id for update;
  if not found or s.monthly_fee_cents <= 0 then raise exception 'Configure o valor mensal por jogador antes de gerar cobranças'; end if;
  due := per + (s.due_day - 1);
  insert into public.finance_charges(venue_id, group_id, player_id, kind, period, description, amount_cents, due_date, created_by, idempotency_key)
  select v.id, v.group_id, p.id, 'monthly', per, 'Mensalidade ' || to_char(per, 'MM/YYYY'), s.monthly_fee_cents, due, auth.uid(),
         'monthly:' || p.id || ':' || per
    from public.players p
   where p.venue_id = v.id and p.group_id = v.group_id and p.status = 'active'
     and p.participation_type = 'mensalista' and not p.is_event_guest
  on conflict do nothing;
  get diagnostics n = row_count;
  insert into public.audit_logs(group_id, actor_id, action, entity, entity_id, details)
    values (v.group_id, auth.uid(), 'finance.monthly_generated', 'venue', v.id, jsonb_build_object('period', per, 'created', n));
  return n;
end $$;

-- Scheduled task: catch up the current month's charges once the configured due day arrives.
-- It runs daily at 00:10 São Paulo time (03:10 UTC); unique constraints keep it idempotent.
create or replace function public.finance_generate_due_monthly() returns integer
language plpgsql security definer set search_path = public as $$
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
     where s.monthly_fee_cents > 0
       and s.due_day <= extract(day from today)::integer
     order by s.venue_id
  loop
    perform pg_advisory_xact_lock(hashtextextended(cfg.venue_id::text, 0));
    insert into public.finance_charges(venue_id, group_id, player_id, kind, period, description,
      amount_cents, due_date, created_by, idempotency_key)
    select cfg.venue_id, cfg.group_id, p.id, 'monthly', per,
      'Mensalidade ' || to_char(per, 'MM/YYYY'), cfg.monthly_fee_cents,
      per + (cfg.due_day - 1), null, 'monthly:' || p.id || ':' || per
      from public.players p
     where p.venue_id = cfg.venue_id and p.group_id = cfg.group_id and p.status = 'active'
       and p.participation_type = 'mensalista' and not p.is_event_guest
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
end $$;
revoke all on function public.finance_generate_due_monthly() from public, anon, authenticated;

-- Supabase Cron executes as the role that scheduled the job (migration owner).
select cron.schedule(
  'finance-generate-monthly-charges',
  '10 3 * * *',
  'select public.finance_generate_due_monthly();'
);

create or replace function public.finance_create_charge(_venue_id uuid, _player_id uuid, _kind text, _description text,
  _amount_cents bigint, _due_date date, _event_id uuid, _idempotency_key text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v public.venues; p public.players; ev public.events; k text := public._fin_require_key(_idempotency_key); cid uuid; amt bigint := _amount_cents;
begin
  v := public._fin_venue_for_manager(_venue_id);
  select id into cid from public.finance_charges where venue_id = _venue_id and idempotency_key = k;
  if found then return cid; end if;
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
end $$;

create or replace function public.finance_cancel_charge(_charge_id uuid, _reason text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.finance_charges;
begin
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
end $$;

-- ---------------------------------------------------------------- payments / reversals / adjustments
create or replace function public.finance_record_payment(_charge_id uuid, _amount_cents bigint, _method text,
  _received_on date, _notes text, _idempotency_key text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c public.finance_charges; k text := public._fin_require_key(_idempotency_key); lid uuid; outstanding bigint;
begin
  select * into c from public.finance_charges where id = _charge_id for update; -- serializes concurrent payments
  if not found then raise exception 'Cobrança não encontrada'; end if;
  perform public._fin_venue_for_manager(c.venue_id);
  select id into lid from public.finance_ledger where venue_id = c.venue_id and idempotency_key = k;
  if found then return lid; end if;
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
end $$;

create or replace function public.finance_reverse_entry(_entry_id uuid, _reason text, _idempotency_key text) returns uuid
language plpgsql security definer set search_path = public as $$
declare e public.finance_ledger; k text := public._fin_require_key(_idempotency_key); lid uuid;
begin
  select * into e from public.finance_ledger where id = _entry_id;
  if not found then raise exception 'Lançamento não encontrado'; end if;
  perform public._fin_venue_for_manager(e.venue_id);
  if e.charge_id is not null then perform 1 from public.finance_charges where id = e.charge_id for update; end if;
  select id into lid from public.finance_ledger where venue_id = e.venue_id and idempotency_key = k;
  if found then return lid; end if;
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
end $$;

create or replace function public.finance_adjust_balance(_venue_id uuid, _amount_cents bigint, _occurred_on date, _reason text, _idempotency_key text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v public.venues; k text := public._fin_require_key(_idempotency_key); lid uuid;
begin
  v := public._fin_venue_for_manager(_venue_id);
  select id into lid from public.finance_ledger where venue_id = v.id and idempotency_key = k;
  if found then return lid; end if;
  if coalesce(_amount_cents, 0) = 0 then raise exception 'Valor do ajuste não pode ser zero'; end if;
  if length(trim(coalesce(_reason, ''))) < 3 then raise exception 'Informe o motivo do ajuste'; end if;
  insert into public.finance_ledger(venue_id, group_id, entry_type, amount_cents, occurred_on, notes, created_by, idempotency_key, category)
    values (v.id, v.group_id, 'adjustment', _amount_cents, coalesce(_occurred_on, public._fin_today()), trim(_reason), auth.uid(), k, 'ajuste')
    returning id into lid;
  insert into public.audit_logs(group_id, actor_id, action, entity, entity_id, details)
    values (v.group_id, auth.uid(), 'finance.adjustment', 'finance_ledger', lid, jsonb_build_object('amount_cents', _amount_cents, 'reason', _reason, 'venue_id', v.id));
  return lid;
end $$;

-- ---------------------------------------------------------------- expenses RPCs
create or replace function public.finance_record_expense(_venue_id uuid, _description text, _category text, _incurred_on date,
  _due_on date, _amount_cents bigint, _paid_on date, _notes text, _idempotency_key text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v public.venues; k text := public._fin_require_key(_idempotency_key); eid uuid;
begin
  v := public._fin_venue_for_manager(_venue_id);
  select id into eid from public.finance_expenses where venue_id = v.id and idempotency_key = k;
  if found then return eid; end if;
  if _incurred_on is null then raise exception 'Informe a data da despesa'; end if;
  insert into public.finance_expenses(venue_id, group_id, description, category, incurred_on, due_on, amount_cents, notes, created_by, idempotency_key)
    values (v.id, v.group_id, trim(_description), trim(_category), _incurred_on, _due_on, _amount_cents, nullif(trim(_notes), ''), auth.uid(), k)
    returning id into eid;
  if _paid_on is not null then perform public.finance_pay_expense(eid, _paid_on, 'pay:' || k); end if;
  insert into public.audit_logs(group_id, actor_id, action, entity, entity_id, details)
    values (v.group_id, auth.uid(), 'finance.expense_recorded', 'finance_expense', eid, jsonb_build_object('amount_cents', _amount_cents, 'venue_id', v.id));
  return eid;
end $$;

create or replace function public.finance_pay_expense(_expense_id uuid, _paid_on date, _idempotency_key text) returns uuid
language plpgsql security definer set search_path = public as $$
declare x public.finance_expenses; k text := public._fin_require_key(_idempotency_key); lid uuid; net bigint;
begin
  select * into x from public.finance_expenses where id = _expense_id for update;
  if not found then raise exception 'Despesa não encontrada'; end if;
  perform public._fin_venue_for_manager(x.venue_id);
  select id into lid from public.finance_ledger where venue_id = x.venue_id and idempotency_key = k;
  if found then return lid; end if;
  select coalesce(sum(amount_cents), 0) into net from public.finance_ledger where expense_id = x.id and entry_type in ('expense','expense_reversal');
  if net <> 0 then raise exception 'Despesa já está paga'; end if;
  if _paid_on is null or _paid_on > public._fin_today() then raise exception 'Data de pagamento inválida'; end if;
  insert into public.finance_ledger(venue_id, group_id, entry_type, amount_cents, occurred_on, expense_id, category, notes, created_by, idempotency_key)
    values (x.venue_id, x.group_id, 'expense', -x.amount_cents, _paid_on, x.id, x.category, x.description, auth.uid(), k)
    returning id into lid;
  return lid;
end $$;

-- Split an expense into charges (receivables). Sum of shares == total, in cents.
create or replace function public.finance_split_expense(_expense_id uuid, _target text, _mode text, _player_ids uuid[],
  _amounts bigint[], _event_id uuid, _due_date date) returns integer
language plpgsql security definer set search_path = public as $$
declare x public.finance_expenses; ids uuid[]; n int; base bigint; rem bigint; i int; amt bigint; total bigint;
begin
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
        and not p.is_event_guest and p.participation_type <> 'convidado';
  else raise exception 'Destino de rateio inválido'; end if;
  n := coalesce(array_length(ids, 1), 0);
  if n = 0 then raise exception 'Nenhum participante elegível para o rateio'; end if;
  if _mode = 'custom' then
    if coalesce(array_length(_amounts, 1), 0) <> n or _target <> 'selected' then raise exception 'Informe um valor para cada jogador selecionado'; end if;
    select sum(a) into total from unnest(_amounts) a;
    if total <> x.amount_cents then raise exception 'A soma das parcelas (% centavos) difere do total (% centavos)', total, x.amount_cents; end if;
    if exists (select 1 from unnest(_amounts) a where a <= 0) then raise exception 'Parcelas devem ser maiores que zero'; end if;
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
end $$;

-- ---------------------------------------------------------------- summary & closing
create or replace function public.finance_summary(_venue_id uuid, _from date, _to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v public.venues; s public.finance_settings; bal bigint; today date := public._fin_today();
begin
  v := public._fin_venue_for_manager(_venue_id);
  select * into s from public.finance_settings where venue_id = v.id;
  select coalesce(s.opening_balance_cents, 0) + coalesce(sum(amount_cents), 0) into bal from public.finance_ledger
    where venue_id = v.id and occurred_on >= coalesce(s.opening_balance_date, '-infinity'::date);
  return jsonb_build_object(
    'balance_cents', bal,
    'opening_balance_cents', coalesce(s.opening_balance_cents, 0), 'opening_balance_date', s.opening_balance_date,
    'receivable_cents', (select coalesce(sum(outstanding_cents), 0) from public.finance_charge_balances where venue_id = v.id and status = 'open' and due_date >= today),
    'overdue_cents', (select coalesce(sum(outstanding_cents), 0) from public.finance_charge_balances where venue_id = v.id and status = 'open' and due_date < today),
    'period_in_cents', (select coalesce(sum(amount_cents), 0) from public.finance_ledger where venue_id = v.id and occurred_on between _from and _to and entry_type in ('payment','payment_reversal')),
    'period_out_cents', (select coalesce(-sum(amount_cents), 0) from public.finance_ledger where venue_id = v.id and occurred_on between _from and _to and entry_type in ('expense','expense_reversal')),
    'period_adjust_cents', (select coalesce(sum(amount_cents), 0) from public.finance_ledger where venue_id = v.id and occurred_on between _from and _to and entry_type = 'adjustment'),
    'by_category', (select coalesce(jsonb_object_agg(cat, total), '{}') from (select coalesce(category, entry_type) cat, sum(amount_cents) total
        from public.finance_ledger where venue_id = v.id and occurred_on between _from and _to group by 1) t)
  );
end $$;

create or replace function public.finance_close_month(_venue_id uuid, _period date) returns void
language plpgsql security definer set search_path = public as $$
declare v public.venues; per date := date_trunc('month', _period)::date; snap jsonb;
begin
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
end $$;

create or replace function public.finance_reopen_month(_venue_id uuid, _period date, _reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v public.venues; per date := date_trunc('month', _period)::date;
begin
  v := public._fin_venue_for_manager(_venue_id);
  if not public.is_group_admin(v.group_id) then raise exception 'Somente o administrador pode reabrir um mês'; end if;
  if length(trim(coalesce(_reason, ''))) < 5 then raise exception 'Informe o motivo da reabertura'; end if;
  update public.finance_month_closings set status = 'reopened', reopened_by = auth.uid(), reopened_at = now(), reopen_reason = trim(_reason)
    where venue_id = v.id and period = per and status = 'closed';
  if not found then raise exception 'Mês não está fechado'; end if;
  insert into public.audit_logs(group_id, actor_id, action, entity, entity_id, details)
    values (v.group_id, auth.uid(), 'finance.month_reopened', 'venue', v.id, jsonb_build_object('period', per, 'reason', _reason));
end $$;

-- ---------------------------------------------------------------- grants on RPCs
do $$ declare f text; begin
  foreach f in array array[
    'finance_save_settings(uuid,jsonb)', 'finance_get_instructions(uuid)', 'finance_set_event_daily_fee(uuid,integer)',
    'finance_generate_monthly(uuid,date)', 'finance_create_charge(uuid,uuid,text,text,bigint,date,uuid,text)',
    'finance_cancel_charge(uuid,text)', 'finance_record_payment(uuid,bigint,text,date,text,text)',
    'finance_reverse_entry(uuid,text,text)', 'finance_adjust_balance(uuid,bigint,date,text,text)',
    'finance_record_expense(uuid,text,text,date,date,bigint,date,text,text)', 'finance_pay_expense(uuid,date,text)',
    'finance_split_expense(uuid,text,text,uuid[],bigint[],uuid,date)', 'finance_summary(uuid,date,date)',
    'finance_close_month(uuid,date)', 'finance_reopen_month(uuid,date,text)', 'can_manage_finance(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
