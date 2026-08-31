// Real PostgreSQL engine in memory; synthetic schema/identities only. No network.
import test, { before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';
const orgA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const orgB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const docA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const docB = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const db = new PGlite();
const migration = fs.readFileSync(new URL('../supabase/review-corrections.sql', import.meta.url), 'utf8');

before(async () => {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    create table public.organizations (id uuid primary key, name text);
    create table public.organization_members (id uuid primary key default gen_random_uuid(), organization_id uuid, user_id uuid);
    create table public.documents (id uuid primary key, organization_id uuid, file_name text);
    create table public.cases (id bigint primary key, created_at timestamptz default now(), file_name text,
      document_type text, status text, organization_id uuid references public.organizations(id),
      document_id uuid references public.documents(id), patient_name text, document_date date,
      insurance_information text, missing_information text);
    alter table public.cases enable row level security;
    alter table public.documents enable row level security;
    alter table public.organization_members enable row level security;
    grant select, insert, update, delete on public.cases, public.documents, public.organization_members to authenticated;
    create policy memberships on public.organization_members for select to authenticated using (user_id = (select auth.uid()));
    create policy cases_select on public.cases for select to authenticated using
      (exists(select 1 from public.organization_members om where om.user_id = (select auth.uid()) and om.organization_id=cases.organization_id));
    create policy cases_update on public.cases for update to authenticated using
      (exists(select 1 from public.organization_members om where om.user_id = (select auth.uid()) and om.organization_id=cases.organization_id))
      with check (exists(select 1 from public.organization_members om where om.user_id = (select auth.uid()) and om.organization_id=cases.organization_id));
    create policy cases_insert on public.cases for insert to authenticated with check
      (exists(select 1 from public.organization_members om where om.user_id = (select auth.uid()) and om.organization_id=cases.organization_id));
    create policy docs_select on public.documents for select to authenticated using
      (exists(select 1 from public.organization_members om where om.user_id = (select auth.uid()) and om.organization_id=documents.organization_id));
    insert into public.organizations values ('${orgA}', 'Synthetic A'), ('${orgB}', 'Synthetic B');
    insert into public.organization_members (organization_id,user_id) values ('${orgA}', '${userA}'), ('${orgB}', '${userB}');
    insert into public.documents values ('${docA}', '${orgA}', 'Synthetic A.pdf'), ('${docB}', '${orgB}', 'Synthetic B.pdf');
    insert into public.cases values
      (1,now(),'Synthetic A.pdf','Healthcare document','Review','${orgA}','${docA}','Synthetic A','2026-08-12','Synthetic insurance','Emergency contact'),
      (2,now(),'Synthetic A.pdf','Healthcare document','Review','${orgA}','${docA}','Synthetic A','2026-08-12','Synthetic insurance',null),
      (3,now(),'Synthetic B.pdf','Healthcare document','Review','${orgB}','${docB}','Synthetic B','2026-08-12',null,'Private missing item'),
      (4,now(),'Synthetic old.pdf','Healthcare document','Completed','${orgA}','${docA}','Synthetic old','2026-08-12',null,'Legacy missing item');
  `);
  await db.exec(migration);
});
after(() => db.close());
beforeEach(async () => { await db.exec(`begin; set local role authenticated; set local request.jwt.claim.sub = '${userA}';`); });
afterEach(() => db.exec('rollback;'));
async function rows(sql, values) { return (await db.query(sql, values)).rows; }
async function reject(sql, pattern) {
  await db.exec('savepoint rejected_statement;');
  await assert.rejects(db.exec(sql), pattern);
  await db.exec('rollback to savepoint rejected_statement;');
}
const resolve = `update public.cases set missing_information=null, review_notes='Contact: Synthetic Relative, TEST-000. Source: fictional corrected intake form.' where id=1;`;

test('the additive migration preserves older completed cases and source records', async () => {
  const [row] = await rows('select status,missing_information,review_revision,review_notes from public.cases where id=4');
  assert.deepEqual(row, { status:'Completed', missing_information:'Legacy missing item', review_revision:0, review_notes:null });
  assert.equal((await rows('select file_name from public.documents'))[0].file_name, 'Synthetic A.pdf');
});
test('database blocks approval with unresolved information even when the UI is bypassed', async () => {
  await reject("update public.cases set status='Completed',review_confirmed=true where id=1", /Resolve the missing information/);
  assert.equal((await rows('select status from public.cases where id=1'))[0].status, 'Review');
});
test('resolving missing items requires a new note and retains the prior values in history', async () => {
  await reject('update public.cases set missing_information=null where id=1', /new correction note/);
  await db.exec(resolve);
  const [row] = await rows('select status,missing_information,review_confirmed,updated_by,review_revision from public.cases where id=1');
  assert.deepEqual(row, {status:'Review',missing_information:null,review_confirmed:false,updated_by:userA,review_revision:1});
  const [history] = await rows('select before_values,after_values,actor_id from public.case_review_history where case_id=1');
  assert.equal(history.before_values.missing_information, 'Emergency contact');
  assert.match(history.after_values.review_notes, /Synthetic Relative/);
  assert.equal(history.actor_id, userA);
});
test('saving corrected details and approval in one request reopens review instead of completing', async () => {
  await db.exec("update public.cases set missing_information=null,review_notes='Synthetic correction source supplied.',status='Completed',review_confirmed=true where id=1");
  assert.deepEqual((await rows('select status,review_confirmed from public.cases where id=1'))[0], {status:'Review',review_confirmed:false});
});
test('a separate confirmed approval saves only after correction, with server-owned actor and revision', async () => {
  await db.exec(resolve);
  await reject("update public.cases set status='Completed' where id=1", /Confirm the saved details/);
  await db.exec(`update public.cases set status='Completed', review_confirmed=true, updated_by='${userB}', review_revision=900 where id=1`);
  assert.deepEqual((await rows('select status,review_revision,updated_by from public.cases where id=1'))[0], {status:'Completed',review_revision:2,updated_by:userA});
  assert.equal((await rows('select count(*)::integer as n from public.case_review_history where case_id=1'))[0].n, 2);
});
test('approval requires identity and date even if the missing-information list is blank', async () => {
  await db.exec("update public.cases set patient_name=null,review_notes='Synthetic identity pending.' where id=2");
  await reject("update public.cases set status='Completed',review_confirmed=true where id=2", /Patient name, document type, date/);
});
test('editing a completed case resets its approval and preserves the earlier approval event', async () => {
  await db.exec("update public.cases set status='Completed',review_confirmed=true where id=2");
  await db.exec("update public.cases set patient_name='Corrected Synthetic A',review_notes='Name corrected from fictional intake form.' where id=2");
  assert.deepEqual((await rows('select status,review_confirmed from public.cases where id=2'))[0], {status:'Review',review_confirmed:false});
  assert.equal((await rows("select count(*)::integer as n from public.case_review_history where before_values->>'status'='Completed'"))[0].n, 1);
});
test('partial corrections stay Correction Required and cannot be approved', async () => {
  await db.exec("update public.cases set missing_information='Authorization number',review_notes='Synthetic contact added; authorization still needed.' where id=1");
  assert.equal((await rows('select status from public.cases where id=1'))[0].status, 'Correction Required');
  await reject("update public.cases set status='Completed',review_confirmed=true where id=1", /Resolve the missing information/);
});
test('real RLS blocks another hospital from reading or editing cases and change history', async () => {
  await db.exec(resolve);
  assert.equal((await rows('select id from public.cases where id=3')).length, 0);
  assert.equal((await rows("update public.cases set status='Correction Required' where id=3 returning id")).length, 0);
  await db.exec(`set local request.jwt.claim.sub='${userB}';`);
  assert.equal((await rows('select id from public.cases where id=1')).length, 0);
  assert.equal((await rows('select id from public.case_review_history where case_id=1')).length, 0);
});
test('case ownership and document links cannot be changed during a review', async () => {
  await reject(`update public.cases set document_id='${docB}' where id=1`, /links cannot be changed/);
  await reject(`update public.cases set organization_id='${orgB}' where id=1`, /links cannot be changed/);
});
test('clients cannot forge, edit, or delete history or invoke its private writer', async () => {
  await db.exec(resolve);
  await reject(`insert into public.case_review_history(case_id,organization_id,actor_id,operation,after_values) values (1,'${orgA}','${userA}','UPDATE','{}')`, /permission denied/);
  await reject("update public.case_review_history set operation='INSERT'", /permission denied/);
  await reject('delete from public.case_review_history', /permission denied/);
  await reject('select careflow_private.record_case_review()', /permission denied/);
});
test('stale revision updates change zero rows and cannot overwrite newer corrections', async () => {
  await db.exec(resolve);
  const changed = await rows("update public.cases set status='Completed',review_confirmed=true where id=1 and review_revision=0 returning id");
  assert.equal(changed.length, 0);
  assert.equal((await rows('select review_revision from public.cases where id=1'))[0].review_revision, 1);
});
test('initial extraction remains possible but cannot silently overwrite existing results', async () => {
  await db.exec(`insert into public.cases(id,document_id,organization_id,status,document_type) values (10,'${docA}','${orgA}','Review','Healthcare document')`);
  await db.exec("update public.cases set patient_name='Synthetic extracted',document_date='2026-08-12',missing_information='Missing contact' where id=10");
  assert.equal((await rows('select review_revision from public.cases where id=10'))[0].review_revision, 1);
  await reject("update public.cases set patient_name='Overwritten extraction' where id=10", /new correction note/);
});
test('inserting completed cases and oversized correction notes is rejected', async () => {
  await reject(`insert into public.cases(id,document_id,organization_id,status) values(11,'${docA}','${orgA}','Completed')`, /Save and review a case/);
  await reject("update public.cases set review_notes=repeat('x',4001) where id=1", /maximum length/);
});
test('a human correction on an unprocessed case keeps unresolved items Correction Required', async () => {
  await db.exec(`insert into public.cases(id,document_id,organization_id,status,document_type) values (12,'${docA}','${orgA}','Review','Healthcare document')`);
  await db.exec("update public.cases set patient_name='Synthetic entered name', missing_information='Date still needed',review_notes='Synthetic manual correction before extraction.' where id=12");
  assert.equal((await rows('select status from public.cases where id=12'))[0].status, 'Correction Required');
});
test('a missing signed-in identity cannot write or manufacture a review record', async () => {
  await db.exec("reset role; set local request.jwt.claim.sub='';");
  await reject("update public.cases set status='Correction Required' where id=1", /Sign in before/);
});
