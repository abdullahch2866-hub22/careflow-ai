// Runs the real billing handlers with synthetic clients. No network or financial data is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

const checkoutSource = fs.readFileSync(
  new URL('../supabase/functions/create-billing-checkout/index.ts', import.meta.url),
  'utf8'
);
const webhookSource = fs.readFileSync(
  new URL('../supabase/functions/billing-webhook/index.ts', import.meta.url),
  'utf8'
);

const organizationId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const userId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const checkoutReference = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const priceId = 'pri_01m2gcpjxz4wqjft7z10zcz3zq';
const eventId = 'evt_01m2gcpjxz4wqjft7z10zcz3zq';
const subscriptionId = 'sub_01h00000000000000000000000';
const customerId = 'ctm_01h11111111111111111111111';

function checkoutFixture(options = {}) {
  const calls = { rpcs: [] };
  const scoped = {
    auth: {
      async getUser() {
        if (options.authDenied) return { data: { user: null }, error: { message: 'Invalid session' } };
        return { data: { user: { id: userId, email: 'admin@example.test' } }, error: null };
      },
    },
    from(table) {
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        async single() {
          assert.equal(table, 'organization_members');
          if (options.noMembership) return { data: null, error: { message: 'Not found' } };
          return { data: { organization_id: organizationId, role: options.role || 'admin' }, error: null };
        },
        async maybeSingle() {
          assert.equal(table, 'organization_subscriptions');
          return { data: options.subscription || null, error: null };
        },
      };
      return builder;
    },
  };
  const admin = {
    async rpc(name, args) {
      calls.rpcs.push({ name, args });
      assert.equal(name, 'careflow_service_prepare_billing_checkout');
      if (options.databaseFailure) return { data: null, error: { message: 'Synthetic failure' } };
      return { data: options.rateLimited ? null : checkoutReference, error: null };
    },
  };
  const executable = stripTypeScriptTypes(checkoutSource.replace(/^import .*;\s*$/gm, ''), { mode: 'strip' })
    .replace('export default', 'const createBillingCheckout =');
  const context = vm.createContext({
    Response, Request,
    console: { error() {} },
    Deno: { env: { get(name) {
      if (name === 'PADDLE_WEBHOOK_SECRET' && !options.missingConfig) return 'synthetic-webhook-secret';
      return null;
    } } },
    withSupabase(config, handler) { assert.equal(config.auth, 'user'); return handler; },
  });
  vm.runInContext(executable, context);

  return {
    calls,
    async invoke(method = 'POST') {
      const handler = vm.runInContext('createBillingCheckout.fetch', context);
      const response = await handler(new Request('https://fixture.invalid/checkout', { method }), {
        supabase: scoped,
        supabaseAdmin: admin,
      });
      return { status: response.status, body: await response.json() };
    },
  };
}

function webhookFixture(options = {}) {
  const calls = { rpcs: [] };
  let handler;
  const executable = stripTypeScriptTypes(webhookSource.replace(/^import .*;\s*$/gm, ''), { mode: 'strip' })
    .replace('Deno.serve(', 'captureHandler(');
  const environment = {
    PADDLE_WEBHOOK_SECRET: 'synthetic-webhook-secret',
    PADDLE_ENVIRONMENT: options.sandbox ? 'sandbox' : 'live',
    SUPABASE_URL: 'https://fixture.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-role-key',
  };
  const context = vm.createContext({
    Response, Request, Date, TextEncoder, Uint8Array, crypto, RegExp,
    console: { error() {} },
    Deno: { env: { get(name) { return environment[name] || null; } } },
    captureHandler(value) { handler = value; },
    createClient() {
      return {
        async rpc(name, args) {
          calls.rpcs.push({ name, args });
          return options.databaseFailure
            ? { data: null, error: { code: 'synthetic_failure' } }
            : { data: options.result || 'applied', error: null };
        },
      };
    },
  });
  vm.runInContext(executable, context);

  async function sign(timestamp, body) {
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(environment.PADDLE_WEBHOOK_SECRET),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const signedPayload = `${timestamp}:${body}`;
    const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload)));
    return Array.from(signature, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  return {
    calls,
    async invoke(payload, options = {}) {
      const body = JSON.stringify(payload);
      const timestamp = options.timestamp || String(Math.floor(Date.now() / 1000));
      const signature = options.signature ?? await sign(timestamp, body);
      const response = await handler(new Request('https://fixture.invalid/webhook', {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/json',
          'Paddle-Signature': `ts=${timestamp};h1=${signature}`,
        },
      }));
      return { status: response.status, body: await response.json() };
    },
  };
}

function subscriptionPayload(overrides = {}) {
  const base = {
    event_id: eventId,
    event_type: 'subscription.created',
    occurred_at: '2026-09-14T20:00:00Z',
    data: {
      id: subscriptionId,
      customer_id: customerId,
      status: 'active',
      next_billed_at: '2026-10-14T20:00:00Z',
      canceled_at: null,
      scheduled_change: null,
      current_billing_period: {
        starts_at: '2026-09-14T20:00:00Z',
        ends_at: '2026-10-14T20:00:00Z',
      },
      updated_at: '2026-09-14T20:00:00Z',
      custom_data: { careflow_checkout_reference: checkoutReference },
      items: [{
        price: { id: priceId, name: 'Founding Clinic', description: 'Monthly clinic subscription' },
        product: { name: 'CareFlow AI Clinic Subscription' },
      }],
    },
  };
  return {
    ...base,
    ...overrides,
    data: { ...base.data, ...(overrides.data || {}) },
  };
}

test('checkout requires a valid session and hospital-admin role', async () => {
  assert.equal((await checkoutFixture({ authDenied: true }).invoke()).status, 401);
  assert.equal((await checkoutFixture({ noMembership: true }).invoke()).status, 403);
  assert.equal((await checkoutFixture({ role: 'staff' }).invoke()).status, 403);
});

test('checkout returns a one-time server-owned reference for the fixed Paddle price', async () => {
  const fixture = checkoutFixture();
  const response = await fixture.invoke();
  assert.equal(response.status, 200);
  assert.equal(response.body.checkout_reference, checkoutReference);
  assert.equal(response.body.price_id, priceId);
  assert.equal(response.body.customer_email, 'admin@example.test');
  const call = fixture.calls.rpcs[0];
  assert.equal(call.name, 'careflow_service_prepare_billing_checkout');
  assert.equal(call.args.p_organization_id, organizationId);
  assert.equal(call.args.p_user_id, userId);
  assert.equal(call.args.p_price_id, priceId);
});

test('checkout is rate-limited and refuses duplicate subscriptions', async () => {
  const missing = checkoutFixture({ missingConfig: true });
  assert.equal((await missing.invoke()).status, 503);
  assert.equal(missing.calls.rpcs.length, 0);

  assert.equal((await checkoutFixture({ rateLimited: true }).invoke()).status, 429);
  const duplicate = checkoutFixture({ subscription: { status: 'active', ends_at: null } });
  assert.equal((await duplicate.invoke()).status, 409);
  assert.equal(duplicate.calls.rpcs.length, 0);
});

test('webhook rejects forged and stale signatures before any database call', async () => {
  const forged = webhookFixture();
  assert.equal((await forged.invoke(subscriptionPayload(), { signature: '0'.repeat(64) })).status, 401);
  assert.equal(forged.calls.rpcs.length, 0);

  const stale = webhookFixture();
  assert.equal((await stale.invoke(subscriptionPayload(), { timestamp: '1' })).status, 401);
  assert.equal(stale.calls.rpcs.length, 0);
});

test('signed Paddle simulations are acknowledged without changing production billing', async () => {
  const fixture = webhookFixture();
  const response = await fixture.invoke(subscriptionPayload({
    event_id: 'ntfsimevt_01j82zmtn7h400gg6pa3q3kx73',
  }));
  assert.equal(response.status, 200);
  assert.equal(response.body.received, true);
  assert.equal(response.body.simulated, true);
  assert.equal(response.body.ignored, true);
  assert.equal(fixture.calls.rpcs.length, 0);
});

test('a valid Paddle subscription event is reduced to safe billing fields', async () => {
  const fixture = webhookFixture();
  const response = await fixture.invoke(subscriptionPayload());
  assert.equal(response.status, 200);
  assert.equal(response.body.result, 'applied');
  const call = fixture.calls.rpcs[0];
  assert.equal(call.name, 'careflow_service_apply_paddle_event');
  assert.equal(call.args.p_checkout_reference, checkoutReference);
  assert.equal(call.args.p_subscription_id, subscriptionId);
  assert.equal(call.args.p_customer_id, customerId);
  assert.equal(call.args.p_price_id, priceId);
  assert.equal(call.args.p_status, 'active');
  assert.equal(call.args.p_test_mode, false);
  assert.equal(call.args.p_product_name, 'CareFlow AI Clinic Subscription');
  assert.equal(call.args.card_number, undefined);
});

test('canceled subscriptions expire and unrelated Paddle prices are ignored', async () => {
  const canceled = webhookFixture();
  const canceledPayload = subscriptionPayload({
    event_type: 'subscription.canceled',
    data: {
      status: 'canceled',
      canceled_at: '2026-09-20T10:00:00Z',
      updated_at: '2026-09-20T10:00:00Z',
    },
  });
  assert.equal((await canceled.invoke(canceledPayload)).status, 200);
  assert.equal(canceled.calls.rpcs[0].args.p_status, 'expired');
  assert.equal(canceled.calls.rpcs[0].args.p_ends_at, '2026-09-20T10:00:00.000Z');

  const unrelated = webhookFixture();
  const unrelatedPayload = subscriptionPayload({
    data: {
      items: [{
        price: { id: 'pri_01h22222222222222222222222', name: 'Other' },
        product: { name: 'Other product' },
      }],
    },
  });
  const ignored = await unrelated.invoke(unrelatedPayload);
  assert.equal(ignored.status, 200);
  assert.equal(ignored.body.ignored, true);
  assert.equal(unrelated.calls.rpcs.length, 0);
});
