// Real PostgreSQL engine in memory; synthetic billing identities only. No network.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const migration = fs.readFileSync(new URL('../supabase/billing-foundation.sql', import.meta.url), 'utf8');
const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const priceId = 'pri_01m2gcpjxz4wqjft7z10zcz3zq';
const sandboxOrganizationId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const sandboxUserId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const sandboxPriceId = 'pri_01m2xtx7y26neywx40s3v3s5k3';
const eventId = 'evt_01m2gcpjxz4wqjft7z10zcz3zq';
const customerId = 'ctm_01h11111111111111111111111';
const subscriptionId = 'sub_01h00000000000000000000000';

before(async () => {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.role() returns text language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
    create table auth.users (id uuid primary key);
    create table public.organizations (id uuid primary key, name text);
    create table public.organization_members (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references public.organizations(id),
      user_id uuid not null references auth.users(id),
      role text not null
    );
    insert into auth.users values ('${userId}');
    insert into public.organizations values ('${organizationId}', 'Synthetic Clinic');
    insert into public.organization_members (organization_id, user_id, role)
      values ('${organizationId}', '${userId}', 'admin');
    insert into auth.users values ('${sandboxUserId}');
    insert into public.organizations values ('${sandboxOrganizationId}', 'Synthetic Sandbox Clinic');
    insert into public.organization_members (organization_id, user_id, role)
      values ('${sandboxOrganizationId}', '${sandboxUserId}', 'admin');
  `);
  await db.exec(migration);
});

after(() => db.close());

async function serviceQuery(sql) {
  await db.exec(`set role service_role; set request.jwt.claim.role = 'service_role';`);
  try {
    return (await db.query(sql)).rows;
  } finally {
    await db.exec('reset role;');
  }
}

test('the Paddle migration applies and creates a one-time clinic-bound checkout reference', async () => {
  const [prepared] = await serviceQuery(
    `select public.careflow_service_prepare_billing_checkout(
      '${organizationId}', '${userId}', '${priceId}'
    ) as reference`
  );
  assert.match(prepared.reference, /^[0-9a-f-]{36}$/i);

  const [session] = (await db.query(
    'select organization_id, user_id, expected_price_id, consumed_at from careflow_private.billing_checkout_sessions where reference=$1',
    [prepared.reference]
  )).rows;
  assert.deepEqual(session, {
    organization_id: organizationId,
    user_id: userId,
    expected_price_id: priceId,
    consumed_at: null,
  });
});

test('a signed-webhook reduction can activate only the clinic bound to its reference', async () => {
  const [session] = (await db.query(
    'select reference from careflow_private.billing_checkout_sessions where organization_id=$1 order by created_at desc limit 1',
    [organizationId]
  )).rows;
  const [applied] = await serviceQuery(
    `select public.careflow_service_apply_paddle_event(
      '${eventId}', 'subscription.created', '${session.reference}',
      '${customerId}', '${subscriptionId}', '${priceId}',
      'CareFlow AI Clinic Subscription', 'Founding Clinic', 'active',
      '2026-10-14T20:00:00Z', null, '2026-09-14T20:00:00Z', false
    ) as result`
  );
  assert.equal(applied.result, 'applied');

  const [subscription] = (await db.query(
    'select organization_id, provider, provider_customer_id, provider_subscription_id, provider_variant_id, status, test_mode from public.organization_subscriptions'
  )).rows;
  assert.deepEqual(subscription, {
    organization_id: organizationId,
    provider: 'paddle',
    provider_customer_id: customerId,
    provider_subscription_id: subscriptionId,
    provider_variant_id: priceId,
    status: 'active',
    test_mode: false,
  });

  const [duplicate] = await serviceQuery(
    `select public.careflow_service_apply_paddle_event(
      '${eventId}', 'subscription.updated', null,
      '${customerId}', '${subscriptionId}', '${priceId}',
      'CareFlow AI Clinic Subscription', 'Founding Clinic', 'active',
      '2026-10-14T20:00:00Z', null, '2026-09-14T20:00:00Z', false
    ) as result`
  );
  assert.equal(duplicate.result, 'duplicate');
});

test('Sandbox checkout and webhook are price-bound and recorded as test mode', async () => {
  const [prepared] = await serviceQuery(
    `select public.careflow_service_prepare_billing_checkout(
      '${sandboxOrganizationId}', '${sandboxUserId}', '${sandboxPriceId}'
    ) as reference`
  );
  assert.match(prepared.reference, /^[0-9a-f-]{36}$/i);

  const [applied] = await serviceQuery(
    `select public.careflow_service_apply_paddle_event(
      'evt_01m2xtx7y26neywx40s3v3s5k3', 'subscription.created', '${prepared.reference}',
      'ctm_01m2xtx7y26neywx40s3v3s5k3', 'sub_01m2xtx7y26neywx40s3v3s5k3', '${sandboxPriceId}',
      'CareFlow AI Clinic Subscription', 'CareFlow AI Clinic — Monthly', 'active',
      '2026-10-19T20:00:00Z', null, '2026-09-19T20:00:00Z', true
    ) as result`
  );
  assert.equal(applied.result, 'applied');

  const [subscription] = (await db.query(
    'select provider_variant_id, status, test_mode from public.organization_subscriptions where organization_id=$1',
    [sandboxOrganizationId]
  )).rows;
  assert.deepEqual(subscription, {
    provider_variant_id: sandboxPriceId,
    status: 'active',
    test_mode: true,
  });

  await assert.rejects(
    serviceQuery(
      `select public.careflow_service_apply_paddle_event(
        'evt_01m2xtx7y26neywx40s3v3s5k4', 'subscription.updated', null,
        'ctm_01m2xtx7y26neywx40s3v3s5k4', 'sub_01m2xtx7y26neywx40s3v3s5k4', '${sandboxPriceId}',
        'CareFlow AI Clinic Subscription', 'CareFlow AI Clinic — Monthly', 'active',
        '2026-10-20T20:00:00Z', null, '2026-09-20T20:00:00Z', false
      ) as result`
    ),
    /Invalid Paddle billing event/
  );
});
