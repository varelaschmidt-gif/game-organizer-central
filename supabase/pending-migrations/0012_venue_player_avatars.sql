-- 0012 — expõe somente caminhos de avatar aos membros da quadra correspondente
-- PENDENTE DE APLICAÇÃO: aplicar pelo Lovable/Supabase quando houver créditos disponíveis.
-- Não abre leitura ampla de public.profiles e não retorna dados pessoais.

create or replace function public.get_venue_player_avatars(_venue_id uuid)
returns table(player_id uuid, avatar_path text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, prof.avatar_url
  from public.players p
  join public.profiles prof on prof.id = p.user_id
  where p.venue_id = _venue_id
    and p.user_id is not null
    and prof.avatar_url is not null
    and auth.uid() is not null
    and public.is_court_member(_venue_id);
$$;

revoke all on function public.get_venue_player_avatars(uuid) from public, anon, authenticated;
grant execute on function public.get_venue_player_avatars(uuid) to authenticated;

comment on function public.get_venue_player_avatars(uuid) is
  'Returns only player ids and profile avatar paths for authenticated members of the specified court.';
