import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(new URL('../supabase/monitoring-backup-recovery.sql', import.meta.url), 'utf8');
const recovery = fs.readFileSync(new URL('../supabase/RECOVERY.md', import.meta.url), 'utf8');

test('health snapshots are private, PHI-free, constrained and retained for 90 days', () => {
  assert.match(sql, /operational_health_snapshots[\s\S]*enable row level security/i);
  assert.match(sql, /revoke all on table careflow_private\.operational_health_snapshots/i);
  assert.match(sql, /revoke all on sequence careflow_private\.operational_health_snapshots_id_seq/i);
  assert.match(sql, /check \(status in \('healthy', 'watch', 'attention'\)\)/i);
  assert.match(sql, /captured_at < clock_timestamp\(\) - interval '90 days'/i);
  assert.doesNotMatch(sql, /patient_name|insurance_information|review_notes/);
});

test('health capture monitors capacity, processing and Storage integrity', () => {
  for (const signal of [
    'database_bytes', 'stuck_processing_count', 'failed_processing_24h_count',
    'missing_source_object_count', 'orphan_storage_object_count',
    'legacy_document_without_path_count'
  ]) assert.match(sql, new RegExp(signal));
  assert.match(sql, /d\.storage_path is not null and o\.id is null/i);
  assert.match(sql, /o\.bucket_id = 'documents' and d\.id is null/i);
});

test('stuck processing uses the existing guarded failure function and stays retryable', () => {
  assert.match(sql, /processing_started_at < clock_timestamp\(\) - interval '15 minutes'/i);
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /careflow_fail_document_processing/i);
  assert.match(sql, /'processing_timeout'/i);
  assert.match(sql, /true\s*\) then/i);
});

test('scheduled jobs use supported cron functions and bounded schedules', () => {
  assert.match(sql, /create extension if not exists pg_cron with schema pg_catalog/i);
  assert.match(sql, /cron\.unschedule\(v_job_id\)/i);
  assert.match(sql, /'careflow-operational-recovery'[\s\S]*'\*\/10 \* \* \* \*'/i);
  assert.match(sql, /'careflow-health-snapshot'[\s\S]*'5 \* \* \* \*'/i);
  assert.doesNotMatch(sql, /insert\s+into\s+cron\.job|update\s+cron\.job/i);
});

test('browser and service roles cannot read or run operational internals', () => {
  assert.match(sql, /revoke all on function careflow_private\.capture_operational_health\(\)[\s\S]*authenticated, service_role/i);
  assert.match(sql, /revoke all on function careflow_private\.run_operational_recovery\(\)[\s\S]*authenticated, service_role/i);
});

test('recovery plan states Free-plan and Storage backup limits without false claims', () => {
  assert.match(recovery, /Free plan/i);
  assert.match(recovery, /do\s+not include the PDF bytes stored through the Storage API/i);
  assert.match(recovery, /fictional data only/i);
  assert.match(recovery, /paid production plan/i);
  assert.match(recovery, /Never store\s+patient PDFs in GitHub/i);
  assert.match(recovery, /Never create a duplicate case/i);
});
