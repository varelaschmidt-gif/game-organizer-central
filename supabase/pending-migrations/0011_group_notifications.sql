-- Notificações persistentes por grupo e por jogador.
-- Aplicação pendente no banco integrado ao Lovable.

create table public.group_notifications (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  sender_user_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('message', 'charge')),
  title text not null check (length(trim(title)) between 2 and 160),
  body text not null check (length(trim(body)) between 1 and 4000),
  event_id uuid references public.events(id) on delete set null,
  charge_id uuid references public.finance_charges(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (charge_id, recipient_user_id)
);

create index group_notifications_inbox_idx
  on public.group_notifications(recipient_user_id, created_at desc);
create index group_notifications_group_idx
  on public.group_notifications(group_id, created_at desc);

grant select on public.group_notifications to authenticated;
grant all on public.group_notifications to service_role;
alter table public.group_notifications enable row level security;
create policy "players read their own group notifications"
  on public.group_notifications for select to authenticated
  using (recipient_user_id = auth.uid() and public.is_group_member(group_id));

create or replace function public.group_notification_mark_read(_notification_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.group_notifications
    set read_at = coalesce(read_at, now())
    where id = _notification_id and recipient_user_id = auth.uid();
  if not found then raise exception 'Notificação não encontrada'; end if;
end $$;
revoke all on function public.group_notification_mark_read(uuid) from public;
grant execute on function public.group_notification_mark_read(uuid) to authenticated;

create or replace function public.admin_publish_group_notification(
  _group_id uuid, _title text, _body text, _event_id uuid default null
) returns integer language plpgsql security definer set search_path = public as $$
declare event_data jsonb := '{}'::jsonb; inserted_count integer;
begin
  if auth.uid() is null or not public.is_group_admin(_group_id) then
    raise exception 'Somente administradores podem enviar notificações';
  end if;
  if length(trim(coalesce(_title, ''))) not between 2 and 160
    or length(trim(coalesce(_body, ''))) not between 1 and 4000 then
    raise exception 'Informe um título e uma mensagem válida';
  end if;
  if _event_id is not null then
    select jsonb_build_object('title', title, 'starts_at', starts_at, 'venue_id', venue_id)
      into event_data from public.events where id = _event_id and group_id = _group_id;
    if event_data is null then raise exception 'Evento não pertence a esta quadra'; end if;
  end if;
  insert into public.group_notifications(group_id, recipient_user_id, sender_user_id, kind, title, body, event_id, metadata)
    select _group_id, gm.user_id, auth.uid(), 'message', trim(_title), trim(_body), _event_id,
      case when _event_id is null then '{}'::jsonb else jsonb_build_object('event', event_data) end
    from public.group_members gm where gm.group_id = _group_id;
  get diagnostics inserted_count = row_count;
  insert into public.audit_logs(group_id, actor_id, action, entity, entity_id, details)
    values (_group_id, auth.uid(), 'notification.broadcast', 'group_notification', _event_id,
      jsonb_build_object('title', trim(_title), 'recipients', inserted_count));
  return inserted_count;
end $$;
revoke all on function public.admin_publish_group_notification(uuid, text, text, uuid) from public;
grant execute on function public.admin_publish_group_notification(uuid, text, text, uuid) to authenticated;

create or replace function public.notify_player_of_finance_charge()
returns trigger language plpgsql security definer set search_path = public as $$
declare recipient uuid;
begin
  select p.user_id into recipient from public.players p where p.id = new.player_id;
  if recipient is null then return new; end if;
  insert into public.group_notifications(
    group_id, recipient_user_id, kind, title, body, event_id, charge_id, metadata
  ) values (
    new.group_id, recipient, 'charge', 'Nova cobrança',
    'Uma cobrança foi lançada para você. Consulte o Financeiro para ver o valor, vencimento e instruções.',
    new.event_id, new.id,
    jsonb_build_object('kind', new.kind, 'description', new.description,
      'amount_cents', new.amount_cents, 'due_date', new.due_date, 'period', new.period)
  ) on conflict (charge_id, recipient_user_id) do nothing;
  return new;
end $$;
revoke all on function public.notify_player_of_finance_charge() from public, anon, authenticated;

create trigger trg_notify_player_of_finance_charge
  after insert on public.finance_charges
  for each row execute function public.notify_player_of_finance_charge();
