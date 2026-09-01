// Run: node --test tests/processor-access.test.mjs (Node.js 24+).
// Runs the actual handler with synthetic caller/admin clients. No network or data writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

const source = fs.readFileSync(new URL('../supabase/functions/process-document/index.ts', import.meta.url), 'utf8');
const executable = stripTypeScriptTypes(source.replace(/^import .*;\s*$/gm, ''), { mode: 'strip' })
  .replace('export default', 'const processor =');

const organization = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const otherOrganization = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const documentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const userId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const runId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const syntheticPdf = '%PDF-1.7\n% Fictional test fixture only\n%%EOF\n';

function fixture(options = {}) {
  const calls = { provider: 0, infos: [], downloads: [], queries: [], rpcs: [] };
  const file = options.file || new Blob([syntheticPdf], { type: 'application/pdf' });
  const caseRow = {
    id: 8,
    organization_id: organization,
    document_id: documentId,
    processing_status: options.processingStatus || 'pending',
    processing_attempts: options.processingAttempts || 0,
  };
  const documentRow = {
    id: documentId,
    organization_id: organization,
    storage_path: options.path ?? organization + '/123-Synthetic.pdf',
    file_name: options.fileName ?? 'Synthetic.pdf',
  };

  function from(table) {
    let filters = [];
    async function run() {
      calls.queries.push({ table, filters: [...filters] });
      if ((table === 'cases' && options.caseDenied) || (table === 'documents' && options.documentDenied)) {
        return { data: null, error: { message: 'Access denied' } };
      }
      const row = table === 'cases' ? caseRow : documentRow;
      if (!filters.every(([key, value]) => row[key] === value)) return { data: null, error: { message: 'No matching row' } };
      return { data: { ...row }, error: null };
    }
    const builder = {
      select() { return builder; },
      eq(key, value) { filters.push([key, value]); return builder; },
      single: run,
      then(resolve, reject) { return run().then(resolve, reject); },
    };
    return builder;
  }

  const scoped = {
    auth: {
      async getUser() {
        if (options.authDenied) return { data: { user: null }, error: { message: 'Invalid session' } };
        return { data: { user: { id: userId, email: 'synthetic@example.test' } }, error: null };
      },
    },
    from,
  };

  const admin = {
    async rpc(name, args) {
      calls.rpcs.push({ name, args });
      if (name === 'careflow_claim_document_processing') {
        if (options.claimError) return { data: null, error: { message: 'claim failed' } };
        const state = options.claimState || 'claimed';
        if (state === 'claimed') {
          return { data: [{ claimed: true, claim_state: 'claimed', run_id: runId, attempt_number: 1, retryable: true, message: 'Processing started.' }], error: null };
        }
        return { data: [{
          claimed: false,
          claim_state: state,
          run_id: state === 'processing' || state === 'ready' ? runId : null,
          attempt_number: options.processingAttempts || 1,
          retryable: state === 'processing',
          message: state === 'retry_limit' ? 'Retry limit reached. Contact your CareFlow administrator.' :
            state === 'not_retryable' ? 'This document must be re-uploaded.' :
            state === 'processing' ? 'Processing is already running.' :
            state === 'ready' ? 'Document is already processed.' : 'Access denied.',
        }], error: null };
      }
      if (name === 'careflow_finish_document_processing') {
        if (options.finishError) return { data: null, error: { message: 'finish failed' } };
        return { data: options.finishFalse ? false : true, error: null };
      }
      if (name === 'careflow_fail_document_processing') {
        return { data: true, error: null };
      }
      throw new Error('Unexpected RPC: ' + name);
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, 'documents');
        return {
          async info(path) {
            calls.infos.push(path);
            if (options.infoDenied) return { data: null, error: { message: 'Storage metadata unavailable' } };
            return { data: { size: Object.hasOwn(options, 'infoSize') ? options.infoSize : file.size }, error: null };
          },
          async download(path) {
            calls.downloads.push(path);
            if (options.storageDenied) return { data: null, error: { message: 'Storage unavailable' } };
            return { data: file, error: null };
          },
        };
      },
    },
  };

  const context = vm.createContext({
    Response, Request, Uint8Array, btoa,
    console: { error() {} },
    Deno: { env: { get() { return options.noApiKey ? null : 'synthetic-placeholder'; } } },
    withSupabase(config, handler) { assert.equal(config.auth, 'user'); return handler; },
    async fetch(url, request) {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      calls.provider += 1;
      if (options.providerThrows) throw new Error('network down');
      if (options.providerError) return Response.json({ error: { code: 'synthetic_failure' } }, { status: 503 });
      assert.equal(JSON.parse(request.body).store, false);
      if (options.invalidProviderJson) return new Response('not json', { status: 200 });
      return Response.json({ output: [{ content: [{ type: 'output_text', text: options.invalidExtractionJson ? '{bad json' : JSON.stringify({
        patient_name: 'Synthetic Patient',
        document_date: '2026-08-31',
        insurance_information: 'Synthetic insurer',
        missing_information: 'Synthetic missing field',
      }) }] }] });
    },
  });
  vm.runInContext(executable, context);

  return {
    calls,
    async invoke(body = { document_id: documentId }) {
      const handler = vm.runInContext('processor.fetch', context);
      const response = await handler(new Request('https://fixture.invalid/process', {
        method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
      }), { supabase: scoped, supabaseAdmin: admin });
      return { status: response.status, body: await response.json() };
    },
  };
}

function rpcCalls(f, name) {
  return f.calls.rpcs.filter(call => call.name === name);
}

test('authorized processing claims one run and finishes it with extracted data', async () => {
  const f = fixture();
  const response = await f.invoke();
  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.processing_status, 'ready');
  assert.equal(response.body.extracted.patient_name, 'Synthetic Patient');
  assert.equal(f.calls.provider, 1);
  assert.equal(rpcCalls(f, 'careflow_claim_document_processing').length, 1);
  const finish = rpcCalls(f, 'careflow_finish_document_processing')[0];
  assert.equal(finish.args.p_run_id, runId);
  assert.equal(finish.args.p_actor_id, userId);
  assert.equal(finish.args.p_patient_name, 'Synthetic Patient');
  assert.equal(rpcCalls(f, 'careflow_fail_document_processing').length, 0);
});

test('an already-ready document is idempotent and does not call Storage or AI', async () => {
  const f = fixture({ claimState: 'ready', processingAttempts: 1 });
  const response = await f.invoke();
  assert.equal(response.status, 200);
  assert.equal(response.body.already_ready, true);
  assert.equal(response.body.processing_status, 'ready');
  assert.equal(f.calls.provider, 0);
  assert.equal(f.calls.infos.length, 0);
});

test('a currently running document returns processing without starting another run', async () => {
  const f = fixture({ claimState: 'processing', processingAttempts: 2 });
  const response = await f.invoke();
  assert.equal(response.status, 200);
  assert.equal(response.body.already_processing, true);
  assert.equal(response.body.processing_status, 'processing');
  assert.equal(f.calls.provider, 0);
});

test('retry limits and non-retryable failures are returned without reading the source file', async () => {
  for (const [claimState, expectedStatus] of [['retry_limit', 429], ['not_retryable', 409]]) {
    const f = fixture({ claimState, processingAttempts: 5 });
    assert.equal((await f.invoke()).status, expectedStatus);
    assert.equal(f.calls.provider, 0);
    assert.equal(f.calls.downloads.length, 0);
  }
});

test('a record pointing at another hospital folder fails the claimed run before reading Storage', async () => {
  const f = fixture({ path: otherOrganization + '/private.pdf' });
  const response = await f.invoke();
  assert.equal(response.status, 404);
  assert.equal(response.body.processing_status, 'failed');
  assert.equal(f.calls.downloads.length, 0);
  assert.equal(f.calls.provider, 0);
  const failure = rpcCalls(f, 'careflow_fail_document_processing')[0];
  assert.equal(failure.args.p_error_code, 'invalid_storage_path');
  assert.equal(failure.args.p_retryable, false);
});

test('temporary Storage failure is persisted as retryable instead of losing the case', async () => {
  const f = fixture({ storageDenied: true });
  const response = await f.invoke();
  assert.equal(response.status, 502);
  assert.equal(response.body.retryable, true);
  assert.equal(f.calls.provider, 0);
  const failure = rpcCalls(f, 'careflow_fail_document_processing')[0];
  assert.equal(failure.args.p_error_code, 'storage_unavailable');
  assert.equal(failure.args.p_retryable, true);
});

test('invalid and oversized PDFs fail permanently with a safe re-upload message', async () => {
  const invalid = fixture({ file: new Blob(['not pdf']) });
  assert.equal((await invalid.invoke()).status, 415);
  assert.equal(rpcCalls(invalid, 'careflow_fail_document_processing')[0].args.p_retryable, false);

  const oversized = fixture({ infoSize: 10 * 1024 * 1024 + 1 });
  assert.equal((await oversized.invoke()).status, 413);
  assert.equal(rpcCalls(oversized, 'careflow_fail_document_processing')[0].args.p_error_code, 'file_too_large');
  assert.equal(oversized.calls.downloads.length, 0);
});

test('AI network/provider/output failures become retryable processing failures', async () => {
  for (const options of [{ providerThrows: true }, { providerError: true }, { invalidProviderJson: true }, { invalidExtractionJson: true }]) {
    const f = fixture(options);
    const response = await f.invoke();
    assert.equal(response.status, 502);
    assert.equal(response.body.retryable, true);
    assert.equal(rpcCalls(f, 'careflow_fail_document_processing').length, 1);
  }
});

test('missing API configuration is persisted as a retryable service failure', async () => {
  const f = fixture({ noApiKey: true });
  const response = await f.invoke();
  assert.equal(response.status, 503);
  const failure = rpcCalls(f, 'careflow_fail_document_processing')[0];
  assert.equal(failure.args.p_error_code, 'service_unavailable');
  assert.equal(failure.args.p_retryable, true);
});

test('a superseded run cannot report or overwrite stale results', async () => {
  const f = fixture({ finishFalse: true });
  const response = await f.invoke();
  assert.equal(response.status, 409);
  assert.equal(response.body.extracted, undefined);
  assert.equal(rpcCalls(f, 'careflow_finish_document_processing').length, 1);
});

test('authentication and caller-scoped RLS are checked before claiming a processing run', async () => {
  const unauthenticated = fixture({ authDenied: true });
  assert.equal((await unauthenticated.invoke()).status, 401);
  assert.equal(unauthenticated.calls.rpcs.length, 0);

  const denied = fixture({ caseDenied: true });
  assert.equal((await denied.invoke()).status, 404);
  assert.equal(denied.calls.rpcs.length, 0);
});

test('invalid document identifiers are rejected before accessing data or claims', async () => {
  for (const body of [{}, { document_id: '' }, { document_id: ['not-a-string'] }]) {
    const f = fixture();
    assert.equal((await f.invoke(body)).status, 400);
    assert.equal(f.calls.queries.length, 0);
    assert.equal(f.calls.rpcs.length, 0);
    assert.equal(f.calls.provider, 0);
  }
});
