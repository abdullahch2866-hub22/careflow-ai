-- CareFlow AI operational monitoring and automatic recovery baseline.
-- Stores counts and health signals only; never copies patient fields or PDF data.

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

create table if not exists careflow_private.operational_health_snapshots (
  id bigint generated always as identity primary key,
  captured_at timestamptz not null default clock_timestamp(),
  status text not null,
  database_bytes bigint not null,
  case_count bigint not null,
  document_count bigint not null,
  storage_object_count bigint not null,
  stuck_processing_count bigint not null,
  failed_processing_24h_count bigint not null,
  missing_source_object_count bigint not null,
  orphan_storage_object_count bigint not null,
  legacy_document_without_path_count bigint not null,
  constraint operational_health_status_check
    check (status in ('healthy', 'watch', 'attention')),
  constraint operational_health_nonnegative_check
    check (
      database_bytes >= 0 and case_count >= 0 and document_count >= 0
      and storage_object_count >= 0 and stuck_processing_count >= 0
      and failed_processing_24h_count >= 0 and missing_source_object_count >= 0
      and orphan_storage_object_count >= 0 and legacy_document_without_path_count >= 0
    )
);

alter table careflow_private.operational_health_snapshots enable row level security;
revoke all on table careflow_private.operational_health_snapshots
  from public, anon, authenticated, service_role, authenticator;
revoke all on sequence careflow_private.operational_health_snapshots_id_seq
  from public, anon, authenticated, service_role, authenticator;

create index if not exists operational_health_snapshots_captured_idx
  on careflow_private.operational_health_snapshots (captured_at desc);

create or replace function careflow_private.capture_operational_health()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_database_bytes bigint;
  v_cases bigint;
  v_documents bigint;
  v_storage_objects bigint;
  v_stuck bigint;
  v_failed bigint;
  v_missing bigint;
  v_orphan bigint;
  v_legacy bigint;
  v_status text;
  v_snapshot_id bigint;
begin
  select pg_catalog.pg_database_size(pg_catalog.current_database()) into v_database_bytes;
  select pg_catalog.count(*) into v_cases from public.cases;
  select pg_catalog.count(*) into v_documents from public.documents;
  select pg_catalog.count(*) into v_storage_objects from storage.objects o where o.bucket_id = 'documents';
  select pg_catalog.count(*) into v_stuck
    from public.cases c
    where c.processing_status = 'processing'
      and c.processing_started_at < clock_timestamp() - interval '15 minutes';
  select pg_catalog.count(*) into v_failed
    from public.cases c
    where c.processing_status = 'failed'
      and c.processing_completed_at >= clock_timestamp() - interval '24 hours';
  select pg_catalog.count(*) into v_missing
    from public.documents d
    left join storage.objects o
      on o.bucket_id = 'documents' and o.name = d.storage_path
    where d.storage_path is not null and o.id is null;
  select pg_catalog.count(*) into v_orphan
    from storage.objects o
    left join public.documents d on d.storage_path = o.name
    where o.bucket_id = 'documents' and d.id is null;
  select pg_catalog.count(*) into v_legacy
    from public.documents d where d.storage_path is null;

  v_status := case
    when v_stuck > 0 or v_failed >= 5 or v_missing > 0 then 'attention'
    when v_orphan > 0 then 'watch'
    else 'healthy'
  end;

  insert into careflow_private.operational_health_snapshots (
    status, database_bytes, case_count, document_count, storage_object_count,
    stuck_processing_count, failed_processing_24h_count,
    missing_source_object_count, orphan_storage_object_count,
    legacy_document_without_path_count
  ) values (
    v_status, v_database_bytes, v_cases, v_documents, v_storage_objects,
    v_stuck, v_failed, v_missing, v_orphan, v_legacy
  ) returning id into v_snapshot_id;

  return v_snapshot_id;
end;
$$;

create or replace function careflow_private.run_operational_recovery()
returns table (
  recovered_stuck_cases integer,
  removed_expired_reservations integer,
  removed_old_health_snapshots integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case record;
  v_recovered integer := 0;
  v_reservations integer := 0;
  v_snapshots integer := 0;
begin
  for v_case in
    select c.id, c.document_id, c.organization_id, c.processing_run_id
    from public.cases c
    where c.processing_status = 'processing'
      and c.processing_started_at < clock_timestamp() - interval '15 minutes'
      and c.processing_run_id is not null
    order by c.processing_started_at
    for update skip locked
    limit 100
  loop
    if public.careflow_fail_document_processing(
      v_case.id,
      v_case.document_id,
      v_case.organization_id,
      v_case.processing_run_id,
      'processing_timeout',
      'Processing timed out safely. Please retry.',
      true
    ) then
      v_recovered := v_recovered + 1;
    end if;
  end loop;

  delete from careflow_private.document_upload_reservations r
  where r.expires_at < clock_timestamp() - interval '7 days';
  get diagnostics v_reservations = row_count;

  delete from careflow_private.operational_health_snapshots h
  where h.captured_at < clock_timestamp() - interval '90 days';
  get diagnostics v_snapshots = row_count;

  return query select v_recovered, v_reservations, v_snapshots;
end;
$$;

revoke all on function careflow_private.capture_operational_health()
  from public, anon, authenticated, service_role, authenticator;
revoke all on function careflow_private.run_operational_recovery()
  from public, anon, authenticated, service_role, authenticator;

comment on table careflow_private.operational_health_snapshots is
  'Private, PHI-free operational counts used to detect processing, Storage, and capacity problems.';
comment on function careflow_private.run_operational_recovery() is
  'Cron-only recovery for stuck processing plus bounded retention cleanup.';

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select j.jobid from cron.job j
    where j.jobname in ('careflow-operational-recovery', 'careflow-health-snapshot')
  loop
    perform cron.unschedule(v_job_id);
  end loop;
end;
$$;

select cron.schedule(
  'careflow-operational-recovery',
  '*/10 * * * *',
  $job$select careflow_private.run_operational_recovery();$job$
);

select cron.schedule(
  'careflow-health-snapshot',
  '5 * * * *',
  $job$select careflow_private.capture_operational_health();$job$
);

select careflow_private.capture_operational_health();
