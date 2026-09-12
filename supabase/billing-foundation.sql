-- CareFlow AI billing foundation for Lemon Squeezy subscriptions.
-- No card, bank, or patient data is stored here.

create schema if not exists careflow_private;
revoke all on schema careflow_private from public, anon, authenticated;

create table if not exists public.organization_subscriptions (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  provider text not null default 'lemonsqueezy'
    check (provider = 'lemonsqueezy'),
  provider_store_id text not null check (provider_store_id ~ '^[0-9]+$'),
  provider_customer_id text not null check (provider_customer_id ~ '^[0-9]+$'),
  provider_subscription_id text not null unique check (provider_subscription_id ~ '^[0-9]+$'),
  provider_variant_id text not null check (provider_variant_id ~ '^[0-9]+$'),
  product_name text check (product_name is null or char_length(product_name) <= 200),
  variant_name text check (variant_name is null or char_length(variant_name) <= 200),
  status text not null check (status in (
    'on_trial', 'active', 'paused', 'past_due', 'unpaid', 'cancelled', 'expired'
  )),
  renews_at timestamptz,
  ends_at timestamptz,
  provider_updated_at timestamptz not null,
  test_mode boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

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

revoke all on table public.organization_subscriptions from public, anon, authenticated;
grant select on table public.organization_subscriptions to authenticated;
revoke all on table public.organization_subscriptions from service_role;
grant select, insert, update on table public.organization_subscriptions to service_role;

create table if not exists careflow_private.billing_webhook_events (
  event_id text primary key check (char_length(event_id) between 65 and 200),
  event_name text not null check (char_length(event_name) between 1 and 100),
  organization_id uuid,
  provider_subscription_id text,
  result text not null check (result in ('received', 'applied', 'ignored')),
  received_at timestamptz not null default clock_timestamp(),
  processed_at timestamptz
);

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

create or replace function public.careflow_service_reserve_billing_checkout(
  p_organization_id uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.organization_members om
    where om.organization_id = p_organization_id
      and om.user_id = p_user_id
      and om.role = 'admin'
  ) then
    return false;
  end if;

  perform 1
  from public.organizations o
  where o.id = p_organization_id
  for update;

  delete from careflow_private.billing_checkout_attempts
  where requested_at < clock_timestamp() - interval '1 day';

  if (
    select count(*)
    from careflow_private.billing_checkout_attempts a
    where a.organization_id = p_organization_id
      and a.user_id = p_user_id
      and a.requested_at >= clock_timestamp() - interval '15 minutes'
  ) >= 5 then
    return false;
  end if;

  insert into careflow_private.billing_checkout_attempts (organization_id, user_id)
  values (p_organization_id, p_user_id);
  return true;
end;
$$;

revoke all on function public.careflow_service_reserve_billing_checkout(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.careflow_service_reserve_billing_checkout(uuid, uuid)
  to service_role;

create or replace function public.careflow_service_apply_billing_event(
  p_event_id text,
  p_event_name text,
  p_organization_id uuid,
  p_store_id text,
  p_customer_id text,
  p_subscription_id text,
  p_variant_id text,
  p_product_name text,
  p_variant_name text,
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
as $$
declare
  v_inserted_event_id text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  if p_event_id is null or char_length(p_event_id) not between 65 and 200
     or p_event_name is null or char_length(p_event_name) not between 1 and 100
     or p_organization_id is null
     or coalesce(p_store_id, '') !~ '^[0-9]+$'
     or coalesce(p_customer_id, '') !~ '^[0-9]+$'
     or coalesce(p_subscription_id, '') !~ '^[0-9]+$'
     or coalesce(p_variant_id, '') !~ '^[0-9]+$'
     or coalesce(p_status, '') not in ('on_trial', 'active', 'paused', 'past_due', 'unpaid', 'cancelled', 'expired')
     or p_provider_updated_at is null then
    raise exception 'Invalid billing event.' using errcode = '22023';
  end if;

  insert into careflow_private.billing_webhook_events (
    event_id, event_name, organization_id, provider_subscription_id, result
  ) values (
    p_event_id, p_event_name, p_organization_id, p_subscription_id, 'received'
  )
  on conflict (event_id) do nothing
  returning event_id into v_inserted_event_id;

  if v_inserted_event_id is null then
    return 'duplicate';
  end if;

  if not exists (
    select 1 from public.organizations o where o.id = p_organization_id
  ) then
    update careflow_private.billing_webhook_events
    set result = 'ignored', processed_at = clock_timestamp()
    where event_id = p_event_id;
    return 'ignored';
  end if;

  insert into public.organization_subscriptions (
    organization_id,
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
    p_organization_id,
    p_store_id,
    p_customer_id,
    p_subscription_id,
    p_variant_id,
    nullif(left(btrim(p_product_name), 200), ''),
    nullif(left(btrim(p_variant_name), 200), ''),
    p_status,
    p_renews_at,
    p_ends_at,
    p_provider_updated_at,
    p_test_mode
  )
  on conflict (organization_id) do update set
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
  where excluded.provider_updated_at >= public.organization_subscriptions.provider_updated_at;

  update careflow_private.billing_webhook_events
  set result = 'applied', processed_at = clock_timestamp()
  where event_id = p_event_id;

  return 'applied';
end;
$$;

revoke all on function public.careflow_service_apply_billing_event(
  text, text, uuid, text, text, text, text, text, text, text,
  timestamptz, timestamptz, timestamptz, boolean
) from public, anon, authenticated;
grant execute on function public.careflow_service_apply_billing_event(
  text, text, uuid, text, text, text, text, text, text, text,
  timestamptz, timestamptz, timestamptz, boolean
) to service_role;
