-- Keep older court links usable when they contain the group UUID instead of
-- the venue UUID. Resolve the legacy form only when it maps to one active
-- court, so a group with multiple courts can never send a player to the wrong
-- one.
create or replace function public.get_public_court(_venue_id uuid)
returns table(id uuid,name text,address text,city text,neighborhood text)
language sql stable security definer set search_path=public as $$
  select v.id,v.name,v.address,v.city,v.neighborhood
  from public.venues v
  where v.is_active
    and (
      v.id=_venue_id
      or (
        v.group_id=_venue_id
        and (select count(*) from public.venues active_v where active_v.group_id=_venue_id and active_v.is_active)=1
      )
    )
  order by (v.id=_venue_id) desc
  limit 1
$$;
revoke execute on function public.get_public_court(uuid) from public;
grant execute on function public.get_public_court(uuid) to anon,authenticated;
