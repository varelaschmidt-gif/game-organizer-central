-- Transactional integration assertions for migrations 0012 and 0013.
-- Test users, groups, memberships, and audit rows are rolled back at the end.
begin;
create or replace function pg_temp.expect_true(ok boolean, label text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'PHASE 2 TEST FAILED [%]: %', label, ok; end if;
end $$;

select pg_temp.expect_true(to_regprocedure('public.get_venue_player_avatars(uuid)') is not null, 'court avatar lookup exists');
select pg_temp.expect_true(exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='rdq profile avatars read' and qual ilike '%players%' and qual ilike '%is_court_member%'), 'avatar reads follow court membership');
select pg_temp.expect_true((select public=false from storage.buckets where id='rdq-profile-avatars'), 'profile avatar bucket remains private');
select pg_temp.expect_true(to_regprocedure('public.guard_group_admins()') is not null and exists(select 1 from pg_trigger where tgname='trg_gm_guard_admins' and not tgisinternal), 'admin cap trigger exists');
select pg_temp.expect_true(to_regprocedure('public.set_group_admin(uuid,uuid,boolean)') is not null and has_function_privilege('authenticated','public.set_group_admin(uuid,uuid,boolean)','EXECUTE'), 'admin assignment rpc is available to signed-in users');
select pg_temp.expect_true(to_regprocedure('public.list_group_members(uuid)') is not null and has_function_privilege('authenticated','public.list_group_members(uuid)','EXECUTE'), 'admin member listing rpc exists');

insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-0000000000d1','phase2-owner@example.invalid'),
 ('00000000-0000-0000-0000-0000000000d2','phase2-admin2@example.invalid'),
 ('00000000-0000-0000-0000-0000000000d3','phase2-admin3@example.invalid'),
 ('00000000-0000-0000-0000-0000000000d4','phase2-admin4@example.invalid');
update public.profiles set full_name='Teste Fase 2',phone='11999990000',age=26,position='Volante',dominant_foot='direito'
 where id='00000000-0000-0000-0000-0000000000d1';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}',true);

do $$
declare gid uuid; admin_limit_enforced boolean := false;
begin
  gid := public.create_group('Teste de permissões Fase 2', false);
  insert into public.group_members(group_id,user_id,role) values
    (gid,'00000000-0000-0000-0000-0000000000d2','player'),
    (gid,'00000000-0000-0000-0000-0000000000d3','player'),
    (gid,'00000000-0000-0000-0000-0000000000d4','player');
  perform public.set_group_admin(gid,'00000000-0000-0000-0000-0000000000d2',true);
  perform public.set_group_admin(gid,'00000000-0000-0000-0000-0000000000d3',true);
  begin
    perform public.set_group_admin(gid,'00000000-0000-0000-0000-0000000000d4',true);
  exception when others then
    if sqlerrm like '%Limite de 3 administradores%' then admin_limit_enforced := true; else raise; end if;
  end;
  perform pg_temp.expect_true(admin_limit_enforced, 'fourth administrator promotion is rejected');
end $$;

select pg_temp.expect_true(position('has_platform_role' in pg_get_functiondef('public.create_group(text,boolean)'::regprocedure)) = 0, 'complete profile can create a group without platform role');
rollback;