-- CareFlow AI staff-management hardening
-- Keeps service RPCs service-role-only, prevents cross-hospital email probing,
-- and serializes membership changes so every hospital retains an administrator.

create or replace function public.careflow_service_find_auth_user(p_email text)
returns table (user_id uuid, email text)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.email::text
  from auth.users u
  where pg_catalog.lower(u.email) = pg_catalog.lower(pg_catalog.btrim(p_email))
  limit 1;
$$;

create or replace function public.careflow_service_find_member(
  p_actor_user_id uuid,
  p_email text
)
returns table (user_id uuid, email text, role text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
begin
  select om.organization_id
    into v_org_id
  from public.organization_members om
  where om.user_id = p_actor_user_id
    and om.role = 'admin'
  order by om.created_at nulls last, om.id
  limit 1;

  if v_org_id is null then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  return query
  select u.id, u.email::text, om.role
  from public.organization_members om
  join auth.users u on u.id = om.user_id
  where om.organization_id = v_org_id
    and pg_catalog.lower(u.email) = pg_catalog.lower(pg_catalog.btrim(p_email))
  limit 1;
end;
$$;

create or replace function public.careflow_service_add_member(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_target_email text,
  p_role text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_target_email text;
begin
  if p_role not in ('admin', 'staff') then
    raise exception 'Invalid role' using errcode = '22023';
  end if;

  select om.organization_id
    into v_org_id
  from public.organization_members om
  where om.user_id = p_actor_user_id
    and om.role = 'admin'
  order by om.created_at nulls last, om.id
  limit 1;

  if v_org_id is null then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  -- One short organization-row lock serializes every membership mutation.
  perform 1
  from public.organizations o
  where o.id = v_org_id
  for update;

  if not exists (
    select 1
    from public.organization_members om
    where om.organization_id = v_org_id
      and om.user_id = p_actor_user_id
      and om.role = 'admin'
  ) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  if p_target_user_id = p_actor_user_id then
    raise exception 'You are already a member' using errcode = '22023';
  end if;

  select u.email::text
    into v_target_email
  from auth.users u
  where u.id = p_target_user_id;

  if v_target_email is null
     or pg_catalog.lower(v_target_email) <> pg_catalog.lower(pg_catalog.btrim(p_target_email)) then
    raise exception 'User account mismatch' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.organization_members om
    where om.user_id = p_target_user_id
  ) then
    raise exception 'This email cannot be added to this hospital' using errcode = '23505';
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_org_id, p_target_user_id, p_role);

  insert into public.organization_member_audit (
    organization_id,
    actor_user_id,
    target_user_id,
    target_email,
    action,
    old_role,
    new_role
  )
  values (
    v_org_id,
    p_actor_user_id,
    p_target_user_id,
    pg_catalog.lower(v_target_email),
    'invite',
    null,
    p_role
  );

  return v_org_id;
end;
$$;

create or replace function public.careflow_service_change_member_role(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_target_email text,
  p_new_role text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_old_role text;
  v_target_email text;
  v_admin_count bigint;
begin
  if p_new_role not in ('admin', 'staff') then
    raise exception 'Invalid role' using errcode = '22023';
  end if;

  select om.organization_id
    into v_org_id
  from public.organization_members om
  where om.user_id = p_actor_user_id
    and om.role = 'admin'
  order by om.created_at nulls last, om.id
  limit 1;

  if v_org_id is null then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  perform 1
  from public.organizations o
  where o.id = v_org_id
  for update;

  if not exists (
    select 1
    from public.organization_members om
    where om.organization_id = v_org_id
      and om.user_id = p_actor_user_id
      and om.role = 'admin'
  ) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  if p_target_user_id = p_actor_user_id then
    raise exception 'You cannot change your own role' using errcode = '22023';
  end if;

  select om.role, u.email::text
    into v_old_role, v_target_email
  from public.organization_members om
  join auth.users u on u.id = om.user_id
  where om.organization_id = v_org_id
    and om.user_id = p_target_user_id
  for update of om;

  if v_old_role is null then
    raise exception 'User is not a member of this hospital' using errcode = '22023';
  end if;

  if pg_catalog.lower(v_target_email) <> pg_catalog.lower(pg_catalog.btrim(p_target_email)) then
    raise exception 'User account mismatch' using errcode = '22023';
  end if;

  if v_old_role = p_new_role then
    return;
  end if;

  if v_old_role = 'admin' and p_new_role <> 'admin' then
    select pg_catalog.count(*)
      into v_admin_count
    from public.organization_members om
    where om.organization_id = v_org_id
      and om.role = 'admin';

    if v_admin_count <= 1 then
      raise exception 'The hospital must keep at least one admin' using errcode = '23514';
    end if;
  end if;

  update public.organization_members
  set role = p_new_role
  where organization_id = v_org_id
    and user_id = p_target_user_id;

  insert into public.organization_member_audit (
    organization_id,
    actor_user_id,
    target_user_id,
    target_email,
    action,
    old_role,
    new_role
  )
  values (
    v_org_id,
    p_actor_user_id,
    p_target_user_id,
    pg_catalog.lower(v_target_email),
    'role_change',
    v_old_role,
    p_new_role
  );
end;
$$;

create or replace function public.careflow_service_remove_member(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_target_email text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_old_role text;
  v_target_email text;
  v_admin_count bigint;
begin
  select om.organization_id
    into v_org_id
  from public.organization_members om
  where om.user_id = p_actor_user_id
    and om.role = 'admin'
  order by om.created_at nulls last, om.id
  limit 1;

  if v_org_id is null then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  perform 1
  from public.organizations o
  where o.id = v_org_id
  for update;

  if not exists (
    select 1
    from public.organization_members om
    where om.organization_id = v_org_id
      and om.user_id = p_actor_user_id
      and om.role = 'admin'
  ) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  if p_target_user_id = p_actor_user_id then
    raise exception 'You cannot remove your own account' using errcode = '22023';
  end if;

  select om.role, u.email::text
    into v_old_role, v_target_email
  from public.organization_members om
  join auth.users u on u.id = om.user_id
  where om.organization_id = v_org_id
    and om.user_id = p_target_user_id
  for update of om;

  if v_old_role is null then
    raise exception 'User is not a member of this hospital' using errcode = '22023';
  end if;

  if pg_catalog.lower(v_target_email) <> pg_catalog.lower(pg_catalog.btrim(p_target_email)) then
    raise exception 'User account mismatch' using errcode = '22023';
  end if;

  if v_old_role = 'admin' then
    select pg_catalog.count(*)
      into v_admin_count
    from public.organization_members om
    where om.organization_id = v_org_id
      and om.role = 'admin';

    if v_admin_count <= 1 then
      raise exception 'The hospital must keep at least one admin' using errcode = '23514';
    end if;
  end if;

  delete from public.organization_members
  where organization_id = v_org_id
    and user_id = p_target_user_id;

  insert into public.organization_member_audit (
    organization_id,
    actor_user_id,
    target_user_id,
    target_email,
    action,
    old_role,
    new_role
  )
  values (
    v_org_id,
    p_actor_user_id,
    p_target_user_id,
    pg_catalog.lower(v_target_email),
    'remove',
    v_old_role,
    null
  );
end;
$$;

revoke all on function public.careflow_service_find_auth_user(text)
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.careflow_service_find_member(uuid, text)
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.careflow_service_add_member(uuid, uuid, text, text)
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.careflow_service_change_member_role(uuid, uuid, text, text)
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.careflow_service_remove_member(uuid, uuid, text)
  from public, anon, authenticated, service_role, authenticator;

grant execute on function public.careflow_service_find_auth_user(text) to service_role;
grant execute on function public.careflow_service_find_member(uuid, text) to service_role;
grant execute on function public.careflow_service_add_member(uuid, uuid, text, text) to service_role;
grant execute on function public.careflow_service_change_member_role(uuid, uuid, text, text) to service_role;
grant execute on function public.careflow_service_remove_member(uuid, uuid, text) to service_role;

comment on function public.careflow_service_find_auth_user(text) is
  'Service-only lookup used during invitations; never callable by browser roles.';
comment on function public.careflow_service_find_member(uuid, text) is
  'Service-only same-hospital lookup that prevents cross-tenant account enumeration.';
comment on function public.careflow_service_add_member(uuid, uuid, text, text) is
  'Service-only atomic hospital membership creation with actor revalidation and audit.';
comment on function public.careflow_service_change_member_role(uuid, uuid, text, text) is
  'Service-only serialized role change that preserves at least one hospital admin.';
comment on function public.careflow_service_remove_member(uuid, uuid, text) is
  'Service-only serialized membership removal that preserves at least one hospital admin.';
