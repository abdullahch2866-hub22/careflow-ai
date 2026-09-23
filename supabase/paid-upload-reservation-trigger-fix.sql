-- CareFlow AI paid upload reservation trigger fix.
--
-- This is an additive function replacement. It does not delete or alter any
-- account, document, case, membership, subscription, or stored object.
-- Supabase Storage records the authenticated JWT subject in owner_id, while
-- auth.uid() is not guaranteed to remain available to an AFTER INSERT trigger.

create or replace function careflow_private.mark_document_upload_used()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id text := nullif(new.owner_id, '');
begin
  if new.bucket_id = 'documents' then
    update careflow_private.document_upload_reservations r
       set uploaded_at = clock_timestamp()
     where r.storage_path = new.name
       and v_owner_id is not null
       and r.created_by::text = v_owner_id
       and r.uploaded_at is null
       and r.expires_at > clock_timestamp()
       and careflow_private.organization_has_paid_access(r.organization_id, r.created_by);

    if not found then
      raise exception 'A valid paid upload reservation is required.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function careflow_private.mark_document_upload_used()
  from public, anon, authenticated, service_role, authenticator;

comment on function careflow_private.mark_document_upload_used() is
  'Consumes a paid one-time upload reservation only when the Storage object owner matches its creator.';
