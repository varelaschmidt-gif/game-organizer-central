\set ON_ERROR_STOP 1
-- Execute in an isolated Supabase database after the base migrations and 0011.
begin;
create or replace function pg_temp.expect_true(ok boolean, label text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'PROFILE TEST FAILED [%]: %', label, ok; end if;
end $$;
create or replace function pg_temp.expect_error(q text) returns void language plpgsql as $$
begin
  execute q;
  raise exception 'PROFILE TEST FAILED: expected a constraint violation';
exception when check_violation then return;
end $$;

select pg_temp.expect_true(
  (select count(*) = 3 from information_schema.columns
    where table_schema='public' and table_name='profiles'
      and column_name in ('age','position','dominant_foot')),
  'new profile fields exist'
);
select pg_temp.expect_true(
  (select public_setting.public = false from storage.buckets public_setting where id='rdq-profile-avatars'),
  'avatar bucket is private'
);
select pg_temp.expect_true(
  not exists(
    select 1 from pg_proc
    where oid in (
      'public.create_group(text,boolean)'::regprocedure,
      'public.request_court_membership(uuid,text,text,text[])'::regprocedure,
      'public.accept_invite(text)'::regprocedure
    ) and prosrc ilike '%prof.address%'
  ),
  'profile completion does not depend on address'
);

insert into auth.users(id,email) values ('00000000-0000-0000-0000-0000000000f1','profile-test@example.invalid');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000f1',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}',true);
set local role authenticated;
update public.profiles set full_name='Jogador Teste',phone='11999990000',age=26,position='Volante',dominant_foot='direito'
where id=auth.uid();
select pg_temp.expect_true(
  (select age=26 and position='Volante' and dominant_foot='direito'
    from public.profiles where id=auth.uid()),
  'profile fields persist without address fields'
);
select pg_temp.expect_error($$update public.profiles set dominant_foot='left' where id=auth.uid()$$);
reset role;
rollback;
