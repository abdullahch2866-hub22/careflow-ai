// Runs the real staff-management handler with synthetic clients. No network or data writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

const source = fs.readFileSync(
  new URL('../supabase/functions/manage-staff/index.ts', import.meta.url),
  'utf8'
);
const sql = fs.readFileSync(
  new URL('../supabase/staff-management-hardening.sql', import.meta.url),
  'utf8'
);
const executable = stripTypeScriptTypes(source.replace(/^import .*;\s*$/gm, ''), { mode: 'strip' })
  .replace('export default', 'const manageStaff =');

const organization = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const otherOrganization = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const actorId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const targetId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const targetEmail = 'staff@example.test';

function fixture(options = {}) {
  const calls = { rpcs: [], invites: [], deletes: [] };

  const scoped = {
    auth: {
      async getUser() {
        if (options.authDenied) {
          return { data: { user: null }, error: { message: 'Invalid session' } };
        }
        return { data: { user: { id: actorId, email: 'admin@example.test' } }, error: null };
      },
    },
    from(table) {
      assert.equal(table, 'organization_members');
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        async single() {
          if (options.noMembership) return { data: null, error: { message: 'Not found' } };
          return {
            data: { organization_id: organization, role: options.actorRole || 'admin' },
            error: null,
          };
        },
      };
      return builder;
    },
  };

  const admin = {
    auth: {
      admin: {
        async inviteUserByEmail(email, invitationOptions) {
          calls.invites.push({ email, invitationOptions });
          if (options.inviteError) {
            return { data: null, error: { message: 'Synthetic invite failure' } };
          }
          return { data: { user: { id: targetId, email } }, error: null };
        },
        async deleteUser(userId) {
          calls.deletes.push(userId);
          return { data: {}, error: null };
        },
      },
    },
    from(table) {
      assert.equal(table, 'organization_members');
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        async maybeSingle() {
          return { data: options.existingMembership || null, error: null };
        },
      };
      return builder;
    },
    async rpc(name, args) {
      calls.rpcs.push({ name, args });
      if (name === 'careflow_service_find_auth_user') {
        return {
          data: options.authUserExists ? [{ user_id: targetId, email: targetEmail }] : [],
          error: null,
        };
      }
      if (name === 'careflow_service_find_member') {
        return {
          data: options.memberFound === false ? [] : [{ user_id: options.selfTarget ? actorId : targetId, email: targetEmail, role: 'staff' }],
          error: null,
        };
      }
      if (name === 'careflow_service_add_member') {
        return options.addError
          ? { data: null, error: { message: 'Synthetic add failure' } }
          : { data: organization, error: null };
      }
      if (name === 'careflow_service_change_member_role' || name === 'careflow_service_remove_member') {
        return { data: null, error: null };
      }
      throw new Error('Unexpected RPC: ' + name);
    },
  };

  const context = vm.createContext({
    Response,
    Request,
    console: { error() {} },
    withSupabase(config, handler) {
      assert.equal(config.auth, 'user');
      return handler;
    },
  });
  vm.runInContext(executable, context);

  return {
    calls,
    async invoke(body, method = 'POST', rawBody = null) {
      const handler = vm.runInContext('manageStaff.fetch', context);
      const requestBody = rawBody ?? JSON.stringify(body);
      const response = await handler(new Request('https://fixture.invalid/manage-staff', {
        method,
        body: method === 'POST' ? requestBody : undefined,
        headers: { 'Content-Type': 'application/json' },
      }), { supabase: scoped, supabaseAdmin: admin });
      return { status: response.status, body: await response.json() };
    },
  };
}

function rpcCalls(f, name) {
  return f.calls.rpcs.filter((call) => call.name === name);
}

test('staff management requires POST, a valid session, and an admin membership', async () => {
  assert.equal((await fixture().invoke({}, 'GET')).status, 405);
  assert.equal((await fixture({ authDenied: true }).invoke({ action: 'remove', email: targetEmail })).status, 401);
  assert.equal((await fixture({ noMembership: true }).invoke({ action: 'remove', email: targetEmail })).status, 403);
  assert.equal((await fixture({ actorRole: 'staff' }).invoke({ action: 'remove', email: targetEmail })).status, 403);
});

test('malformed JSON and invalid fields are rejected before privileged RPCs', async () => {
  const malformed = fixture();
  assert.equal((await malformed.invoke(null, 'POST', '{bad json')).status, 400);
  assert.equal(malformed.calls.rpcs.length, 0);

  for (const body of [
    { action: 'invite', email: 'not-an-email', role: 'staff' },
    { action: 'unknown', email: targetEmail },
    { action: 'invite', email: targetEmail, role: 'owner' },
  ]) {
    const f = fixture();
    assert.equal((await f.invoke(body)).status, 400);
    assert.equal(f.calls.rpcs.length, 0);
  }
});

test('role and removal lookups never reveal whether an external email has an account', async () => {
  for (const action of ['change_role', 'remove']) {
    const f = fixture({ authUserExists: true, memberFound: false });
    const response = await f.invoke({ action, email: targetEmail, role: action === 'change_role' ? 'admin' : undefined });
    assert.equal(response.status, 404);
    assert.equal(response.body.error, 'User is not a member of this hospital');
    assert.equal(rpcCalls(f, 'careflow_service_find_auth_user').length, 0);
    assert.equal(rpcCalls(f, 'careflow_service_find_member').length, 1);
  }
});

test('an email belonging to another hospital receives a generic denial', async () => {
  const f = fixture({
    authUserExists: true,
    existingMembership: { organization_id: otherOrganization, role: 'staff' },
  });
  const response = await f.invoke({ action: 'invite', email: targetEmail, role: 'staff' });
  assert.equal(response.status, 409);
  assert.equal(response.body.error, 'This email cannot be added to your hospital');
  assert.doesNotMatch(JSON.stringify(response.body), /another CareFlow hospital/i);
  assert.equal(rpcCalls(f, 'careflow_service_add_member').length, 0);
});

test('duplicate same-hospital invitations are idempotently denied', async () => {
  const f = fixture({
    authUserExists: true,
    existingMembership: { organization_id: organization, role: 'staff' },
  });
  const response = await f.invoke({ action: 'invite', email: targetEmail, role: 'staff' });
  assert.equal(response.status, 409);
  assert.equal(response.body.error, 'This user is already a member of your hospital');
  assert.equal(f.calls.invites.length, 0);
  assert.equal(rpcCalls(f, 'careflow_service_add_member').length, 0);
});

test('a new email is invited and added without exposing account-existence state', async () => {
  const f = fixture();
  const response = await f.invoke({ action: 'invite', email: ' NEW@example.test ', role: 'staff' });
  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.invitation_sent, undefined);
  assert.equal(f.calls.invites[0].email, 'new@example.test');
  assert.equal(rpcCalls(f, 'careflow_service_add_member').length, 1);
});

test('a failed membership insert cleans up an auth user created by the invitation', async () => {
  const f = fixture({ addError: true });
  const response = await f.invoke({ action: 'invite', email: targetEmail, role: 'staff' });
  assert.equal(response.status, 409);
  assert.deepEqual(f.calls.deletes, [targetId]);
});

test('self-management is blocked and valid role/removal actions use scoped service RPCs', async () => {
  for (const action of ['change_role', 'remove']) {
    const self = fixture({ selfTarget: true });
    assert.equal((await self.invoke({ action, email: targetEmail, role: 'staff' })).status, 400);
  }

  const role = fixture();
  assert.equal((await role.invoke({ action: 'change_role', email: targetEmail, role: 'admin' })).status, 200);
  assert.equal(rpcCalls(role, 'careflow_service_change_member_role').length, 1);

  const removal = fixture();
  assert.equal((await removal.invoke({ action: 'remove', email: targetEmail })).status, 200);
  assert.equal(rpcCalls(removal, 'careflow_service_remove_member').length, 1);
});

test('staff service SQL is least-privilege, search-path safe, and serializes mutations', () => {
  for (const functionName of [
    'careflow_service_find_auth_user',
    'careflow_service_find_member',
    'careflow_service_add_member',
    'careflow_service_change_member_role',
    'careflow_service_remove_member',
  ]) {
    assert.match(
      sql,
      new RegExp(`create or replace function public\\.${functionName}\\([\\s\\S]*?set search_path = ''`, 'i')
    );
    assert.match(
      sql,
      new RegExp(`grant execute on function public\\.${functionName}\\([^)]+\\) to service_role`, 'i')
    );
  }
  assert.equal((sql.match(/from public\.organizations o\s+where o\.id = v_org_id\s+for update/gi) || []).length, 3);
  assert.match(sql, /careflow_service_find_member[\s\S]*om\.organization_id = v_org_id[\s\S]*lower\(u\.email\)/i);
  assert.doesNotMatch(source, /This email already belongs to another CareFlow hospital/i);
  assert.match(source, /npm:@supabase\/server@1\.5\.1/);
});
