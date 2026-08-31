-- CareFlow AI production security hardening snapshot
-- Applied to the production Supabase project on 2026-09-01.
-- Keep this file aligned with the live database protections.

-- 1) Source PDFs cannot be read directly by hospital browser sessions.
-- Upload remains protected by the existing organization-scoped INSERT policy.
drop policy if exists "Hospital members can view their own documents flreew_0" on storage.objects;

-- 2) Store full review-history snapshots outside the exposed public schema.
drop view if exists public.case_review_history;

do $$
begin
  if to_regclass('careflow_private.case_review_history_private_data') is null
     and to_regclass('public.case_review_history_private_data') is not null then
    alter table public.case_review_history_private_data set schema careflow_private;
  end if;
end $$;

revoke all on table careflow_private.case_review_history_private_data from public, anon, authenticated;

create or replace function careflow_private.record_case_review()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.organization_members om
    where om.user_id = auth.uid()
      and om.organization_id = new.organization_id
  ) then
    raise exception 'Hospital membership is required to record a review.' using errcode = '42501';
  end if;

  insert into careflow_private.case_review_history_private_data
    (case_id, organization_id, actor_id, operation, before_values, after_values)
  values (
    new.id,
    new.organization_id,
    auth.uid(),
    tg_op,
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new)
  );

  return new;
end;
$$;

-- The browser receives only field-change markers, never the stored patient values.
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
set search_path = public, careflow_private, pg_catalog, auth
as $$
  select
    h.id,
    h.case_id,
    h.organization_id,
    h.actor_id,
    h.changed_at,
    h.operation,
    '{}'::jsonb as before_values,
    jsonb_strip_nulls(jsonb_build_object(
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

revoke all on function public.careflow_case_review_activity() from public, anon;
grant execute on function public.careflow_case_review_activity() to authenticated;

create view public.case_review_history
with (security_invoker = true, security_barrier = true)
as
select * from public.careflow_case_review_activity();

revoke all on table public.case_review_history from public, anon, authenticated;
grant select on table public.case_review_history to authenticated;

-- 3) Least-privilege browser grants. RLS remains the tenant-isolation boundary.
revoke all on table public.cases from anon, authenticated;
grant select, insert, update on table public.cases to authenticated;

revoke all on table public.documents from anon, authenticated;
grant select, insert on table public.documents to authenticated;

revoke all on table public.organization_members from anon, authenticated;
grant select on table public.organization_members to authenticated;

revoke all on table public.organizations from anon, authenticated;

revoke all on table public.organization_member_audit from anon, authenticated;
grant select on table public.organization_member_audit to authenticated;

revoke all on table public.careflow_onboarding_completions from anon, authenticated;
revoke all on table public.document_access_audit from anon, authenticated;

-- The secure source-viewer Edge Function records views with service-role credentials.
revoke all on table public.document_access_audit from service_role;
grant insert on table public.document_access_audit to service_role;

-- Retire the older organization-members RPC; the frontend uses the scoped v2 function.
revoke execute on function public.careflow_my_organization_members() from authenticated;

-- 4) Indexes supporting tenant/FK lookups.
create index if not exists case_review_history_case_id_idx
  on careflow_private.case_review_history_private_data(case_id);
create index if not exists cases_document_id_idx on public.cases(document_id);
create index if not exists cases_organization_id_idx on public.cases(organization_id);
create index if not exists document_access_audit_case_id_idx on public.document_access_audit(case_id);
create index if not exists documents_organization_id_idx on public.documents(organization_id);
create index if not exists organization_member_audit_actor_user_id_idx on public.organization_member_audit(actor_user_id);
create index if not exists organization_member_audit_organization_id_idx on public.organization_member_audit(organization_id);
create index if not exists organization_member_audit_target_user_id_idx on public.organization_member_audit(target_user_id);
drop index if exists public.organization_members_one_hospital_per_user_idx;

-- 5) Case creation/update metadata cannot be client-forged.
create or replace function public.enforce_case_insert_metadata()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_document_file_name text;
begin
  if auth.uid() is null then
    raise exception 'Sign in before creating a case.' using errcode = '42501';
  end if;

  if new.organization_id is null or new.document_id is null then
    raise exception 'A linked hospital document is required.' using errcode = '23514';
  end if;

  select d.file_name
    into v_document_file_name
  from public.documents d
  where d.id = new.document_id
    and d.organization_id = new.organization_id;

  if v_document_file_name is null then
    raise exception 'Linked document not found or access denied.' using errcode = '42501';
  end if;

  new.file_name := v_document_file_name;
  new.created_at := clock_timestamp();
  new.status := 'Review';
  new.review_revision := 0;
  new.review_confirmed := false;
  new.updated_at := null;
  new.updated_by := null;

  return new;
end;
$$;

drop trigger if exists enforce_case_insert_metadata on public.cases;
create trigger enforce_case_insert_metadata
before insert on public.cases
for each row execute function public.enforce_case_insert_metadata();

create or replace function public.enforce_case_immutable_metadata()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.created_at is distinct from old.created_at
     or new.file_name is distinct from old.file_name then
    raise exception 'Case creation metadata cannot be changed.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_case_immutable_metadata on public.cases;
create trigger enforce_case_immutable_metadata
before update on public.cases
for each row execute function public.enforce_case_immutable_metadata();

alter table public.cases alter column id set generated always;

-- 6) Document-row creation must match a real hospital-scoped private PDF path.
create or replace function public.enforce_document_insert_metadata()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_expected_prefix text;
begin
  if auth.uid() is null then
    raise exception 'Sign in before creating a document.' using errcode = '42501';
  end if;

  new.file_name := nullif(btrim(new.file_name), '');
  new.document_type := nullif(btrim(new.document_type), '');
  new.status := coalesce(nullif(btrim(new.status), ''), 'Review');

  if new.organization_id is null then
    raise exception 'Hospital organization is required.' using errcode = '23514';
  end if;
  if new.file_name is null or char_length(new.file_name) > 255 or new.file_name !~* '\.pdf$' then
    raise exception 'A valid PDF filename is required.' using errcode = '23514';
  end if;
  if new.document_type is not null and char_length(new.document_type) > 200 then
    raise exception 'Document type is too long.' using errcode = '23514';
  end if;
  if new.status <> 'Review' then
    raise exception 'New documents must begin in Review status.' using errcode = '23514';
  end if;

  v_expected_prefix := new.organization_id::text || '/';
  if new.storage_path is null
     or not new.storage_path like v_expected_prefix || '%'
     or new.storage_path like '%\\%'
     or new.storage_path like '%/../%'
     or new.storage_path like '%/./%'
     or new.storage_path !~* '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$' then
    raise exception 'Document storage path is invalid.' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.organization_members om
    where om.user_id = auth.uid()
      and om.organization_id = new.organization_id
  ) then
    raise exception 'Hospital membership is required.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_document_insert_metadata on public.documents;
create trigger enforce_document_insert_metadata
before insert on public.documents
for each row execute function public.enforce_document_insert_metadata();
