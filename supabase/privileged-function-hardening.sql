-- CareFlow AI privileged-function and onboarding hardening
-- Captures hospital-owner signup intent at account creation so later edits to
-- user-controlled metadata cannot grant permission to create a workspace.

create table if not exists careflow_private.hospital_signup_intents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  hospital_name text not null,
  created_at timestamptz not null default pg_catalog.now(),
  claimed_at timestamptz,
  organization_id uuid unique references public.organizations(id) on delete cascade,
  constraint hospital_signup_intents_name_length_check
    check (pg_catalog.char_length(hospital_name) between 2 and 120),
  constraint hospital_signup_intents_name_control_check
    check (hospital_name !~ '[[:cntrl:]]'),
  constraint hospital_signup_intents_claim_check
    check ((claimed_at is null) = (organization_id is null))
);

alter table careflow_private.hospital_signup_intents enable row level security;

revoke all on table careflow_private.hospital_signup_intents
  from public, anon, authenticated, service_role, authenticator;

comment on table careflow_private.hospital_signup_intents is
  'Immutable-at-signup authorization record for self-service hospital workspace creation; never exposed through the Data API.';

create or replace function careflow_private.capture_hospital_signup_intent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if coalesce(new.raw_user_meta_data ->> 'careflow_signup_type', '') <> 'hospital_owner' then
    return new;
  end if;

  v_name := pg_catalog.btrim(pg_catalog.regexp_replace(
    coalesce(new.raw_user_meta_data ->> 'careflow_hospital_name', ''),
    '\s+', ' ', 'g'
  ));

  if pg_catalog.char_length(v_name) < 2 or pg_catalog.char_length(v_name) > 120 then
    raise exception 'Hospital name must be between 2 and 120 characters.' using errcode = '22023';
  end if;

  if v_name ~ '[[:cntrl:]]' then
    raise exception 'Hospital name contains invalid characters.' using errcode = '22023';
  end if;

  insert into careflow_private.hospital_signup_intents (user_id, hospital_name)
  values (new.id, v_name)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

revoke all on function careflow_private.capture_hospital_signup_intent()
  from public, anon, authenticated, service_role, authenticator;

drop trigger if exists careflow_capture_hospital_signup_intent on auth.users;
create trigger careflow_capture_hospital_signup_intent
  after insert on auth.users
  for each row
  execute function careflow_private.capture_hospital_signup_intent();

-- Existing completed owners are trusted because their workspace and admin
-- membership were already created. Do not backfill uncompleted user metadata.
insert into careflow_private.hospital_signup_intents (
  user_id,
  hospital_name,
  created_at,
  claimed_at,
  organization_id
)
select
  c.user_id,
  o.name,
  c.completed_at,
  c.completed_at,
  c.organization_id
from public.careflow_onboarding_completions c
join public.organizations o on o.id = c.organization_id
on conflict (user_id) do nothing;

create or replace function public.complete_hospital_onboarding()
returns table (
  organization_id uuid,
  organization_name text,
  onboarding_state text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user auth.users%rowtype;
  v_name text;
  v_existing_org uuid;
  v_existing_name text;
  v_completed_org uuid;
  v_intent_org uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select *
    into v_user
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
  order by om.created_at nulls last, om.id
  limit 1;

  if v_existing_org is not null then
    return query select v_existing_org, v_existing_name, 'existing_membership'::text;
    return;
  end if;

  select c.organization_id
    into v_completed_org
  from public.careflow_onboarding_completions c
  where c.user_id = v_user.id;

  if v_completed_org is not null then
    return query select null::uuid, null::text, 'already_completed'::text;
    return;
  end if;

  select i.hospital_name, i.organization_id
    into v_name, v_intent_org
  from careflow_private.hospital_signup_intents i
  where i.user_id = v_user.id
  for update;

  if not found then
    raise exception 'This account is not eligible to create a hospital workspace.' using errcode = '42501';
  end if;

  if v_intent_org is not null then
    return query select null::uuid, null::text, 'already_completed'::text;
    return;
  end if;

  insert into public.organizations (name)
  values (v_name)
  returning id into v_existing_org;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_existing_org, v_user.id, 'admin');

  insert into public.careflow_onboarding_completions (user_id, organization_id)
  values (v_user.id, v_existing_org);

  update careflow_private.hospital_signup_intents as i
  set organization_id = v_existing_org,
      claimed_at = pg_catalog.now()
  where i.user_id = v_user.id
    and i.organization_id is null;

  if not found then
    raise exception 'Hospital signup intent was already claimed.' using errcode = '23505';
  end if;

  return query select v_existing_org, v_name, 'created'::text;
end;
$$;

create or replace function public.careflow_my_organization()
returns table (
  organization_id uuid,
  organization_name text,
  organization_created_at timestamptz,
  my_role text,
  member_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    o.id,
    o.name,
    o.created_at,
    om.role,
    (
      select pg_catalog.count(*)
      from public.organization_members members
      where members.organization_id = o.id
    )::bigint
  from public.organization_members om
  join public.organizations o on o.id = om.organization_id
  where om.user_id = auth.uid()
  order by om.created_at nulls last, om.id
  limit 1;
$$;

create or replace function public.careflow_my_organization_members_v2()
returns table (
  email text,
  role text,
  joined_at timestamptz,
  is_current boolean,
  account_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  with my_org as (
    select om.organization_id
    from public.organization_members om
    where om.user_id = auth.uid()
    order by om.created_at nulls last, om.id
    limit 1
  )
  select
    u.email::text,
    members.role,
    members.created_at,
    (members.user_id = auth.uid()),
    case when u.email_confirmed_at is null then 'Invited' else 'Active' end::text
  from public.organization_members members
  join my_org on my_org.organization_id = members.organization_id
  join auth.users u on u.id = members.user_id
  order by members.role = 'admin' desc, pg_catalog.lower(u.email), members.created_at nulls last;
$$;

create or replace function public.careflow_case_review_activity()
returns table (
  id uuid,
  case_id bigint,
  organization_id uuid,
  actor_id uuid,
  changed_at timestamptz,
  operation text,
  before_values jsonb,
  after_values jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    h.id,
    h.case_id,
    h.organization_id,
    h.actor_id,
    h.changed_at,
    h.operation,
    '{}'::jsonb as before_values,
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'status', case when (h.before_values -> 'status') is distinct from (h.after_values -> 'status') then true end,
      'patient_name', case when (h.before_values -> 'patient_name') is distinct from (h.after_values -> 'patient_name') then true end,
      'document_type', case when (h.before_values -> 'document_type') is distinct from (h.after_values -> 'document_type') then true end,
      'document_date', case when (h.before_values -> 'document_date') is distinct from (h.after_values -> 'document_date') then true end,
      'insurance_information', case when (h.before_values -> 'insurance_information') is distinct from (h.after_values -> 'insurance_information') then true end,
      'missing_information', case when (h.before_values -> 'missing_information') is distinct from (h.after_values -> 'missing_information') then true end,
      'review_notes', case when (h.before_values -> 'review_notes') is distinct from (h.after_values -> 'review_notes') then true end,
      'review_confirmed', case when (h.before_values -> 'review_confirmed') is distinct from (h.after_values -> 'review_confirmed') then true end
    )) as after_values
  from careflow_private.case_review_history_private_data h
  where exists (
    select 1
    from public.organization_members om
    where om.user_id = auth.uid()
      and om.organization_id = h.organization_id
  );
$$;

revoke all on function public.complete_hospital_onboarding()
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.careflow_my_organization()
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.careflow_my_organization_members_v2()
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.careflow_case_review_activity()
  from public, anon, authenticated, service_role, authenticator;

grant execute on function public.complete_hospital_onboarding() to authenticated;
grant execute on function public.careflow_my_organization() to authenticated;
grant execute on function public.careflow_my_organization_members_v2() to authenticated;
grant execute on function public.careflow_case_review_activity() to authenticated;

comment on function public.complete_hospital_onboarding() is
  'Creates one hospital workspace from a private intent captured at auth-user insertion; user metadata is never an authorization source.';
comment on function public.careflow_my_organization() is
  'Returns only the signed-in user''s organization summary; SECURITY DEFINER is required to bridge intentionally unexposed organization data.';
comment on function public.careflow_my_organization_members_v2() is
  'Returns member identity details only for the signed-in user''s organization; SECURITY DEFINER is required to read auth.users.';
comment on function public.careflow_case_review_activity() is
  'Returns field-change markers only for the signed-in user''s organization; stored patient values remain private.';
