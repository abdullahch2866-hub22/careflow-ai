-- Additive release: do not rewrite existing case values or source documents.
-- Run as one migration/transaction after the regression suite passes.
-- This existing DDL event trigger is for the database owner, not the Data API.
do $$ begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;

alter table public.cases
  add column review_notes text,
  add column review_revision bigint not null default 0,
  add column review_confirmed boolean not null default false,
  add column updated_at timestamptz,
  add column updated_by uuid;

create schema if not exists careflow_private;
revoke all on schema careflow_private from public, anon, authenticated;

create table public.case_review_history (
  id uuid primary key default gen_random_uuid(),
  case_id bigint not null references public.cases(id),
  organization_id uuid not null references public.organizations(id),
  actor_id uuid not null,
  changed_at timestamptz not null default clock_timestamp(),
  operation text not null check (operation in ('INSERT', 'UPDATE')),
  before_values jsonb,
  after_values jsonb not null
);
alter table public.case_review_history enable row level security;
revoke all on public.case_review_history from public, anon, authenticated;
grant select on public.case_review_history to authenticated;
create index case_review_history_org_case_time_idx
  on public.case_review_history (organization_id, case_id, changed_at desc);
create policy "Hospital members can read case review history"
  on public.case_review_history for select to authenticated
  using (exists (select 1 from public.organization_members om
    where om.user_id = (select auth.uid())
      and om.organization_id = case_review_history.organization_id));

create function public.enforce_case_review()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  details_changed boolean := false;
  initial_extraction boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Sign in before changing a case.' using errcode = '42501';
  end if;

  new.patient_name := nullif(btrim(new.patient_name), '');
  new.document_type := nullif(btrim(new.document_type), '');
  new.insurance_information := nullif(btrim(new.insurance_information), '');
  new.missing_information := nullif(btrim(new.missing_information), '');
  new.review_notes := nullif(btrim(new.review_notes), '');
  if char_length(new.patient_name) > 200 or char_length(new.document_type) > 200
    or char_length(new.insurance_information) > 4000
    or char_length(new.missing_information) > 4000
    or char_length(new.review_notes) > 4000 then
    raise exception 'A review field exceeds its maximum length.' using errcode = '23514';
  end if;
  if new.status is null or new.status not in ('Review', 'Correction Required', 'Completed') then
    raise exception 'Invalid case review status.' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    new.review_revision := 0;
    new.review_confirmed := false;
    if new.status = 'Completed' then
      raise exception 'Save and review a case before approving it.' using errcode = '23514';
    end if;
  else
    if new.id is distinct from old.id
      or new.organization_id is distinct from old.organization_id
      or new.document_id is distinct from old.document_id then
      raise exception 'The case and hospital document links cannot be changed.' using errcode = '23514';
    end if;
    new.review_revision := old.review_revision + 1;
    details_changed := row(new.patient_name, new.document_type, new.document_date,
      new.insurance_information, new.missing_information, new.review_notes)
      is distinct from row(old.patient_name, old.document_type, old.document_date,
      old.insurance_information, old.missing_information, old.review_notes);
    initial_extraction := old.patient_name is null and old.document_date is null
      and old.insurance_information is null and old.missing_information is null
      and old.review_notes is null and new.review_notes is null
      and old.status = 'Review' and old.review_revision = 0;
    if details_changed then
      if not initial_extraction and (new.review_notes is null or new.review_notes is not distinct from old.review_notes) then
        raise exception 'Add a new correction note explaining the changes and their source.' using errcode = '23514';
      end if;
      -- Corrections must be saved, then separately reviewed and approved.
      new.status := case when initial_extraction then 'Review'
        when new.missing_information is not null then 'Correction Required' else 'Review' end;
      new.review_confirmed := false;
    end if;
  end if;

  if new.document_id is not null and not exists (
    select 1 from public.documents d where d.id = new.document_id
      and d.organization_id = new.organization_id
  ) then
    raise exception 'Linked document not found or access denied.' using errcode = '42501';
  end if;

  if new.status = 'Completed' then
    if new.missing_information is not null then
      raise exception 'Resolve the missing information before approving.' using errcode = '23514';
    end if;
    if new.patient_name is null or new.document_type is null
      or new.document_date is null or new.document_id is null then
      raise exception 'Patient name, document type, date, and source document are required for approval.' using errcode = '23514';
    end if;
    if new.review_confirmed is not true then
      raise exception 'Confirm the saved details before approving.' using errcode = '23514';
    end if;
  else
    new.review_confirmed := false;
  end if;
  new.updated_at := clock_timestamp();
  new.updated_by := auth.uid();
  return new;
end;
$$;
revoke all on function public.enforce_case_review() from public, anon, authenticated;
create trigger enforce_case_review before insert or update on public.cases
  for each row execute function public.enforce_case_review();

-- Only the database trigger may insert history. This narrow SECURITY DEFINER
-- function is in an unexposed schema; it never changes authorization or cases.
create function careflow_private.record_case_review()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.organization_members om
    where om.user_id = auth.uid() and om.organization_id = new.organization_id
  ) then
    raise exception 'Hospital membership is required to record a review.' using errcode = '42501';
  end if;
  insert into public.case_review_history
    (case_id, organization_id, actor_id, operation, before_values, after_values)
  values (new.id, new.organization_id, auth.uid(), tg_op,
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end, to_jsonb(new));
  return new;
end;
$$;
revoke all on function careflow_private.record_case_review() from public, anon, authenticated;
create trigger record_case_review after insert or update on public.cases
  for each row execute function careflow_private.record_case_review();

comment on table public.case_review_history is
  'Protected case change history from the correction release onward. Does not constitute a complete healthcare compliance audit.';
notify pgrst, 'reload schema';
