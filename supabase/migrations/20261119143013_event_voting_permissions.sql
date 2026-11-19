-- Normalize the legacy administrative rating RPC ACL in both environments.
revoke all on function public.set_player_rating(uuid,uuid,smallint) from public,anon;
grant execute on function public.set_player_rating(uuid,uuid,smallint) to authenticated;
