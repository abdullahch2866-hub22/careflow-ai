import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const auditSql = fs.readFileSync(new URL('../supabase/production-readiness-audit.sql', import.meta.url), 'utf8');
const billingSql = fs.readFileSync(new URL('../supabase/billing-foundation.sql', import.meta.url), 'utf8');
const billingSetup = fs.readFileSync(new URL('../supabase/billing-setup.md', import.meta.url), 'utf8');
const readiness = fs.readFileSync(new URL('../PRODUCTION_READINESS.md', import.meta.url), 'utf8');
const homepage = fs.readFileSync(new URL('../public-homepage.html', import.meta.url), 'utf8');

test('production audit is aggregate and read-only', () => {
  const executableSql = auditSql
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  assert.doesNotMatch(
    executableSql,
    /\b(insert\s+into|update\s+|delete\s+from|truncate\s+|drop\s+|alter\s+|create\s+|grant\s+|revoke\s+)\b/i
  );
  for (const signal of [
    'stuck_processing_count',
    'failed_processing_24h_count',
    'missing_source_object_count',
    'orphan_storage_object_count',
    'legacy_document_without_path_count',
    'row_level_security_enabled',
    'anon_can_execute',
    'authenticated_can_execute',
    'service_role_can_execute',
  ]) assert.match(executableSql, new RegExp(signal));
});

test('billing event insert keeps exactly one idempotency conflict clause', () => {
  const definition = billingSql.match(
    /create or replace function public\.careflow_service_apply_paddle_event\([\s\S]*?\n\$function\$;/i
  )?.[0] || '';
  assert.ok(definition, 'billing event function definition must exist');
  assert.equal(
    definition.match(/on conflict \(event_id\) do nothing/gi)?.length || 0,
    1,
    'the billing event insert must have one conflict handler'
  );
});

test('live-payment guidance requires explicit charge approval and Sandbox testing', () => {
  assert.match(billingSetup, /do not complete a live purchase/i);
  assert.match(billingSetup, /isolated Paddle Sandbox/i);
  assert.match(billingSetup, /explicitly approves the real charge/i);
  assert.match(readiness, /real live checkout creates a real charge/i);
  assert.match(readiness, /no data was deleted/i);
});

test('public launch copy accurately describes the connected checkout', () => {
  assert.match(homepage, /secure Paddle checkout/i);
  assert.doesNotMatch(homepage, /Online checkout is not yet available/i);
});
