-- CareFlow AI paid-access gate.
--
-- This is an additive release file. It does not delete accounts, documents,
-- cases, memberships, or billing records. Unpaid hospitals retain read-only
-- access to their existing workspace. Paid writes require either:
--   * the live CareFlow price with an active/on-trial live subscription, or
--   * the isolated Sandbox price for the one designated Sandbox test user.

create or replace function careflow_private.organization_has_paid_access(
  p_organization_id uuid,
  p_actor_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_organization_id is not null
    and p_actor_id is not null
    and exists (
      select 1
      from public.organization_members om
      join public.organization_subscriptions os
        on os.organization_id = om.organization_id
      where om.organization_id = p_organization_id
        and om.user_id = p_actor_id
        and os.provider = 'paddle'
        and os.status in ('active', 'on_trial')
        and (
          (
            os.test_mode is false
            and os.provider_variant_id = 'pri_01m2gcpjxz4wqjft7z10zcz3zq'
          )
          or
          (
            os.test_mode is true
            and os.provider_variant_id = 'pri_01m2xtx7y26neywx40s3v3s5k3'
            and p_actor_id = '5ebb6f53-f8b6-464d-af65-c19fa3a28e85'::uuid
          )
        )
    );
$$;

revoke all on function careflow_private.organization_has_paid_access(uuid, uuid)
  from public, anon, authenticated, service_role, authenticator;
grant usage on schema careflow_private to authenticated;

comment on function careflow_private.organization_has_paid_access(uuid, uuid) is
  'Private entitlement predicate. Live subscriptions unlock members; Sandbox unlocks only the designated test user.';

-- The browser-callable predicate derives the actor from the verified JWT. It
-- cannot be used to ask about another user or grant access to another hospital.
create or replace function public.careflow_has_paid_access(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select careflow_private.organization_has_paid_access(p_organization_id, auth.uid());
$$;

revoke all on function public.careflow_has_paid_access(uuid)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.careflow_has_paid_access(uuid) to authenticated;

comment on function public.careflow_has_paid_access(uuid) is
  'Returns only whether the signed-in member has paid CareFlow access for the asserted organization.';

-- Browser case/document writes remain protected by their existing permissive
-- hospital RLS policies. These restrictive policies add the paid requirement.
drop policy if exists "Paid hospitals can create documents" on public.documents;
create policy "Paid hospitals can create documents"
on public.documents
as restrictive
for insert
to authenticated
with check (
  public.careflow_has_paid_access(organization_id)
);

drop policy if exists "Paid hospitals can create cases" on public.cases;
create policy "Paid hospitals can create cases"
on public.cases
as restrictive
for insert
to authenticated
with check (
  public.careflow_has_paid_access(organization_id)
);

drop policy if exists "Paid hospitals can update cases" on public.cases;
create policy "Paid hospitals can update cases"
on public.cases
as restrictive
for update
to authenticated
using (
  public.careflow_has_paid_access(organization_id)
)
with check (
  public.careflow_has_paid_access(organization_id)
);

-- Reserve no Storage path until the hospital is entitled. This is the first
-- upload boundary and therefore prevents unpaid uploads before any bytes move.
create or replace function public.careflow_reserve_document_upload()
returns table (storage_path text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_organization uuid;
  v_reservation uuid := gen_random_uuid();
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null then
    raise exception 'Sign in before uploading a document.' using errcode = '42501';
  end if;

  select om.organization_id into v_organization
  from public.organization_members om
  where om.user_id = v_actor;

  if v_organization is null then
    raise exception 'Hospital membership is required.' using errcode = '42501';
  end if;

  if not careflow_private.organization_has_paid_access(v_organization, v_actor) then
    raise exception 'An active CareFlow subscription is required before uploading documents.' using errcode = 'P0001';
  end if;

  -- Serialize quota and entitlement decisions for this hospital.
  perform 1 from public.organizations o where o.id = v_organization for update;

  if not careflow_private.organization_has_paid_access(v_organization, v_actor) then
    raise exception 'An active CareFlow subscription is required before uploading documents.' using errcode = 'P0001';
  end if;

  if (select count(*) from careflow_private.document_upload_reservations r
      where r.created_by = v_actor and r.created_at >= v_now - interval '1 hour') >= 20 then
    raise exception 'Upload limit reached. Please wait before uploading more documents.' using errcode = 'P0001';
  end if;

  if (select count(*) from careflow_private.document_upload_reservations r
      where r.organization_id = v_organization and r.created_at >= v_now - interval '1 day') >= 100 then
    raise exception 'Your hospital has reached its daily upload limit. Please try again tomorrow.' using errcode = 'P0001';
  end if;

  insert into careflow_private.document_upload_reservations
    (id, organization_id, created_by, storage_path, created_at, expires_at)
  values
    (v_reservation, v_organization, v_actor, v_organization::text || '/' || v_reservation::text || '.pdf', v_now, v_now + interval '15 minutes');

  return query select v_organization::text || '/' || v_reservation::text || '.pdf', v_now + interval '15 minutes';
end;
$$;

revoke all on function public.careflow_reserve_document_upload()
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.careflow_reserve_document_upload() to authenticated;

-- Recheck entitlement when Storage consumes a reservation. A reservation made
-- before a billing-state change cannot be used after access becomes read-only.
create or replace function careflow_private.storage_upload_is_reserved(p_storage_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from careflow_private.document_upload_reservations r
    where r.storage_path = p_storage_path
      and r.created_by = auth.uid()
      and r.uploaded_at is null
      and r.expires_at > clock_timestamp()
      and careflow_private.organization_has_paid_access(r.organization_id, auth.uid())
      and exists (
        select 1 from public.organization_members om
        where om.user_id = auth.uid() and om.organization_id = r.organization_id
      )
  );
$$;

revoke all on function careflow_private.storage_upload_is_reserved(text)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function careflow_private.storage_upload_is_reserved(text) to authenticated;

create or replace function careflow_private.mark_document_upload_used()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.bucket_id = 'documents' then
    update careflow_private.document_upload_reservations r
       set uploaded_at = clock_timestamp()
     where r.storage_path = new.name
       and r.created_by = auth.uid()
       and r.uploaded_at is null
       and r.expires_at > clock_timestamp()
       and careflow_private.organization_has_paid_access(r.organization_id, auth.uid());
    if not found then
      raise exception 'A valid paid upload reservation is required.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function careflow_private.mark_document_upload_used()
  from public, anon, authenticated, service_role, authenticator;

-- The processor is service-role only, but it still receives and validates the
-- original user identity. Entitlement is checked before any AI attempt starts.
create or replace function public.careflow_claim_document_processing(
  p_case_id bigint, p_document_id uuid, p_organization_id uuid, p_actor_id uuid
)
returns table(claimed boolean, claim_state text, run_id uuid, attempt_number integer, retryable boolean, message text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.cases%rowtype;
  v_run_id uuid;
  v_attempt integer;
  v_now timestamptz := clock_timestamp();
begin
  if p_actor_id is null
     or not exists(select 1 from public.organization_members om where om.user_id=p_actor_id and om.organization_id=p_organization_id) then
    return query select false,'access_denied'::text,null::uuid,0,false,'Hospital access changed.'::text; return;
  end if;

  if not careflow_private.organization_has_paid_access(p_organization_id, p_actor_id) then
    return query select false,'subscription_required'::text,null::uuid,0,false,'An active CareFlow subscription is required. Open Billing to restore processing access.'::text; return;
  end if;

  select * into v_case from public.cases c
  where c.id=p_case_id and c.document_id=p_document_id and c.organization_id=p_organization_id for update;
  if not found then return query select false,'not_found'::text,null::uuid,0,false,'Case not found.'::text; return; end if;
  if v_case.processing_status='ready' then return query select false,'ready'::text,v_case.processing_run_id,v_case.processing_attempts,false,'Document is already processed.'::text; return; end if;
  if v_case.review_revision>0 or v_case.review_notes is not null or v_case.status<>'Review' or v_case.patient_name is not null or v_case.document_date is not null or v_case.insurance_information is not null or v_case.missing_information is not null then return query select false,'reviewed'::text,v_case.processing_run_id,v_case.processing_attempts,false,'This case already contains review data.'::text; return; end if;
  if v_case.processing_status='failed' and v_case.processing_retryable is not true then return query select false,'not_retryable'::text,v_case.processing_run_id,v_case.processing_attempts,false,coalesce(v_case.processing_error_message,'This document must be re-uploaded.')::text; return; end if;
  if v_case.processing_status='processing' and v_case.processing_started_at is not null and v_case.processing_started_at>v_now-interval '10 minutes' then return query select false,'processing'::text,v_case.processing_run_id,v_case.processing_attempts,true,'Processing is already running.'::text; return; end if;
  if v_case.processing_attempts>=5 then return query select false,'retry_limit'::text,v_case.processing_run_id,v_case.processing_attempts,false,'Retry limit reached. Contact your CareFlow administrator.'::text; return; end if;

  perform 1 from public.organizations o where o.id=p_organization_id for update;
  if not careflow_private.organization_has_paid_access(p_organization_id, p_actor_id) then
    return query select false,'subscription_required'::text,null::uuid,v_case.processing_attempts,false,'An active CareFlow subscription is required. Open Billing to restore processing access.'::text; return;
  end if;
  if (select count(*) from careflow_private.document_processing_attempts a
      where a.requested_by=p_actor_id and a.started_at>=v_now-interval '1 hour') >= 10 then
    return query select false,'rate_limit'::text,null::uuid,v_case.processing_attempts,true,'AI processing limit reached. Please wait before trying again.'::text; return;
  end if;
  if (select count(*) from careflow_private.document_processing_attempts a
      where a.organization_id=p_organization_id and a.started_at>=v_now-interval '1 day') >= 100 then
    return query select false,'daily_limit'::text,null::uuid,v_case.processing_attempts,true,'Your hospital has reached its daily AI processing limit. Please try again tomorrow.'::text; return;
  end if;
  if (select count(*) from careflow_private.document_processing_attempts a
      where a.organization_id=p_organization_id and a.status='processing' and a.started_at>=v_now-interval '10 minutes') >= 3 then
    return query select false,'busy'::text,null::uuid,v_case.processing_attempts,true,'Your hospital already has several documents processing. Please try again shortly.'::text; return;
  end if;

  v_run_id:=gen_random_uuid(); v_attempt:=v_case.processing_attempts+1;
  perform set_config('careflow.processing_context','on',true); perform set_config('careflow.processing_actor',p_actor_id::text,true);
  update public.cases c set processing_status='processing',processing_error_code=null,processing_error_message=null,processing_attempts=v_attempt,processing_started_at=v_now,processing_completed_at=null,processing_run_id=v_run_id,processing_requested_by=p_actor_id,processing_retryable=true where c.id=p_case_id;
  update careflow_private.document_processing_attempts set status='superseded',finished_at=v_now where case_id=p_case_id and status='processing';
  insert into careflow_private.document_processing_attempts(case_id,document_id,organization_id,run_id,attempt_number,requested_by,status,started_at) values(p_case_id,p_document_id,p_organization_id,v_run_id,v_attempt,p_actor_id,'processing',v_now);
  return query select true,'claimed'::text,v_run_id,v_attempt,true,'Processing started.'::text;
end;
$$;

revoke all on function public.careflow_claim_document_processing(bigint,uuid,uuid,uuid)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.careflow_claim_document_processing(bigint,uuid,uuid,uuid)
  to service_role;

-- Edge Functions use this service-only check before staff mutations. The
-- browser cannot call it and it reveals only a boolean for an asserted member.
create or replace function public.careflow_service_has_paid_access(
  p_organization_id uuid,
  p_actor_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select careflow_private.organization_has_paid_access(p_organization_id, p_actor_id);
$$;

revoke all on function public.careflow_service_has_paid_access(uuid, uuid)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.careflow_service_has_paid_access(uuid, uuid)
  to service_role;

comment on function public.careflow_service_has_paid_access(uuid, uuid) is
  'Service-only entitlement check for authenticated Edge Function write paths.';

notify pgrst, 'reload schema';
