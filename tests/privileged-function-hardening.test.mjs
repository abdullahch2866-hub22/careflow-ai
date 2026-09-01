import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(
  new URL('../supabase/privileged-function-hardening.sql', import.meta.url),
  'utf8'
);

const onboarding = sql.match(
  /create or replace function public\.complete_hospital_onboarding\(\)[\s\S]*?(?=create or replace function public\.careflow_my_organization\(\))/i
)?.[0] || '';

test('hospital-owner eligibility is captured once when the auth user is inserted', () => {
  assert.match(sql, /create table if not exists careflow_private\.hospital_signup_intents/i);
  assert.match(sql, /after insert on auth\.users/i);
  assert.match(sql, /execute function careflow_private\.capture_hospital_signup_intent\(\)/i);
  assert.match(sql, /on conflict \(user_id\) do nothing/i);
});

test('the onboarding RPC authorizes from the private intent instead of mutable user metadata', () => {
  assert.match(onboarding, /from careflow_private\.hospital_signup_intents i/i);
  assert.match(onboarding, /for update/i);
  assert.match(onboarding, /This account is not eligible to create a hospital workspace/i);
  assert.match(onboarding, /set organization_id = v_existing_org/i);
  assert.doesNotMatch(onboarding, /raw_user_meta_data|careflow_signup_type|careflow_hospital_name/i);
});

test('the private signup intent is deny-by-default for every API role', () => {
  assert.match(sql, /hospital_signup_intents enable row level security/i);
  assert.match(
    sql,
    /revoke all on table careflow_private\.hospital_signup_intents\s+from public, anon, authenticated, service_role, authenticator/i
  );
  assert.match(
    sql,
    /revoke all on function careflow_private\.capture_hospital_signup_intent\(\)\s+from public, anon, authenticated, service_role, authenticator/i
  );
});

test('all browser security-definer functions use an empty search path', () => {
  for (const functionName of [
    'complete_hospital_onboarding',
    'careflow_my_organization',
    'careflow_my_organization_members_v2',
    'careflow_case_review_activity'
  ]) {
    const definition = sql.match(
      new RegExp(`create or replace function public\\.${functionName}\\(\\)[\\s\\S]*?set search_path = ''`, 'i')
    )?.[0] || '';
    assert.ok(definition, `${functionName} must set an empty search_path`);
  }
});

test('privileged browser RPCs are callable only by authenticated users', () => {
  for (const functionName of [
    'complete_hospital_onboarding',
    'careflow_my_organization',
    'careflow_my_organization_members_v2',
    'careflow_case_review_activity'
  ]) {
    assert.match(
      sql,
      new RegExp(
        `revoke all on function public\\.${functionName}\\(\\)\\s+from public, anon, authenticated, service_role, authenticator`,
        'i'
      )
    );
    assert.match(
      sql,
      new RegExp(`grant execute on function public\\.${functionName}\\(\\) to authenticated`, 'i')
    );
  }
});
