-- CareFlow AI automated hospital onboarding
-- Applied to production on 2026-09-01.

create table if not exists public.careflow_onboarding_completions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  completed_at timestamptz not null default now()
);

alter table public.careflow_onboarding_completions enable row level security;
revoke all on table public.careflow_onboarding_completions from anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.organization_members'::regclass
      AND conname = 'organization_members_user_id_key'
  ) THEN
    ALTER TABLE public.organization_members
      ADD CONSTRAINT organization_members_user_id_key UNIQUE (user_id);
  END IF;
END
$$;

create or replace function public.complete_hospital_onboarding()
returns table (
  organization_id uuid,
  organization_name text,
  onboarding_state text
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user auth.users%rowtype;
  v_name text;
  v_existing_org uuid;
  v_existing_name text;
  v_completed_org uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select * into v_user
  from auth.users
  where id = auth.uid()
  for update;

  if not found then
    raise exception 'Signed-in account not found.' using errcode = '42501';
  end if;

  if v_user.email_confirmed_at is null then
    raise exception 'Verify your email before creating a hospital workspace.' using errcode = '42501';
  end if;

  select om.organization_id, o.name
    into v_existing_org, v_existing_name
  from public.organization_members om
  join public.organizations o on o.id = om.organization_id
  where om.user_id = v_user.id
  limit 1;

  if v_existing_org is not null then
    return query select v_existing_org, v_existing_name, 'existing_membership'::text;
    return;
  end if;

  select c.organization_id into v_completed_org
  from public.careflow_onboarding_completions c
  where c.user_id = v_user.id;

  if v_completed_org is not null then
    return query select null::uuid, null::text, 'already_completed'::text;
    return;
  end if;

  if coalesce(v_user.raw_user_meta_data ->> 'careflow_signup_type', '') <> 'hospital_owner' then
    raise exception 'This account is not eligible to create a hospital workspace.' using errcode = '42501';
  end if;

  v_name := trim(regexp_replace(
    coalesce(v_user.raw_user_meta_data ->> 'careflow_hospital_name', ''),
    '\s+', ' ', 'g'
  ));

  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'Hospital name must be between 2 and 120 characters.' using errcode = '22023';
  end if;

  if v_name ~ '[[:cntrl:]]' then
    raise exception 'Hospital name contains invalid characters.' using errcode = '22023';
  end if;

  insert into public.organizations (name)
  values (v_name)
  returning id into v_existing_org;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_existing_org, v_user.id, 'admin');

  insert into public.careflow_onboarding_completions (user_id, organization_id)
  values (v_user.id, v_existing_org);

  return query select v_existing_org, v_name, 'created'::text;
end;
$$;

revoke all on function public.complete_hospital_onboarding() from public, anon;
grant execute on function public.complete_hospital_onboarding() to authenticated;
