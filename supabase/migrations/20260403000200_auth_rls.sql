create table if not exists public.teacher_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_teacher_profile_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists teacher_profiles_set_updated_at on public.teacher_profiles;

create trigger teacher_profiles_set_updated_at
before update on public.teacher_profiles
for each row
execute function public.set_teacher_profile_updated_at();

create or replace function public.sync_teacher_profile_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.teacher_profiles (id, email, display_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(
      nullif(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Teacher'
    )
  )
  on conflict (id) do update
  set email = excluded.email,
      display_name = excluded.display_name,
      updated_at = now();

  return new;
end;
$$;

drop trigger if exists sync_teacher_profile_from_auth_user on auth.users;

create trigger sync_teacher_profile_from_auth_user
after insert or update on auth.users
for each row
execute function public.sync_teacher_profile_from_auth_user();

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change_token_current,
  phone_change_token,
  reauthentication_token,
  email_change,
  phone_change,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  is_sso_user,
  is_anonymous
)
values (
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-1111-1111-111111111111',
  'authenticated',
  'authenticated',
  'teacher@example.com',
  crypt('DemoTeacher123!', gen_salt('bf')),
  now(),
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Demo Teacher"}'::jsonb,
  now(),
  now(),
  false,
  false
)
on conflict (id) do update
set email = excluded.email,
    encrypted_password = excluded.encrypted_password,
    email_confirmed_at = excluded.email_confirmed_at,
    confirmation_token = excluded.confirmation_token,
    recovery_token = excluded.recovery_token,
    email_change_token_new = excluded.email_change_token_new,
    email_change_token_current = excluded.email_change_token_current,
    phone_change_token = excluded.phone_change_token,
    reauthentication_token = excluded.reauthentication_token,
    email_change = excluded.email_change,
    phone_change = excluded.phone_change,
    raw_app_meta_data = excluded.raw_app_meta_data,
    raw_user_meta_data = excluded.raw_user_meta_data,
    updated_at = now(),
    is_sso_user = excluded.is_sso_user,
    is_anonymous = excluded.is_anonymous;

insert into auth.identities (
  user_id,
  provider_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
values (
  '11111111-1111-1111-1111-111111111111',
  'teacher@example.com',
  '{"sub":"11111111-1111-1111-1111-111111111111","email":"teacher@example.com"}'::jsonb,
  'email',
  now(),
  now(),
  now()
)
on conflict (provider_id, provider) do update
set identity_data = excluded.identity_data,
    last_sign_in_at = excluded.last_sign_in_at,
    updated_at = excluded.updated_at;

alter table public.classes
add column if not exists owner_id uuid references public.teacher_profiles (id) on delete cascade;

alter table public.tests
add column if not exists owner_id uuid references public.teacher_profiles (id) on delete cascade;

update public.classes
set owner_id = '11111111-1111-1111-1111-111111111111'::uuid
where owner_id is null;

update public.tests
set owner_id = coalesce(public.tests.owner_id, public.classes.owner_id, '11111111-1111-1111-1111-111111111111'::uuid)
from public.classes
where public.classes.id = public.tests.class_id
  and public.tests.owner_id is null;

alter table public.classes
alter column owner_id set default auth.uid();

alter table public.tests
alter column owner_id set default auth.uid();

alter table public.classes
alter column owner_id set not null;

alter table public.tests
alter column owner_id set not null;

create index if not exists classes_owner_id_idx on public.classes (owner_id);
create index if not exists tests_owner_id_idx on public.tests (owner_id);
create index if not exists tests_class_id_idx on public.tests (class_id);
create index if not exists questions_test_id_idx on public.questions (test_id);
create index if not exists student_attempts_test_id_idx on public.student_attempts (test_id);
create index if not exists student_attempts_class_code_idx on public.student_attempts (class_code);

create or replace function public.get_public_test_stats(target_test_id text)
returns table (
  participant_count bigint,
  average_score integer,
  highest_score integer,
  lowest_score integer
)
language sql
security definer
set search_path = public
as $$
  select
    count(*)::bigint as participant_count,
    coalesce(round(avg(score))::integer, 0) as average_score,
    coalesce(max(score), 0) as highest_score,
    coalesce(min(score), 0) as lowest_score
  from public.student_attempts
  where public.student_attempts.test_id = target_test_id
    and exists (
      select 1
      from public.tests
      where public.tests.id = public.student_attempts.test_id
        and public.tests.status = '公開中'
    );
$$;

grant execute on function public.get_public_test_stats(text) to anon, authenticated;

alter table public.teacher_profiles enable row level security;
alter table public.classes enable row level security;
alter table public.tests enable row level security;
alter table public.questions enable row level security;
alter table public.student_attempts enable row level security;

drop policy if exists "Teachers can view own profile" on public.teacher_profiles;
create policy "Teachers can view own profile"
on public.teacher_profiles
for select
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = id);

drop policy if exists "Teachers can insert own profile" on public.teacher_profiles;
create policy "Teachers can insert own profile"
on public.teacher_profiles
for insert
to authenticated
with check ((select auth.uid()) is not null and (select auth.uid()) = id);

drop policy if exists "Teachers can update own profile" on public.teacher_profiles;
create policy "Teachers can update own profile"
on public.teacher_profiles
for update
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = id)
with check ((select auth.uid()) is not null and (select auth.uid()) = id);

drop policy if exists "Teachers can view own classes" on public.classes;
create policy "Teachers can view own classes"
on public.classes
for select
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = owner_id);

drop policy if exists "Teachers can create own classes" on public.classes;
create policy "Teachers can create own classes"
on public.classes
for insert
to authenticated
with check ((select auth.uid()) is not null and (select auth.uid()) = owner_id);

drop policy if exists "Teachers can update own classes" on public.classes;
create policy "Teachers can update own classes"
on public.classes
for update
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = owner_id)
with check ((select auth.uid()) is not null and (select auth.uid()) = owner_id);

drop policy if exists "Teachers can delete own classes" on public.classes;
create policy "Teachers can delete own classes"
on public.classes
for delete
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = owner_id);

drop policy if exists "Published classes are public" on public.classes;
create policy "Published classes are public"
on public.classes
for select
to anon
using (
  exists (
    select 1
    from public.tests
    where public.tests.class_id = public.classes.id
      and public.tests.status = '公開中'
  )
);

drop policy if exists "Teachers can view own tests" on public.tests;
create policy "Teachers can view own tests"
on public.tests
for select
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = owner_id);

drop policy if exists "Teachers can create own tests" on public.tests;
create policy "Teachers can create own tests"
on public.tests
for insert
to authenticated
with check (
  (select auth.uid()) is not null
  and (select auth.uid()) = owner_id
  and exists (
    select 1
    from public.classes
    where public.classes.id = public.tests.class_id
      and public.classes.owner_id = (select auth.uid())
  )
);

drop policy if exists "Teachers can update own tests" on public.tests;
create policy "Teachers can update own tests"
on public.tests
for update
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = owner_id)
with check (
  (select auth.uid()) is not null
  and (select auth.uid()) = owner_id
  and exists (
    select 1
    from public.classes
    where public.classes.id = public.tests.class_id
      and public.classes.owner_id = (select auth.uid())
  )
);

drop policy if exists "Teachers can delete own tests" on public.tests;
create policy "Teachers can delete own tests"
on public.tests
for delete
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = owner_id);

drop policy if exists "Published tests are public" on public.tests;
create policy "Published tests are public"
on public.tests
for select
to anon
using (status = '公開中');

drop policy if exists "Teachers can view own questions" on public.questions;
create policy "Teachers can view own questions"
on public.questions
for select
to authenticated
using (
  exists (
    select 1
    from public.tests
    where public.tests.id = public.questions.test_id
      and public.tests.owner_id = (select auth.uid())
  )
);

drop policy if exists "Teachers can create own questions" on public.questions;
create policy "Teachers can create own questions"
on public.questions
for insert
to authenticated
with check (
  exists (
    select 1
    from public.tests
    where public.tests.id = public.questions.test_id
      and public.tests.owner_id = (select auth.uid())
  )
);

drop policy if exists "Teachers can update own questions" on public.questions;
create policy "Teachers can update own questions"
on public.questions
for update
to authenticated
using (
  exists (
    select 1
    from public.tests
    where public.tests.id = public.questions.test_id
      and public.tests.owner_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.tests
    where public.tests.id = public.questions.test_id
      and public.tests.owner_id = (select auth.uid())
  )
);

drop policy if exists "Teachers can delete own questions" on public.questions;
create policy "Teachers can delete own questions"
on public.questions
for delete
to authenticated
using (
  exists (
    select 1
    from public.tests
    where public.tests.id = public.questions.test_id
      and public.tests.owner_id = (select auth.uid())
  )
);

drop policy if exists "Published questions are public" on public.questions;
create policy "Published questions are public"
on public.questions
for select
to anon
using (
  enabled
  and exists (
    select 1
    from public.tests
    where public.tests.id = public.questions.test_id
      and public.tests.status = '公開中'
  )
);

drop policy if exists "Teachers can view own attempts" on public.student_attempts;
create policy "Teachers can view own attempts"
on public.student_attempts
for select
to authenticated
using (
  exists (
    select 1
    from public.tests
    where public.tests.id = public.student_attempts.test_id
      and public.tests.owner_id = (select auth.uid())
  )
);

drop policy if exists "Public can create attempts for published tests" on public.student_attempts;
create policy "Public can create attempts for published tests"
on public.student_attempts
for insert
to anon, authenticated
with check (
  exists (
    select 1
    from public.tests
    join public.classes on public.classes.id = public.tests.class_id
    where public.tests.id = public.student_attempts.test_id
      and public.classes.code = public.student_attempts.class_code
      and public.tests.status = '公開中'
  )
);