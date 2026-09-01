-- CareFlow AI processing-attempt audit hardening
--
-- This table is an internal processor audit trail. Browser/API roles must not
-- access it directly. The process-document Edge Function reaches it only
-- through the locked service-only processing RPCs.

alter table careflow_private.document_processing_attempts
  enable row level security;

revoke all on schema careflow_private
  from public, anon, authenticated, service_role, authenticator;

revoke all on table careflow_private.document_processing_attempts
  from public, anon, authenticated, service_role, authenticator;

revoke all on sequence careflow_private.document_processing_attempts_id_seq
  from public, anon, authenticated, service_role, authenticator;

-- Keep future private objects closed by default as defense in depth.
alter default privileges for role postgres in schema careflow_private
  revoke all on tables from public, anon, authenticated, service_role, authenticator;

alter default privileges for role postgres in schema careflow_private
  revoke all on sequences from public, anon, authenticated, service_role, authenticator;

alter default privileges for role postgres in schema careflow_private
  revoke execute on functions from public, anon, authenticated, service_role, authenticator;

-- Cover the three foreign keys and the case-attempt history access pattern.
create index if not exists document_processing_attempts_case_attempt_idx
  on careflow_private.document_processing_attempts (case_id, attempt_number desc);

create index if not exists document_processing_attempts_document_id_idx
  on careflow_private.document_processing_attempts (document_id);

create index if not exists document_processing_attempts_organization_id_idx
  on careflow_private.document_processing_attempts (organization_id);

comment on table careflow_private.document_processing_attempts is
  'Private processor audit trail. Direct API-role access is denied; only locked service RPCs may write attempts.';
