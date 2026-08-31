// Run: node --test tests/processor-access.test.mjs (Node.js 24+).
// Runs the actual handler with synthetic user-scoped clients. No network or data writes.
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
const documentId = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
const syntheticPdf = '%PDF-1.7\n% Fictional test fixture only\n%%EOF\n';

function fixture(options = {}) {
  const calls = { provider: 0, infos: [], downloads: [], queries: [], writes: [] };
  const file = options.file || new Blob([syntheticPdf], {type:'application/pdf'});
  const caseRow = { id: 8, organization_id: organization, document_id: documentId, review_revision: 0, status: 'Review', ...options.caseFields };
  const documentRow = {
    id: documentId, organization_id: organization,
    storage_path: options.path ?? organization + '/123-Synthetic.pdf',
    file_name: options.fileName ?? 'Synthetic.pdf'
  };
  const from = table => {
    let filters = [], payload = null;
    async function run() {
      calls.queries.push({ table, filters: [...filters], action: payload ? 'update' : 'select' });
      if ((table === 'cases' && options.caseDenied) || (table === 'documents' && options.documentDenied)) {
        return { data: null, error: { message: 'Access denied' } };
      }
      const row = table === 'cases' ? caseRow : documentRow;
      if (!filters.every(([key, value]) => row[key] === value)) return { data: null, error: { message: 'No matching row' } };
      if (payload) {
        if (options.writeDenied) return { data: null, error: { message: 'Access was removed' } };
        if (options.zeroRows) return { data: null, error: null };
        calls.writes.push({ table, filters: [...filters], payload });
      }
      return { data: { ...row }, error: null };
    }
    const builder = {
      select() { return builder; },
      eq(key, value) { filters.push([key, value]); return builder; },
      update(value) { payload = value; return builder; },
      single: run,
      then(resolve, reject) { return run().then(resolve, reject); }
    };
    return builder;
  };
  const scoped = { from, storage: { from(bucket) {
    assert.equal(bucket, 'documents');
    return {
      async info(path) {
        calls.infos.push(path);
        if (options.infoDenied) return {data:null,error:{message:'Access denied'}};
        return {data:{size:Object.hasOwn(options,'infoSize') ? options.infoSize : file.size},error:null};
      },
      async download(path) {
      calls.downloads.push(path);
      if (options.storageDenied) return { data: null, error: { message: 'Storage access denied' } };
      return { data: file, error: null };
    } };
  } } };
  const ctx = {
    supabase: scoped,
    get supabaseAdmin() { throw new Error('Handler must not access the administrator client'); }
  };
  const context = vm.createContext({
    Response, Request, Uint8Array, btoa,
    console: { error() {} },
    Deno: { env: { get() { return 'synthetic-placeholder'; } } },
    withSupabase(config, handler) { assert.equal(config.auth, 'user'); return handler; },
    async fetch(url, request) {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      calls.provider += 1;
      if (options.concurrentEdit) caseRow.review_revision += 1;
      assert.equal(JSON.parse(request.body).store, false);
      return Response.json({ output: [{ content: [{ type: 'output_text', text: JSON.stringify({
        patient_name: 'Synthetic Patient', document_date: '2026-08-31',
        insurance_information: 'Synthetic insurer', missing_information: 'Synthetic missing field'
      }) }] }] });
    }
  });
  vm.runInContext(executable, context);
  return {
    calls,
    async invoke(body = { document_id: documentId }) {
      const handler = vm.runInContext('processor.fetch', context);
      const response = await handler(new Request('https://fixture.invalid/process', {
        method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' }
      }), ctx);
      return { status: response.status, body: await response.json() };
    }
  };
}

test('an authorized hospital can process its file and save to the exact case', async () => {
  const f = fixture();
  const response = await f.invoke();
  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.extracted.patient_name, 'Synthetic Patient');
  assert.equal(f.calls.provider, 1);
  assert.equal(f.calls.writes.length, 1);
  assert.deepEqual(f.calls.writes[0].filters, [
    ['id', 8], ['document_id', documentId], ['organization_id', organization], ['review_revision', 0]
  ]);
});

test('a record pointing at another hospital folder is rejected before reading or processing', async () => {
  const f = fixture({ path: otherOrganization + '/private.pdf' });
  const response = await f.invoke();
  assert.equal(response.status, 404);
  assert.equal(f.calls.downloads.length, 0);
  assert.equal(f.calls.provider, 0);
  assert.equal(f.calls.writes.length, 0);
});

test('folder traversal and ambiguous separators are rejected before a file read', async () => {
  for (const suffix of ['/../'+otherOrganization+'/file.pdf', '/./file.pdf', '//file.pdf', '/folder\\file.pdf']) {
    const f = fixture({ path: organization + suffix });
    assert.equal((await f.invoke()).status, 404);
    assert.equal(f.calls.downloads.length, 0);
    assert.equal(f.calls.provider, 0);
  }
});

test('Storage permission denial prevents the file being sent for AI processing', async () => {
  const f = fixture({ storageDenied: true });
  assert.equal((await f.invoke()).status, 404);
  assert.equal(f.calls.downloads.length, 1);
  assert.equal(f.calls.provider, 0);
});

test('inaccessible cases or documents cannot trigger a file read', async () => {
  for (const options of [{ caseDenied: true }, { documentDenied: true }]) {
    const f = fixture(options);
    assert.equal((await f.invoke()).status, 404);
    assert.equal(f.calls.downloads.length, 0);
    assert.equal(f.calls.provider, 0);
  }
});

test('removed update permissions prevent returning extraction results', async () => {
  const f = fixture({ writeDenied: true });
  const response = await f.invoke();
  assert.equal(response.status, 500);
  assert.equal(response.body.success, undefined);
  assert.equal(response.body.extracted, undefined);
  assert.equal(f.calls.writes.length, 0);
});

test('a zero-row update cannot report successful processing', async () => {
  const response = await fixture({ zeroRows: true }).invoke();
  assert.equal(response.status, 500);
  assert.equal(response.body.extracted, undefined);
});

test('invalid document identifiers are rejected before accessing data', async () => {
  for (const body of [{}, { document_id: '' }, { document_id: ['not-a-string'] }]) {
    const f = fixture();
    assert.equal((await f.invoke(body)).status, 400);
    assert.equal(f.calls.queries.length, 0);
    assert.equal(f.calls.provider, 0);
  }
});

test('processing cannot overwrite previously saved results or human review decisions', async () => {
  for (const caseFields of [{review_revision:1},{patient_name:'Existing synthetic patient'},{review_notes:'Human correction'},{status:'Completed'},{status:'Correction Required'}]) {
    const f = fixture({caseFields});
    assert.equal((await f.invoke()).status,409);
    assert.equal(f.calls.provider,0);
    assert.equal(f.calls.downloads.length,0);
  }
});

test('a correction made during AI processing prevents overwriting or returning stale extraction', async () => {
  const f = fixture({concurrentEdit:true});
  const response = await f.invoke();
  assert.equal(response.status,500);
  assert.equal(response.body.extracted,undefined);
  assert.equal(f.calls.writes.length,0);
});

test('non-PDF document names are rejected before Storage reads or AI calls', async () => {
  const f = fixture({fileName:'Renamed.png'});
  assert.equal((await f.invoke()).status, 415);
  assert.equal(f.calls.infos.length,0);
  assert.equal(f.calls.downloads.length,0);
  assert.equal(f.calls.provider,0);
});

test('Storage metadata denial prevents downloads and AI calls', async () => {
  const f = fixture({infoDenied:true});
  assert.equal((await f.invoke()).status,404);
  assert.equal(f.calls.downloads.length,0);
  assert.equal(f.calls.provider,0);
});

test('oversized stored files are rejected before downloading', async () => {
  const f = fixture({infoSize:10*1024*1024+1});
  assert.equal((await f.invoke()).status,413);
  assert.equal(f.calls.downloads.length,0);
  assert.equal(f.calls.provider,0);
  assert.equal(f.calls.writes.length,0);
});

test('missing, invalid, or zero size metadata fails closed before download', async () => {
  for (const infoSize of [undefined,null,0,-1,'100',NaN,Infinity,1.5]) {
    const f = fixture({infoSize});
    assert.equal((await f.invoke()).status,415);
    assert.equal(f.calls.downloads.length,0);
    assert.equal(f.calls.provider,0);
  }
});

test('a downloaded file larger than its metadata limit is rejected without reading its bytes', async () => {
  const f = fixture({infoSize:100,file:{size:10*1024*1024+1, slice(){throw new Error('Must not read oversized bytes');}}});
  assert.equal((await f.invoke()).status,413);
  assert.equal(f.calls.provider,0);
  assert.equal(f.calls.writes.length,0);
});

test('renamed, empty, and truncated files never reach the AI provider', async () => {
  for (const data of ['', 'PNG DATA\n%%EOF', '%PDF-1.7\ntruncated']) {
    const f = fixture({infoSize:100,file:new Blob([data])});
    assert.equal((await f.invoke()).status,415);
    assert.equal(f.calls.provider,0);
    assert.equal(f.calls.writes.length,0);
  }
});

test('a valid PDF envelope at exactly 10 MB reaches the provider', async () => {
  const file = new Blob(['%PDF-2.0\n',new Uint8Array(10*1024*1024-15),'%%EOF\n']);
  const f = fixture({file,fileName:'Boundary.PDF'});
  assert.equal(file.size,10*1024*1024);
  assert.equal((await f.invoke()).status,200);
  assert.equal(f.calls.provider,1);
});
