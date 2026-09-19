-- CareFlow AI billing foundation for Paddle subscriptions.
-- No card, bank, checkout payload, or patient data is stored here.

create schema if not exists careflow_private;
revoke all on schema careflow_private from public, anon, authenticated, service_role;

create table if not exists public.organization_subscriptions (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  provider text not null default 'paddle',
  provider_store_id text,
  provider_customer_id text not null,
  provider_subscription_id text not null unique,
  provider_variant_id text not null,
  product_name text,
  variant_name text,
  status text not null,
  renews_at timestamptz,
  ends_at timestamptz,
  provider_updated_at timestamptz not null,
  test_mode boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

do $migration$
begin
  if exists (
    select 1 from public.organization_subscriptions where provider <> 'paddle'
  ) then
    raise exception 'Existing non-Paddle subscriptions require a manual migration.';
  end if;
end
$migration$;

alter table public.organization_subscriptions
  alter column provider set default 'paddle',
  alter column provider_store_id drop not null,
  alter column test_mode set default false;

alter table public.organization_subscriptions drop constraint if exists organization_subscriptions_provider_check;
alter table public.organization_subscriptions drop constraint if exists organization_subscriptions_provider_store_id_check;
alter table public.organization_subscriptions drop constraint if exists organization_subscriptions_provider_customer_id_check;
alter table public.organization_subscriptions drop constraint if exists organization_subscriptions_provider_subscription_id_check;
alter table public.organization_subscriptions drop constraint if exists organization_subscriptions_provider_variant_id_check;
alter table public.organization_subscriptions drop constraint if exists organization_subscriptions_product_name_check;
alter table public.organization_subscriptions drop constraint if exists organization_subscriptions_variant_name_check;
alter table public.organization_subscriptions drop constraint if exists organization_subscriptions_status_check;

alter table public.organization_subscriptions
  add constraint organization_subscriptions_provider_check
    check (provider = 'paddle'),
  add constraint organization_subscriptions_provider_store_id_check
    check (provider_store_id is null or char_length(provider_store_id) <= 200),
  add constraint organization_subscriptions_provider_customer_id_check
    check (provider_customer_id ~ '^ctm_[a-z0-9]{26}$'),
  add constraint organization_subscriptions_provider_subscription_id_check
    check (provider_subscription_id ~ '^sub_[a-z0-9]{26}$'),
  add constraint organization_subscriptions_provider_variant_id_check
    check (provider_variant_id ~ '^pri_[a-z0-9]{26}$'),
  add constraint organization_subscriptions_product_name_check
    check (product_name is null or char_length(product_name) <= 200),
  add constraint organization_subscriptions_variant_name_check
    check (variant_name is null or char_length(variant_name) <= 200),
  add constraint organization_subscriptions_status_check
    check (status in ('on_trial', 'active', 'paused', 'past_due', 'unpaid', 'cancelled', 'expired'));

alter table public.organization_subscriptions enable row level security;

drop policy if exists "Hospital members can view their subscription" on public.organization_subscriptions;
create policy "Hospital members can view their subscription"
on public.organization_subscriptions
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members om
    where om.user_id = (select auth.uid())
      and om.organization_id = organization_subscriptions.organization_id
  )
);

revoke all on table public.organization_subscriptions from public, anon, authenticated, service_role;
grant select on table public.organization_subscriptions to authenticated;
grant select, insert, update on table public.organization_subscriptions to service_role;

create table if not exists careflow_private.billing_webhook_events (
  event_id text primary key,
  event_name text not null,
  organization_id uuid,
  provider_subscription_id text,
  result text not null,
  received_at timestamptz not null default clock_timestamp(),
  processed_at timestamptz
);

alter table careflow_private.billing_webhook_events
  drop constraint if exists billing_webhook_events_event_id_check;
alter table careflow_private.billing_webhook_events
  drop constraint if exists billing_webhook_events_event_name_check;
alter table careflow_private.billing_webhook_events
  drop constraint if exists billing_webhook_events_result_check;
alter table careflow_private.billing_webhook_events
  add constraint billing_webhook_events_event_id_check
    check (event_id ~ '^evt_[a-z0-9]{26}$'),
  add constraint billing_webhook_events_event_name_check
    check (event_name in (
      'subscription.created', 'subscription.activated', 'subscription.updated',
      'subscription.trialing', 'subscription.past_due', 'subscription.paused',
      'subscription.resumed', 'subscription.canceled'
    )),
  add constraint billing_webhook_events_result_check
    check (result in ('received', 'applied', 'ignored'));

alter table careflow_private.billing_webhook_events enable row level security;
revoke all on table careflow_private.billing_webhook_events from public, anon, authenticated, service_role;

create table if not exists careflow_private.billing_checkout_attempts (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  requested_at timestamptz not null default clock_timestamp()
);

alter table careflow_private.billing_checkout_attempts enable row level security;
revoke all on table careflow_private.billing_checkout_attempts from public, anon, authenticated, service_role;
revoke all on sequence careflow_private.billing_checkout_attempts_id_seq from public, anon, authenticated, service_role;

create index if not exists billing_checkout_attempts_rate_idx
  on careflow_private.billing_checkout_attempts(organization_id, user_id, requested_at desc);
create index if not exists billing_checkout_attempts_user_idx
  on careflow_private.billing_checkout_attempts(user_id);

create table if not exists careflow_private.billing_checkout_sessions (
  reference uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  expected_price_id text not null
    check (expected_price_id ~ '^pri_[a-z0-9]{26}$'),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '2 hours'),
  consumed_at timestamptz,
  provider_subscription_id text unique
    check (provider_subscription_id is null or provider_subscription_id ~ '^sub_[a-z0-9]{26}$'),
  check (expires_at > created_at)
);

alter table careflow_private.billing_checkout_sessions enable row level security;
revoke all on table careflow_private.billing_checkout_sessions from public, anon, authenticated, service_role;

create index if not exists billing_checkout_sessions_organization_idx
  on careflow_private.billing_checkout_sessions(organization_id, created_at desc);
create index if not exists billing_checkout_sessions_user_idx
  on careflow_private.billing_checkout_sessions(user_id);
create index if not exists billing_checkout_sessions_expires_idx
  on careflow_private.billing_checkout_sessions(expires_at);

create or replace function public.careflow_service_prepare_billing_checkout(
  p_organization_id uuid,
  p_user_id uuid,
  p_price_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_reference uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  if coalesce(p_price_id, '') not in (
    'pri_01m2gcpjxz4wqjft7z10zcz3zq',
    'pri_01m2xtx7y26neywx40s3v3s5k3'
  ) then
    raise exception 'Invalid billing price.' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.organization_members om
    where om.organization_id = p_organization_id
      and om.user_id = p_user_id
      and om.role = 'admin'
  ) then
    return null;
  end if;

  perform 1
  from public.organizations o
  where o.id = p_organization_id
  for update;

  if exists (
    select 1
    from public.organization_subscriptions os
    where os.organization_id = p_organization_id
      and os.status <> 'expired'
  ) then
    return null;
  end if;

  delete from careflow_private.billing_checkout_attempts
  where requested_at < clock_timestamp() - interval '1 day';

  delete from careflow_private.billing_checkout_sessions
  where expires_at < clock_timestamp() - interval '7 days';

  if (
    select count(*)
    from careflow_private.billing_checkout_attempts a
    where a.organization_id = p_organization_id
      and a.user_id = p_user_id
      and a.requested_at >= clock_timestamp() - interval '15 minutes'
  ) >= 5 then
    return null;
  end if;

  insert into careflow_private.billing_checkout_attempts (organization_id, user_id)
  values (p_organization_id, p_user_id);

  insert into careflow_private.billing_checkout_sessions (
    organization_id, user_id, expected_price_id
  ) values (
    p_organization_id, p_user_id, p_price_id
  )
  returning reference into v_reference;

  return v_reference;
end;
$function$;

revoke all on function public.careflow_service_prepare_billing_checkout(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.careflow_service_prepare_billing_checkout(uuid, uuid, text)
  to service_role;

create or replace function public.careflow_service_apply_paddle_event(
  p_event_id text,
  p_event_name text,
  p_checkout_reference uuid,
  p_customer_id text,
  p_subscription_id text,
  p_price_id text,
  p_product_name text,
  p_price_name text,
  p_status text,
  p_renews_at timestamptz,
  p_ends_at timestamptz,
  p_provider_updated_at timestamptz,
  p_test_mode boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_inserted_event_id text;
  v_organization_id uuid;
  v_applied_organization_id uuid;
  v_existing_subscription_id text;
  v_existing_status text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  if coalesce(p_event_id, '') !~ '^evt_[a-z0-9]{26}$'
     or coalesce(p_event_name, '') not in (
       'subscription.created', 'subscription.activated', 'subscription.updated',
       'subscription.trialing', 'subscription.past_due', 'subscription.paused',
       'subscription.resumed', 'subscription.canceled'
     )
     or coalesce(p_customer_id, '') !~ '^ctm_[a-z0-9]{26}$'
     or coalesce(p_subscription_id, '') !~ '^sub_[a-z0-9]{26}$'
     or not (
       (p_price_id = 'pri_01m2gcpjxz4wqjft7z10zcz3zq' and p_test_mode is false)
       or
       (p_price_id = 'pri_01m2xtx7y26neywx40s3v3s5k3' and p_test_mode is true)
     )
     or coalesce(p_status, '') not in ('on_trial', 'active', 'paused', 'past_due', 'expired')
     or p_provider_updated_at is null then
    raise exception 'Invalid Paddle billing event.' using errcode = '22023';
  end if;

  insert into careflow_private.billing_webhook_events (
    event_id, event_name, organization_id, provider_subscription_id, result
  ) values (
    p_event_id, p_event_name, null, p_subscription_id, 'received'
  )
  on conflict (event_id) do nothing
  returning event_id into v_inserted_event_id;

  if v_inserted_event_id is null then
    return 'duplicate';
  end if;

  select os.organization_id
  into v_organization_id
  from public.organization_subscriptions os
  where os.provider = 'paddle'
    and os.provider_subscription_id = p_subscription_id
  for update;

  if v_organization_id is null and p_checkout_reference is not null then
    select cs.organization_id
    into v_organization_id
    from careflow_private.billing_checkout_sessions cs
    where cs.reference = p_checkout_reference
      and cs.expected_price_id = p_price_id
      and (
        cs.expires_at >= clock_timestamp()
        or cs.provider_subscription_id = p_subscription_id
      )
      and (
        cs.provider_subscription_id is null
        or cs.provider_subscription_id = p_subscription_id
      )
    for update;
  end if;

  if v_organization_id is null then
    update careflow_private.billing_webhook_events
    set result = 'ignored', processed_at = clock_timestamp()
    where event_id = p_event_id;
    return 'ignored';
  end if;

  perform 1
  from public.organizations o
  where o.id = v_organization_id
  for update;
  if not found then
    update careflow_private.billing_webhook_events
    set result = 'ignored', processed_at = clock_timestamp()
    where event_id = p_event_id;
    return 'ignored';
  end if;

  select os.provider_subscription_id, os.status
  into v_existing_subscription_id, v_existing_status
  from public.organization_subscriptions os
  where os.organization_id = v_organization_id;

  if v_existing_subscription_id is not null
     and v_existing_subscription_id <> p_subscription_id
     and v_existing_status <> 'expired' then
    update careflow_private.billing_webhook_events
    set organization_id = v_organization_id,
        result = 'ignored',
        processed_at = clock_timestamp()
    where event_id = p_event_id;
    return 'ignored';
  end if;

  insert into public.organization_subscriptions (
    organization_id,
    provider,
    provider_store_id,
    provider_customer_id,
    provider_subscription_id,
    provider_variant_id,
    product_name,
    variant_name,
    status,
    renews_at,
    ends_at,
    provider_updated_at,
    test_mode
  ) values (
    v_organization_id,
    'paddle',
    null,
    p_customer_id,
    p_subscription_id,
    p_price_id,
    nullif(left(btrim(p_product_name), 200), ''),
    nullif(left(btrim(p_price_name), 200), ''),
    p_status,
    p_renews_at,
    p_ends_at,
    p_provider_updated_at,
    p_test_mode
  )
  on conflict (organization_id) do update set
    provider = excluded.provider,
    provider_store_id = excluded.provider_store_id,
    provider_customer_id = excluded.provider_customer_id,
    provider_subscription_id = excluded.provider_subscription_id,
    provider_variant_id = excluded.provider_variant_id,
    product_name = excluded.product_name,
    variant_name = excluded.variant_name,
    status = excluded.status,
    renews_at = excluded.renews_at,
    ends_at = excluded.ends_at,
    provider_updated_at = excluded.provider_updated_at,
    test_mode = excluded.test_mode,
    updated_at = clock_timestamp()
  where (
    public.organization_subscriptions.provider_subscription_id = excluded.provider_subscription_id
    and excluded.provider_updated_at >= public.organization_subscriptions.provider_updated_at
  ) or (
    public.organization_subscriptions.provider_subscription_id <> excluded.provider_subscription_id
    and public.organization_subscriptions.status = 'expired'
  )
  returning organization_id into v_applied_organization_id;

  if v_applied_organization_id is null then
    update careflow_private.billing_webhook_events
    set organization_id = v_organization_id,
        result = 'ignored',
        processed_at = clock_timestamp()
    where event_id = p_event_id;
    return 'ignored';
  end if;

  if p_checkout_reference is not null then
    update careflow_private.billing_checkout_sessions
    set consumed_at = coalesce(consumed_at, clock_timestamp()),
        provider_subscription_id = p_subscription_id
    where reference = p_checkout_reference
      and organization_id = v_organization_id
      and (
        provider_subscription_id is null
        or provider_subscription_id = p_subscription_id
      );
  end if;

  update careflow_private.billing_webhook_events
  set organization_id = v_organization_id,
      provider_subscription_id = p_subscription_id,
      result = 'applied',
      processed_at = clock_timestamp()
  where event_id = p_event_id;

  return 'applied';
end;
$function$;

revoke all on function public.careflow_service_apply_paddle_event(
  text, text, uuid, text, text, text, text, text, text,
  timestamptz, timestamptz, timestamptz, boolean
) from public, anon, authenticated;
grant execute on function public.careflow_service_apply_paddle_event(
  text, text, uuid, text, text, text, text, text, text,
  timestamptz, timestamptz, timestamptz, boolean
) to service_role;

drop function if exists public.careflow_service_reserve_billing_checkout(uuid, uuid);
drop function if exists public.careflow_service_apply_billing_event(
  text, text, uuid, text, text, text, text, text, text, text,
  timestamptz, timestamptz, timestamptz, boolean
);
