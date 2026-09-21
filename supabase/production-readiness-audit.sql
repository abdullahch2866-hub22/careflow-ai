-- CareFlow AI read-only production readiness report.
-- Run as the project owner in the Supabase SQL editor. The statements return
-- aggregate health and permission metadata only; they do not change any data.

select
  captured_at,
  status,
  database_bytes,
  case_count,
  document_count,
  storage_object_count,
  stuck_processing_count,
  failed_processing_24h_count,
  missing_source_object_count,
  orphan_storage_object_count,
  legacy_document_without_path_count
from careflow_private.operational_health_snapshots
order by captured_at desc
limit 1;

select
  test_mode,
  status,
  pg_catalog.count(*) as subscription_count
from public.organization_subscriptions
group by test_mode, status
order by test_mode, status;

select
  (select pg_catalog.count(*)
     from storage.objects o
     left join public.documents d on d.storage_path = o.name
    where o.bucket_id = 'documents' and d.id is null) as orphan_storage_object_count,
  (select pg_catalog.count(*)
     from public.documents d
    where d.storage_path is null) as legacy_document_without_path_count,
  (select pg_catalog.count(*)
     from public.documents d
     left join storage.objects o
       on o.bucket_id = 'documents' and o.name = d.storage_path
    where d.storage_path is not null and o.id is null) as missing_source_object_count;

select
  pg_catalog.count(*) as auth_user_count,
  pg_catalog.count(*) filter (where email_confirmed_at is not null) as confirmed_user_count,
  pg_catalog.count(*) filter (where banned_until > pg_catalog.now()) as currently_banned_user_count
from auth.users;

select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as row_level_security_enabled
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p')
  and n.nspname in ('public', 'careflow_private')
order by n.nspname, c.relname;

select
  p.oid::pg_catalog.regprocedure::text as function_name,
  p.prosecdef as security_definer,
  p.proconfig as function_configuration,
  pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
  pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_can_execute
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'careflow_private')
  and (
    p.prosecdef
    or p.proname like 'careflow_service_%'
    or p.proname in (
      'complete_hospital_onboarding',
      'careflow_my_organization',
      'careflow_my_organization_members_v2',
      'careflow_reserve_document_upload',
      'careflow_case_review_activity'
    )
  )
order by function_name;
