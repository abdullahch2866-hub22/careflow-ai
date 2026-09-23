// Synthetic-only security tests for the payment foundation. No provider calls are made.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(new URL('../supabase/billing-foundation.sql', import.meta.url), 'utf8');
const checkout = fs.readFileSync(new URL('../supabase/functions/create-billing-checkout/index.ts', import.meta.url), 'utf8');
const sandboxCheckout = fs.readFileSync(new URL('../supabase/functions/create-billing-checkout-sandbox/index.ts', import.meta.url), 'utf8');
const webhook = fs.readFileSync(new URL('../supabase/functions/billing-webhook/index.ts', import.meta.url), 'utf8');
const sandboxWebhook = fs.readFileSync(new URL('../supabase/functions/billing-webhook-sandbox/index.ts', import.meta.url), 'utf8');
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
  assert.match(sql, /p_price_id = 'pri_01m2gcpjxz4wqjft7z10zcz3zq' and p_test_mode is false/i);
  assert.match(sql, /p_price_id = 'pri_01m2xtx7y26neywx40s3v3s5k3' and p_test_mode is true/i);
  assert.match(sql, /requested_at >= clock_timestamp\(\) - interval '15 minutes'/);
});

test('Sandbox checkout is fixed to the designated test identity and Sandbox price', () => {
  assert.match(sandboxCheckout, /withSupabase\(\{ auth: "user" \}/);
  assert.match(sandboxCheckout, /SANDBOX_TEST_USER_ID = "5ebb6f53-f8b6-464d-af65-c19fa3a28e85"/);
  assert.match(sandboxCheckout, /SANDBOX_TEST_EMAIL = "careflow\.test@example\.com"/);
  assert.match(sandboxCheckout, /PADDLE_PRICE_ID = "pri_01m2xtx7y26neywx40s3v3s5k3"/);
  assert.match(sandboxCheckout, /Deno\.env\.get\("PADDLE_SANDBOX_WEBHOOK_SECRET"\)/);
  assert.match(sandboxCheckout, /membership\.role !== "admin"/);
  assert.doesNotMatch(sandboxCheckout, /PADDLE_API_KEY|fetch\s*\(/);
});

test('webhooks verify Paddle raw-body signatures before parsing and reject replay', () => {
  for (const source of [webhook, sandboxWebhook]) {
    const bodyRead = source.indexOf('const rawBody = await req.text()');
    const signatureCheck = source.indexOf('constantTimeEqual(signature, expectedSignature)');
    const jsonParse = source.indexOf('payload = JSON.parse(rawBody)');
    assert.ok(bodyRead > -1 && signatureCheck > bodyRead && jsonParse > signatureCheck);
    assert.match(source, /crypto\.subtle\.importKey\([\s\S]*"HMAC"[\s\S]*"SHA-256"/);
    assert.match(source, /Paddle-Signature/);
    assert.match(source, /\$\{timestamp\}:\$\{rawBody\}/);
    assert.match(source, /SIGNATURE_TOLERANCE_SECONDS/);
    assert.match(source, /MAX_WEBHOOK_BYTES/);
  }
  assert.match(sandboxWebhook, /Deno\.env\.get\("PADDLE_SANDBOX_WEBHOOK_SECRET"\)/);
  assert.match(sandboxWebhook, /p_test_mode: true/);
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
  assert.match(html, /checkoutFunction: "create-billing-checkout"/);
  assert.match(html, /checkoutFunction: "create-billing-checkout-sandbox"/);
  assert.match(html, /functions\.invoke\(paddleBillingConfig\.checkoutFunction, \{ body: \{\} \}\)/);
  assert.match(html, /Paddle\.Checkout\.open\(checkoutOptions\)/);
  assert.match(html, /items: \[\{ priceId: paddleBillingConfig\.priceId, quantity: 1 \}\]/);
  assert.match(html, /customData: \{ careflow_checkout_reference: checkoutReference \}/);
  assert.match(html, /PADDLE_CLIENT_TOKEN = "live_30378679accd73c018c6de9b176"/);
  assert.match(html, /PADDLE_SANDBOX_CLIENT_TOKEN = "test_fb2fffc73e4082c03cd98733a95"/);
  assert.match(html, /PADDLE_SANDBOX_PRICE_ID = "pri_01m2xtx7y26neywx40s3v3s5k3"/);
  assert.match(html, /LIVE_CHECKOUT_ENABLED = false/);
  assert.match(checkout, /PADDLE_LIVE_CHECKOUT_ENABLED/);
  assert.match(html, /Paddle\.Environment\.set\("sandbox"\)/);
  assert.match(html, /provider_customer_id/);
  assert.match(html, /pwCustomer: paddleRetainCustomer\(\)/);
  assert.match(html, /Paddle\.Update\(\{ pwCustomer: paddleRetainCustomer\(\) \}\)/);
  assert.ok(
    html.indexOf('window.Paddle.Environment.set("sandbox")') < html.indexOf('window.Paddle.Initialize(initializeOptions)'),
    'Paddle Sandbox mode must be selected before Paddle initializes'
  );
  assert.match(html, /event\?\.name === "checkout\.loaded"[\s\S]*Secure Paddle checkout opened\./);
  assert.match(html, /event\?\.name === "checkout\.error"[\s\S]*Secure checkout could not open\./);
  assert.match(html, /event\?\.name === "checkout\.closed"[\s\S]*Secure checkout closed\. No payment was made\./);
  assert.match(html, /Opening secure Paddle checkout[\s\S]*Paddle\.Checkout\.open\(checkoutOptions\)/);
  assert.doesNotMatch(html, /PADDLE_(API_KEY|WEBHOOK_SECRET)/);
  assert.match(webhook, /p_test_mode: false/);
  assert.doesNotMatch(webhook, /PADDLE_ENVIRONMENT/);
  assert.match(webhook, /https:\/\/api\.paddle\.com\/ips/);
  assert.match(webhook, /cf-connecting-ip/);
  assert.doesNotMatch(webhook, /34\.237\.3\.244/);
  assert.match(pricing, /\$99[\s\S]*USD \/ month/);
  assert.match(pricing, /cdn\.paddle\.com\/paddle\/v2\/paddle\.js/);
});
