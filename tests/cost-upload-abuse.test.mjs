import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const processor = fs.readFileSync(new URL('../supabase/functions/process-document/index.ts', import.meta.url), 'utf8');
const sql = fs.readFileSync(new URL('../supabase/ai-cost-upload-abuse-protection.sql', import.meta.url), 'utf8');

test('browser must reserve a server-approved path before uploading bytes', () => {
  assert.match(html, /rpc\("careflow_reserve_document_upload"\)/);
  assert.match(html, /reservation\?\.storage_path/);
  const reservationPosition = html.indexOf('careflow_reserve_document_upload');
  const uploadPosition = html.indexOf('.storage.from("documents").upload', reservationPosition);
  assert.ok(reservationPosition > -1 && uploadPosition > reservationPosition);
  assert.doesNotMatch(html.slice(reservationPosition, uploadPosition), /crypto\.randomUUID/);
});

test('upload reservations are private, expiring, one-time and hospital scoped', () => {
  assert.match(sql, /document_upload_reservations[\s\S]*enable row level security/i);
  assert.match(sql, /revoke all on table careflow_private\.document_upload_reservations/i);
  assert.match(sql, /expires_at > clock_timestamp\(\)/);
  assert.match(sql, /uploaded_at is null/);
  assert.match(sql, /mark_document_upload_used/);
  assert.match(sql, /Allow reserved hospital PDF uploads/);
  assert.match(sql, /storage_upload_is_reserved\(name\)/);
});

test('upload quotas are serialized and enforced per user and hospital', () => {
  assert.match(sql, /from public\.organizations o where o\.id = v_organization for update/i);
  assert.match(sql, /r\.created_by = v_actor[\s\S]*interval '1 hour'\) >= 20/i);
  assert.match(sql, /r\.organization_id = v_organization[\s\S]*interval '1 day'\) >= 100/i);
});

test('AI processing quotas are atomic and checked before creating an attempt', () => {
  assert.match(sql, /from public\.organizations o where o\.id=p_organization_id for update/i);
  assert.match(sql, /a\.requested_by=p_actor_id[\s\S]*interval '1 hour'\) >= 10/i);
  assert.match(sql, /a\.organization_id=p_organization_id[\s\S]*interval '1 day'\) >= 100/i);
  assert.match(sql, /a\.status='processing'[\s\S]*>= 3/i);
  assert.ok(sql.indexOf("'rate_limit'") < sql.indexOf('insert into careflow_private.document_processing_attempts'));
});

test('processor turns every quota state into a clear 429 response', () => {
  assert.match(processor, /claim\.claim_state === "retry_limit" \|\| \["rate_limit", "daily_limit", "busy"\]\.includes\(claim\.claim_state\) \? 429/);
  assert.match(processor, /npm:@supabase\/server@1\.5\.1/);
});

test('only the service role can call the AI claim function', () => {
  assert.match(sql, /revoke all on function public\.careflow_claim_document_processing[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.careflow_claim_document_processing[\s\S]*to service_role/i);
  assert.match(sql, /p_actor_id is null[\s\S]*organization_members/i);
});
