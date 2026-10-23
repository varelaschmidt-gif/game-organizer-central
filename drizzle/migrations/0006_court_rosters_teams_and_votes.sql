-- Make a venue (court) the scope for its roster and events while preserving
-- the existing group as the permissions and membership boundary.
insert into public.venues(group_id, name, address, created_by)
select g.id, g.name, gs.location, g.created_by
from public.groups g
left join public.group_settings gs on gs.group_id = g.id
where not exists (select 1 from public.venues v where v.group_id = g.id);

alter table public.venues add column if not exists city text;
alter table public.venues add column if not exists neighborhood text;
alter table public.venues add column if not exists habitual_weekday smallint check (habitual_weekday is null or habitual_weekday between 0 and 6);
alter table public.venues add column if not exists habitual_time time;

alter table public.players add column if not exists venue_id uuid references public.venues(id) on delete restrict;
update public.players p set venue_id = (
  select id from public.venues where group_id=p.group_id order by created_at, id limit 1
) where p.venue_id is null;

alter table public.event_series add column if not exists venue_id uuid references public.venues(id) on delete restrict;
alter table public.events add column if not exists venue_id uuid references public.venues(id) on delete restrict;
update public.events e set venue_id = coalesce(
  (select v.id from public.venues v where v.group_id=e.group_id and lower(coalesce(v.address,''))=lower(coalesce(e.location,'')) order by v.created_at limit 1),
  (select v.id from public.venues v where v.group_id=e.group_id order by v.created_at limit 1)
) where e.venue_id is null;
update public.event_series s set venue_id = coalesce(
  (select e.venue_id from public.events e where e.series_id=s.id and e.venue_id is not null order by e.starts_at limit 1),
  (select v.id from public.venues v where v.group_id=s.group_id order by v.created_at limit 1)
) where s.venue_id is null;
alter table public.players alter column venue_id set not null;
alter table public.events alter column venue_id set not null;
alter table public.event_series alter column venue_id set not null;
create index players_venue_name_idx on public.players(venue_id, name);
create index events_venue_start_idx on public.events(venue_id, starts_at);

alter table public.group_invites add column if not exists venue_id uuid references public.venues(id) on delete cascade;
update public.group_invites i set venue_id=coalesce(
 (select p.venue_id from public.players p where p.id=i.player_id),
 (select v.id from public.venues v where v.group_id=i.group_id order by v.created_at limit 1)
) where i.venue_id is null;
alter table public.group_join_requests add column if not exists venue_id uuid references public.venues(id) on delete cascade;
alter table public.group_join_requests alter column invite_id drop not null;
alter table public.group_join_requests add column if not exists dominant_foot text check (dominant_foot is null or dominant_foot in ('direito','esquerdo','ambos'));
alter table public.group_join_requests add column if not exists position text;
alter table public.group_join_requests add column if not exists secondary_positions text[] not null default '{}';
update public.group_join_requests r set venue_id=i.venue_id from public.group_invites i where i.id=r.invite_id and r.venue_id is null;
alter table public.group_join_requests alter column venue_id set not null;
drop index if exists public.group_join_requests_one_pending_user_idx;
create unique index group_join_requests_one_pending_user_idx on public.group_join_requests(venue_id,user_id) where status='pending';

create or replace function public.get_public_court(_venue_id uuid)
returns table(id uuid,name text,address text,city text,neighborhood text)
language sql stable security definer set search_path=public as $$
  select v.id,v.name,v.address,v.city,v.neighborhood from public.venues v where v.id=_venue_id and v.is_active
$$;
revoke execute on function public.get_public_court(uuid) from public;
grant execute on function public.get_public_court(uuid) to anon,authenticated;

create or replace function public.request_court_membership(_venue_id uuid,_dominant_foot text,_position text,_secondary_positions text[] default '{}') returns zÛn¶¶‰ËkºwµçBµ$ôÄUôÄ$TÅ¶–çf—FRç&öÆU×ÒàĞ¢Â÷àĞ¢Ç6Æ74æÖSÒ&×BÓFW‡B×6ÒFW‡BÖ×WFVBÖf÷&Vw&÷VæB#ä6öçf—FR&¢¶–çf—FRæVÖ–ÇÓÂ÷àĞ¢·W6W"ò€Ğ¢&öf–ÆSòægVÆÅöæÖSòçG&–Ò‚’ÇÂ&öf–ÆRævRÇÂ&öf–ÆRæFG&W73òçG&–Ò‚’ÇÂ&öf–ÆRæ6—G“òçG&–Ò‚’ÇÂ&öf–ÆRææV–v†&÷&†ööCòçG&–Ò‚’ò€Ğ¢ÆF—b6Æ74æÖSÒ&×BÓB76R×’Ó2#ãÇ6Æ74æÖSÒ'FW‡B×6ÒFW‡BÖ×WFVBÖf÷&Vw&÷VæB#ä6ö×ÆWFR6WRW&f–ÂçFW2FR6öÆ–6—F"6W76òãÂ÷ãÄ'WGFöâ46†–ÆB6Æ74æÖSÒ'rÖgVÆÂ#ãÄÆ–æ²FóÒ"÷W&f–Â"6V&6ƒ×·²&VF—&V7B×Óä6ö×ÆWF"W&f–ÃÂôÆ–æ³ãÂô'WGFöããÂöF—càĞ¢’ Ğ¢W6W"æVÖ–ÃòçFôÆ÷vW$66R‚’ÓÓÒ–çf—FRæVÖ–Âò€Ğ¢Ä'WGFöâ6Æ74æÖSÒ&×BÓBrÖgVÆÂ"öä6Æ–6³×¶66WGÒF—6&ÆVC×¶'W7—ÓàĞ¢¶'W7’ò$Vçf–æFòVF–Fòâââ"¢%6öÆ–6—F"VçG&F'ĞĞ¢Âô'WGFöãàĞ¢’¢€Ğ¢ÆF—b6Æ74æÖSÒ&×BÓB#àĞ¢ÄW'&÷%7FFRÖW76vS×¶fö<:¢W7L:ÆövFò6öÖòG·W6W"æVÖ–ÇÒâVçG&R6öÒG¶–çf—FRæVÖ–ÇÒ&6V—F"æÒóàĞ¢ÂöF—càĞ¢Ğ¢’¢€Ğ¢ÆF—b6Æ74æÖSÒ&×BÓBfÆW‚fÆW‚Ö6öÂvÓ"#àĞ¢Ä'WGFöâ46†–ÆCàĞ¢ÄÆ–æ²FóÒ"öWF‚"6V&6ƒ×·²&VF—&V7BÂÖöFS¢'6–vçW"×Óä7&–"6öçFÂôÆ–æ³àĞ¢Âô'WGFöãàĞ¢Ä'WGFöâ46†–ÆBf&–çCÒ&÷WFÆ–æR#àĞ¢ÄÆ–æ²FóÒ"öWF‚"6V&6ƒ×·²&VF—&V7BÂÖöFS¢VæFVf–æVB×Óä¬:FVæ†ò6öçFÂôÆ–æ³àĞ¢Âô'WGFöãàĞ¢ÂöF—càĞ¢—ĞĞ¢ÂóàĞ¢“°Ğ¢ĞĞ Ğ¢&WGW&â€Ğ¢ÆÖ–â6Æ74æÖSÒ&fÆW‚Ö–âÖ‚×67&VVâ—FV×2Ö6VçFW"§W7F–g’Ö6VçFW"&rÖ&6¶w&÷VæB‚ÓB#àĞ¢ÆF—b6Æ74æÖSÒ'rÖgVÆÂÖ‚×rÖÖB&÷VæFVB×†Â&÷&FW"&÷&FW"Ö&÷&FW"&rÖ6&BÓb#àĞ¢Æƒ6Æ74æÖSÒ&Ö"Ó2FW‡BÓ'†ÂföçBÖ&öÆBWW&66R#ä6öçf—FSÂöƒàĞ¢¶&öG—ĞĞ¢ÂöF—càĞ¢ÂöÖ–ãàĞ¢“°Ğ§ĞĞ