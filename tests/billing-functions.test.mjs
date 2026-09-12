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
const checkoutUrl = 'https://careflow-test.lemonsqueezy.com/checkout/custom/synthetic';

function checkoutFixture(options = {}) {
  const calls = { provider: [], rpcs: [] };
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
      assert.equal(name, 'careflow_service_reserve_billing_checkout');
      return { data: options.rateLimited ? false : true, error: null };
    },
  };
  const executable = stripTypeScriptTypes(checkoutSource.replace(/^import .*;\s*$/gm, ''), { mode: 'strip' })
    .replace('export default', 'const createBillingCheckout =');
  const context = vm.createContext({
    Response, Request, URL, Date, AbortSignal,
    console: { error() {} },
    Deno: {
      env: {
        get(name) {
          if (options.missingConfig && name === 'LEMONSQUEEZY_API_KEY') return null;
          return {
            LEMONSQUEEZY_API_KEY: 'synthetic-secret',
            LEMONSQUEEZY_STORE_ID: '100',
            LEMONSQUEEZY_VARIANT_ID: '200',
            LEMONSQUEEZY_TEST_MODE: 'true',
          }[name] || null;
        },
      },
    },
    withSupabase(config, handler) { assert.equal(config.auth, 'user'); return handler; },
    async fetch(url, request) {
      calls.provider.push({ url, request });
      if (options.providerFailure) return Response.json({ errors: [] }, { status: 503 });
      return Response.json({ data: { attributes: { url: options.unsafeUrl || checkoutUrl } } });
    },
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
    LEMONSQUEEZY_WEBHOOK_SECRET: 'synthetic-webhook-secret',
    LEMONSQUEEZY_STORE_ID: '100',
    LEMONSQUEEZY_TEST_MODE: 'true',
    SUPABASE_URL: 'https://fixture.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-role-key',
  };
  const context = vm.createContext({
    Response, Request, URL, Date, TextEncoder, Uint8Array, crypto,
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

  async function sign(body) {
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(environment.LEMONSQUEEZY_WEBHOOK_SECRET),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
    return Array.from(signature, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  return {
    calls,
    async invoke(payload, eventName = 'subscription_created', signatureOverride) {
      const body = JSON.stringify(payload);
      const response = await handler(new Request('https://fixture.invalid/webhook', {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/json',
          'X-Event-Name': eventName,
          'X-Signature': signatureOverride ?? await sign(body),
        },
      }));
      return { status: response.status, body: await response.json() };
    },
  };
}

function subscriptionPayload(overrides = {}) {
  return {
    meta: { event_name: 'subscription_created', custom_data: { organization_id: organizationId } },
    data: {
      type: 'subscriptions',
      id: '300',
      attributes: {
        store_id: 100,
        customer_id: 400,
        variant_id: 200,
        product_name: 'CareFlow AI',
        variant_name: 'Paid pilot',
        status: 'active',
        renews_at: '2026-10-12T00:00:00Z',
        ends_at: null,
        updated_at: '2026-09-12T00:00:00Z',
        test_mode: true,
        ...overrides,
      },
    },
  };
}

test('checkout requires a valid session and hospital-admin role', async () => {
  assert.equal((await checkoutFixture({ authDenied: true }).invoke()).status, 401);
  assert.equal((await checkoutFixture({ noMembership: true }).invoke()).status, 403);
  assert.equal((await checkoutFixture({ role: 'staff' }).invoke()).status, 403);
});

test('checkout fails closed when provider setup is missing or rate-limited', async () => {
  const missing = checkoutFixture({ missingConfig: true });
  assert.equal((await missing.invoke()).status, 503);
  assert.equal(missing.calls.provider.length, 0);

  const limited = checkoutFixture({ rateLimited: true });
  assert.equal((await limited.invoke()).status, 429);
  assert.equal(limited.calls.provider.length, 0);
});

test('checkout uses the provider price and server-owned hospital identity', async () => {
  const fixture = checkoutFixture();
  const response = await fixture.invoke();
  assert.equal(response.status, 200);
  assert.equal(response.body.checkout_url, checkoutUrl);
  const provider = fixture.calls.provider[0];
  assert.equal(provider.url, 'https://api.lemonsqueezy.com/v1/checkouts');
  const body = JSON.parse(provider.request.body);
  assert.equal(body.data.attributes.checkout_data.custom.organization_id, organizationId);
  assert.equal(body.data.attributes.checkout_data.custom.careflow_user_id, userId);
  assert.equal(body.data.attributes.checkout_data.email, 'admin@example.test');
  assert.equal(body.data.attributes.test_mode, true);
  assert.equal(body.data.attributes.custom_price, undefined);
});

test('checkout refuses duplicate subscriptions and unsafe redirect URLs', async () => {
  const duplicate = checkoutFixture({ subscription: { status: 'active', ends_at: null } });
  assert.equal((await duplicate.invoke()).status, 409);
  assert.equal(duplicate.calls.provider.length, 0);

  const unsafe = checkoutFixture({ unsafeUrl: 'https://evil.example/checkout' });
  assert.equal((await unsafe.invoke()).status, 502);
});

test('webhook rejects forged signatures before any database call', async () => {
  const fixture = webhookFixture();
  const response = await fixture.invoke(subscriptionPayload(), 'subscription_created', '0'.repeat(64));
  assert.equal(response.status, 401);
  assert.equal(fixture.calls.rpcs.length, 0);
});

test('a valid signed subscription event is reduced to safe billing fields', async () => {
  const fixture = webhookFixture();
  const response = await fixture.invoke(subscriptionPayload());
  assert.equal(response.status, 200);
  assert.equal(response.body.result, 'applied');
  const call = fixture.calls.rpcs[0];
  assert.equal(call.name, 'careflow_service_apply_billing_event');
  assert.equal(call.args.p_organization_id, organizationId);
  assert.equal(call.args.p_subscription_id, '300');
  assert.equal(call.args.p_status, 'active');
  assert.match(call.args.p_event_id, /^subscription_created:[0-9a-f]{64}$/);
  assert.equal(call.args.p_test_mode, true);
  assert.equal(call.args.card_number, undefined);
});

test('webhook rejects the wrong store, wrong mode and mismatched event name', async () => {
  for (const [payload, header] of [
    [subscriptionPayload({ store_id: 999 }), 'subscription_created'],
    [subscriptionPayload({ test_mode: false }), 'subscription_created'],
    [subscriptionPayload(), 'subscription_cancelled'],
  ]) {
    const fixture = webhookFixture();
    assert.equal((await fixture.invoke(payload, header)).status, 400);
    assert.equal(fixture.calls.rpcs.length, 0);
  }
});
