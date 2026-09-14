// Synthetic-only security tests for the payment foundation. No provider calls are made.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(new URL('../supabase/billing-foundation.sql', import.meta.url), 'utf8');
const checkout = fs.readFileSync(new URL('../supabase/functions/create-billing-checkout/index.ts', import.meta.url), 'utf8');
const webhook = fs.readFileSync(new URL('../supabase/functions/billing-webhook/index.ts', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const pricing = fs.readFileSync(new URL('../pricing.html', import.meta.url), 'utf8');

test('subscription state is hospital-scoped and browser read-only', () => {
  assert.match(sql, /organization_subscriptions[\s\S]*enable row level security/i);
  assert.match(sql, /Hospital members can view their subscription[\s\S]*om\.user_id = \(select auth\.uid\(\)\)/i);
  assert.match(sql, /revoke all on table public\.organization_subscriptions from public, anon, authenticated, service_role/i);
  assert.match(sql, /grant select on table public\.organization_subscriptions to authenticated/i);
  assert.doesNotMatch(sql, /grant (insert|update|delete)[^;]*organization_subscriptions[^;]*authenticated/i);
});

test('payment internals store no card or bank details and are inaccessible to browsers', () => {
  for (const table of ['billing_webhook_events', 'billing_checkout_attempts', 'billing_checkout_sessions']) {
    assert.match(sql, new RegExp(`careflow_private\\.${table}[\\s\\S]*enable row level security`, 'i'));
    assert.match(sql, new RegExp(`revoke all on table careflow_private\\.${table} from public, anon, authenticated, service_role`, 'i'));
  }
  assert.match(sql, /billing_checkout_attempts_user_idx[\s\S]*\(user_id\)/i);
  assert.match(sql, /billing_checkout_sessions_organization_idx[\s\S]*\(organization_id, created_at desc\)/i);
  assert.match(sql, /billing_checkout_sessions_user_idx[\s\S]*\(user_id\)/i);
  assert.doesNotMatch(sql, /card_number|card_last_four|bank_account|iban|raw_payload/i);
});

test('checkout is authenticated, admin-only, rate-limited and bound to a one-time server reference', () => {
  assert.match(checkout, /withSupabase\(\{ auth: "user" \}/);
  assert.match(checkout, /membership\.role !== "admin"/);
  assert.match(checkout, /careflow_service_prepare_billing_checkout/);
  assert.match(checkout, /p_organization_id: membership\.organization_id/);
  assert.match(checkout, /p_user_id: actor\.id/);
  assert.match(checkout, /PADDLE_PRICE_ID = "pri_01m2gcpjxz4wqjft7z10zcz3zq"/);
  assert.match(checkout, /Deno\.env\.get\("PADDLE_WEBHOOK_SECRET"\)/);
  assert.doesNotMatch(checkout, /PADDLE_API_KEY/);
  assert.doesNotMatch(checkout, /fetch\s*\(/);
  assert.match(sql, /p_price_id <> 'pri_01m2gcpjxz4wqjft7z10zcz3zq'/);
  assert.match(sql, /requested_at >= clock_timestamp\(\) - interval '15 minutes'/);
});

test('webhook verifies Paddle raw-body signatures before parsing and rejects replay', () => {
  const bodyRead = webhook.indexOf('const rawBody = await req.text()');
  const signatureCheck = webhook.indexOf('constantTimeEqual(signature, expectedSignature)');
  const jsonParse = webhook.indexOf('payload = JSON.parse(rawBody)');
  assert.ok(bodyRead > -1 && signatureCheck > bodyRead && jsonParse > signatureCheck);
  assert.match(webhook, /crypto\.subtle\.importKey\([\s\S]*"HMAC"[\s\S]*"SHA-256"/);
  assert.match(webhook, /Paddle-Signature/);
  assert.match(webhook, /\$\{timestamp\}:\$\{rawBody\}/);
  assert.match(webhook, /SIGNATURE_TOLERANCE_SECONDS/);
  assert.match(webhook, /MAX_WEBHOOK_BYTES/);
});

test('billing events are idempotent, nonce-bound and stale updates cannot overwrite newer state', () => {
  assert.match(sql, /billing_webhook_events[\s\S]*event_id text primary key/i);
  assert.match(sql, /on conflict \(event_id\) do nothing/i);
  assert.match(sql, /return 'duplicate'/i);
  assert.match(sql, /cs\.reference = p_checkout_reference[\s\S]*cs\.expected_price_id = p_price_id/i);
  assert.match(sql, /excluded\.provider_updated_at >= public\.organization_subscriptions\.provider_updated_at/i);
  assert.match(sql, /v_existing_subscription_id <> p_subscription_id[\s\S]*v_existing_status <> 'expired'/i);
});

test('only the service role can invoke billing mutation functions', () => {
  for (const functionName of [
    'careflow_service_prepare_billing_checkout',
    'careflow_service_apply_paddle_event',
  ]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${functionName}\\([\\s\\S]*?set search_path = ''`, 'i'));
    assert.match(sql, new RegExp(`revoke all on function public\\.${functionName}\\([\\s\\S]*?from public, anon, authenticated`, 'i'));
    assert.match(sql, new RegExp(`grant execute on function public\\.${functionName}\\([\\s\\S]*?to service_role`, 'i'));
  }
});

test('workspace opens only the fixed Paddle price through the protected checkout function', () => {
  assert.match(html, /id="navBilling"[\s\S]*data-view="billing"/);
  assert.match(html, /from\("organization_subscriptions"\)[\s\S]*eq\("organization_id", requestedOrganization\)/);
  assert.match(html, /functions\.invoke\("create-billing-checkout", \{ body: \{\} \}\)/);
  assert.match(html, /Paddle\.Checkout\.open\(checkoutOptions\)/);
  assert.match(html, /items: \[\{ priceId: PADDLE_PRICE_ID, quantity: 1 \}\]/);
  assert.match(html, /customData: \{ careflow_checkout_reference: checkoutReference \}/);
  assert.doesNotMatch(html, /PADDLE_(API_KEY|WEBHOOK_SECRET)/);
  assert.match(pricing, /\$99[\s\S]*USD \/ month/);
  assert.match(pricing, /cdn\.paddle\.com\/paddle\/v2\/paddle\.js/);
});
