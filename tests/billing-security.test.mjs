// Synthetic-only security tests for the payment foundation. No provider calls are made.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(new URL('../supabase/billing-foundation.sql', import.meta.url), 'utf8');
const checkout = fs.readFileSync(new URL('../supabase/functions/create-billing-checkout/index.ts', import.meta.url), 'utf8');
const webhook = fs.readFileSync(new URL('../supabase/functions/billing-webhook/index.ts', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('subscription state is hospital-scoped and browser read-only', () => {
  assert.match(sql, /organization_subscriptions[\s\S]*enable row level security/i);
  assert.match(sql, /Hospital members can view their subscription[\s\S]*om\.user_id = \(select auth\.uid\(\)\)/i);
  assert.match(sql, /revoke all on table public\.organization_subscriptions from public, anon, authenticated/i);
  assert.match(sql, /grant select on table public\.organization_subscriptions to authenticated/i);
  assert.doesNotMatch(sql, /grant (insert|update|delete)[^;]*organization_subscriptions[^;]*authenticated/i);
});

test('payment internals store no card or bank details and are inaccessible to browsers', () => {
  assert.match(sql, /careflow_private\.billing_webhook_events[\s\S]*enable row level security/i);
  assert.match(sql, /revoke all on table careflow_private\.billing_webhook_events from public, anon, authenticated, service_role/i);
  assert.match(sql, /revoke all on table careflow_private\.billing_checkout_attempts from public, anon, authenticated, service_role/i);
  assert.match(sql, /billing_checkout_attempts_user_idx[\s\S]*\(user_id\)/i);
  assert.doesNotMatch(sql, /card_number|card_last_four|bank_account|iban|raw_payload/i);
});

test('checkout is authenticated, admin-only, rate-limited and server-bound to the hospital', () => {
  assert.match(checkout, /withSupabase\(\{ auth: "user" \}/);
  assert.match(checkout, /membership\.role !== "admin"/);
  assert.match(checkout, /careflow_service_reserve_billing_checkout/);
  assert.match(checkout, /organization_id: membership\.organization_id/);
  assert.match(checkout, /careflow_user_id: actor\.id/);
  assert.match(checkout, /CHECKOUT_API = "https:\/\/api\.lemonsqueezy\.com\/v1\/checkouts"/);
  assert.doesNotMatch(checkout, /custom_price/);
  assert.doesNotMatch(checkout, /LEMONSQUEEZY_API_KEY[\s\S]*return Response\.json\([^;]*apiKey/);
});

test('webhook verifies the raw body before parsing and rejects the wrong store or mode', () => {
  const bodyRead = webhook.indexOf('const rawBody = await req.text()');
  const signatureCheck = webhook.indexOf('constantTimeEqual(suppliedSignature, expectedSignature)');
  const jsonParse = webhook.indexOf('payload = JSON.parse(rawBody)');
  assert.ok(bodyRead > -1 && signatureCheck > bodyRead && jsonParse > signatureCheck);
  assert.match(webhook, /crypto\.subtle\.importKey\([\s\S]*"HMAC"[\s\S]*"SHA-256"/);
  assert.match(webhook, /storeId !== expectedStoreId/);
  assert.match(webhook, /testMode !== expectedTestMode/);
  assert.match(webhook, /MAX_WEBHOOK_BYTES/);
});

test('billing events are idempotent and stale provider updates cannot overwrite newer state', () => {
  assert.match(sql, /billing_webhook_events[\s\S]*event_id text primary key/i);
  assert.match(sql, /on conflict \(event_id\) do nothing/i);
  assert.match(sql, /return 'duplicate'/i);
  assert.match(sql, /excluded\.provider_updated_at >= public\.organization_subscriptions\.provider_updated_at/i);
  assert.match(webhook, /eventName.*sha256Hex\(rawBody\)/);
});

test('only the service role can invoke billing mutation functions', () => {
  for (const functionName of [
    'careflow_service_reserve_billing_checkout',
    'careflow_service_apply_billing_event',
  ]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${functionName}\\([\\s\\S]*?set search_path = ''`, 'i'));
    assert.match(sql, new RegExp(`revoke all on function public\\.${functionName}\\([\\s\\S]*?from public, anon, authenticated`, 'i'));
    assert.match(sql, new RegExp(`grant execute on function public\\.${functionName}\\([\\s\\S]*?to service_role`, 'i'));
  }
});

test('workspace billing UI reads scoped status and uses only the protected checkout function', () => {
  assert.match(html, /id="navBilling"[\s\S]*data-view="billing"/);
  assert.match(html, /from\("organization_subscriptions"\)[\s\S]*eq\("organization_id", requestedOrganization\)/);
  assert.match(html, /functions\.invoke\("create-billing-checkout", \{ body: \{\} \}\)/);
  assert.match(html, /checkoutUrl\.hostname\.endsWith\("\.lemonsqueezy\.com"\)/);
  assert.doesNotMatch(html, /LEMONSQUEEZY_(API_KEY|WEBHOOK_SECRET)/);
});
