-- 0012 — expõe somente caminhos de avatar aos membros da quadra correspondente
-- Aplicada ao banco integrado do Lovable em 12/11/2026.
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

-- Signed URLs must not expose another court roster's avatars to unrelated users.
drop policy if exists "rdq profile avatars read" on storage.objects;
create policy "rdq profile avatars read" on storage.objects for select to authenticated using (
  bucket_id = 'rdq-profile-avatars'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (
      select 1 from public.players p
      where p.user_id::text = (storage.foldername(objects.name))[1]
        and p.venue_id is not null
        and public.is_court_member(p.venue_id)
    )
  )
);
comment on function public.get_venue_player_avatars(uuid) is
  'Returns only player ids and profile avatar paths for authenticated members of the specified court.';
