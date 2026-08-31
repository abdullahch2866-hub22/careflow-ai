// Run with Node 22+: node --test tests/cases.test.mjs
// Executes the real inline app against a small DOM adapter and synthetic SDK.
// No browser, network, patient data, or live database writes are used.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const syntheticPdf = '%PDF-1.7\n% Fictional test fixture only\n%%EOF\n';
const pdfFile = (name = 'Example_Upload.pdf', type = 'application/pdf') => new File([syntheticPdf], name, { type });

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
const mock = fs.readFileSync(new URL('./mock-supabase.js', import.meta.url), 'utf8');

class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.className = '';
    this.disabled = false;
    this.checked = false;
    this.hidden = false;
    this.value = '';
    this.files = [];
    this.text = '';
  }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  set innerHTML(_) { throw new Error('Untrusted strings must not be inserted as HTML'); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; this.text = ''; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(event, callback) { (this.listeners[event] ||= []).push(callback); }
  focus() {}
  async dispatchEvent(event) { await Promise.all((this.listeners[event.type] || []).map(callback => callback.call(this, event))); }
  async click() { if (!this.disabled) await this.dispatchEvent({ type: 'click' }); }
}

function makeDocument() {
  const nodes = new Map();
  for (const match of html.matchAll(/<([a-z]+)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const element = new Element(match[1]);
    element.disabled = /\sdisabled(?:\s|>)/.test(match[0]);
    nodes.set(match[2], element);
  }
  for (const id of ['approveBtn', 'correctionBtn']) {
    const expression = new RegExp('<button[^>]*id="'+id+'"[^>]*>([\\s\\S]*?)<\\/button>');
    nodes.get(id).textContent = html.match(expression)[1].trim();
  }
  const header = new Element('header'), layout = new Element();
  const body = new Element('body');
  body.append(...nodes.values(), header, layout);
  const all = element => [element, ...element.children.flatMap(all)];
  return {
    body,
    getElementById: id => nodes.get(id) || null,
    createElement: tag => new Element(tag),
    querySelector: selector => ({ '.header': header, '.layout': layout })[selector] || null,
    querySelectorAll: selector => {
      assert.equal(selector, '.review-btn');
      return all(body).filter(element => element.className.split(' ').includes('review-btn'));
    },
    addEventListener() { /* Fixture controls are not needed for these non-browser tests. */ }
  };
}

async function flush() { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); }
async function page(store = new Map(), search = '') {
  const document = makeDocument();
  const context = vm.createContext({
    window: { addEventListener() {} }, document, location: { search }, URLSearchParams, structuredClone, crypto,
    sessionStorage: { getItem: key => store.get(key), setItem: (key, value) => store.set(key, value) },
    console,
    fetch() { throw new Error('Network forbidden in this test'); }
  });
  vm.runInContext(mock, context);
  scripts.forEach(script => vm.runInContext(script, context));
  await flush();
  return {
    store, document,
    element: id => document.getElementById(id),
    text: id => document.getElementById(id).textContent,
    run: code => vm.runInContext(code, context),
    async click(id) { await document.getElementById(id).click(); await flush(); },
    async confirm() { document.getElementById('reviewConfirmed').checked = true; await document.getElementById('reviewConfirmed').dispatchEvent({ type: 'change' }); },
    async correct(values = {}) {
      await document.getElementById('editDetailsBtn').click(); await flush();
      for (const [id,value] of Object.entries({editMissingInfo:'',editReviewNotes:'Synthetic contact supplied by fictional intake form.',...values})) document.getElementById(id).value=value;
      document.getElementById('correctionsConfirmed').checked = true;
      await document.getElementById('correctionForm').dispatchEvent({type:'submit',preventDefault(){}}); await flush();
    },
    async review(id) {
      const button = document.querySelectorAll('.review-btn').find(button => button.attributes['aria-label'].startsWith('Review case '+id+':'));
      assert.ok(button, 'Review button exists for case '+id);
      await button.click(); await flush();
    },
    saved: () => JSON.parse(store.get('careflow-fixture-cases') || '[]'),
    queries: () => JSON.parse(vm.runInContext('JSON.stringify(fixtureLog)', context))
  };
}

test('loads real cases scoped to the hospital and renders filenames as plain text', async () => {
  const p = await page();
  assert.match(p.text('uploadedCase'), /Example_A.pdf/);
  assert.match(p.text('uploadedCase'), /<img src=x onerror=alert\(1\)>.pdf/);
  assert.doesNotMatch(p.text('uploadedCase'), /OTHER_HOSPITAL_PRIVATE|Referral Document|Insurance Document|Patient Intake Form/);
  assert.equal(p.document.querySelectorAll('.review-btn').length, 2);
  assert.ok(p.queries().some(query => query.includes('select cases [["organization_id","fixture-hospital-a"]]')));
});

test('opens the selected case with its saved fields and current status', async () => {
  const p = await page();
  await p.review(8);
  assert.equal(p.text('reviewPatientName'), 'Sample Patient A');
  assert.equal(p.text('reviewStatusText'), 'Correction Required');
  assert.equal(p.element('correctionBtn').disabled, true);
  await p.review(7);
  assert.equal(p.text('reviewPatientName'), 'Sample Patient B');
  assert.equal(p.text('reviewDocumentDate'), '2026-08-12');
  assert.equal(p.text('reviewStatusText'), 'Review');
  assert.equal(p.element('missingInfoBadge').hidden, true);
});

test('saves both decisions to the selected case and keeps stable action labels', async () => {
  const p = await page();
  await p.review(8);
  await p.correct();
  await p.confirm();
  await p.click('approveBtn');
  assert.equal(p.text('reviewStatusText'), 'Completed');
  assert.equal(p.text('approveBtn'), 'Approve Document');
  assert.equal(p.text('correctionBtn'), 'Request Correction');
  await p.click('correctionBtn');
  assert.equal(p.text('reviewStatusText'), 'Correction Required');
  assert.equal(p.saved().find(row => row.id === 8).status, 'Correction Required');
  assert.equal(p.saved().find(row => row.id === 7).status, 'Review');
  assert.ok(p.queries().filter(query => query.startsWith('update cases')).every(query => query.includes('["id",8]') && query.includes('["document_id","fixture-document-8"]') && query.includes('["organization_id","fixture-hospital-a"]')));
});

test('a fresh page reload restores saved cases, details, and status without uploading', async () => {
  const first = await page();
  await first.review(7);
  await first.confirm();
  await first.click('approveBtn');
  const reloaded = await page(first.store);
  assert.match(reloaded.text('uploadedCase'), /Completed/);
  await reloaded.review(7);
  assert.equal(reloaded.text('reviewPatientName'), 'Sample Patient B');
  assert.equal(reloaded.text('reviewStatusText'), 'Completed');
  assert.equal(reloaded.queries().some(query => query.startsWith('storage') || query.startsWith('invoke')), false);
});

test('opens the source PDF through the secure viewer function and clears it when closed', async () => {
  const p = await page();
  await p.review(7);
  await p.click('viewSourceBtn');
  assert.equal(p.element('sourceViewerModal').hidden, false);
  assert.match(p.element('sourcePdfFrame').src, /fixture\.invalid\/secure-source\.pdf\?token=temporary/);
  assert.match(p.text('sourceViewerStatus'), /temporary access link expires/i);
  assert.ok(p.queries().some(query => query === 'invoke view-document fixture-document-7 case 7'));
  await p.click('closeSourceViewerBtn');
  assert.equal(p.element('sourceViewerModal').hidden, true);
  assert.equal(p.element('sourcePdfFrame').src, 'about:blank');
});

test('failed saves keep the previous status and re-enable the controls', async () => {
  const p = await page();
  await p.review(7);
  p.run('fixtureFailSave = true');
  await p.confirm();
  await p.click('approveBtn');
  assert.equal(p.text('reviewStatusText'), 'Review');
  assert.match(p.text('reviewActionStatus'), /Could not save.*save rejected/);
  assert.equal(p.element('approveBtn').disabled, false);
  await p.click('approveBtn');
  assert.equal(p.text('reviewStatusText'), 'Completed');
});

test('zero-row updates cannot report a successful save', async () => {
  const p = await page();
  await p.review(7);
  p.run('fixtureEmpty = true');
  await p.confirm();
  await p.click('approveBtn');
  assert.equal(p.text('reviewStatusText'), 'Review');
  assert.match(p.text('reviewActionStatus'), /Could not save/);
});

test('list errors clear stale rows, report failure, and allow a retry', async () => {
  const p = await page();
  p.run('fixtureFailList = true');
  await p.click('reloadCasesBtn');
  assert.equal(p.document.querySelectorAll('.review-btn').length, 0);
  assert.match(p.text('caseListStatus'), /Could not load saved cases/);
  await p.click('reloadCasesBtn');
  assert.equal(p.document.querySelectorAll('.review-btn').length, 2);
  assert.equal(p.text('caseListStatus'), '');
});

test('an empty hospital shows an honest empty state', async () => {
  const p = await page();
  p.run('fixtureEmpty = true');
  await p.click('reloadCasesBtn');
  assert.equal(p.text('uploadedCase'), '');
  assert.match(p.text('caseListStatus'), /No saved cases yet/);
});

test('sign-out clears patient fields and cases; signed-out startup reads no cases', async () => {
  const p = await page();
  await p.review(8);
  p.run('fixtureAuthCallback("SIGNED_OUT")');
  assert.equal(p.text('uploadedCase'), '');
  assert.equal(p.text('reviewPatientName'), '');
  assert.equal(p.element('approveBtn').disabled, true);
  const signedOut = await page(new Map(), '?signed-out');
  assert.equal(signedOut.queries().length, 0);
  assert.equal(signedOut.element('uploadBtn').disabled, true);
});

test('new upload keeps earlier cases and opens persisted AI details', async () => {
  const p = await page();
  const input = p.element('documentInput');
  input.files = [pdfFile()];
  input.value = 'Example_Upload.pdf';
  await input.dispatchEvent({ type: 'change' });
  await flush();
  assert.match(p.text('uploadStatus'), /Uploaded and processed successfully/);
  assert.equal(p.document.querySelectorAll('.review-btn').length, 3);
  assert.match(p.text('uploadedCase'), /Example_A.pdf/);
  assert.equal(input.value, '');
  await p.review(9);
  assert.equal(p.text('reviewPatientName'), 'Uploaded Sample Patient');
});

test('invalid file types, empty PDFs, renamed files, and truncated PDFs cause no upload or data writes', async () => {
  for (const file of [
    new File(['image'], 'picture.png', {type:'image/png'}),
    new File([syntheticPdf], 'picture.pdf', {type:'image/png'}),
    new File([], 'empty.pdf', {type:'application/pdf'}),
    new File(['not a PDF\n%%EOF'], 'renamed.pdf', {type:'application/pdf'}),
    new File(['%PDF-1.7\ntruncated'], 'truncated.pdf', {type:'application/pdf'})
  ]) {
    const p = await page();
    await p.review(8);
    const original = p.saved();
    const input = p.element('documentInput');
    input.files = [file];
    await input.dispatchEvent({type:'change'});
    assert.match(p.text('uploadStatus'), /PDF|empty/);
    assert.equal(p.queries().some(q=>/^(storage upload|insert|invoke)/.test(q)), false);
    assert.deepEqual(p.saved(), original);
    assert.equal(p.text('reviewPatientName'), 'Sample Patient A');
    assert.equal(p.element('uploadBtn').disabled, false);
    assert.equal(input.value, '');
  }
});

test('oversized files are rejected before reading any bytes', async () => {
  const p = await page();
  p.element('documentInput').files = [{
    name:'TooLarge.pdf', type:'application/pdf', size:10*1024*1024+1,
    slice() { throw new Error('Oversized file must not be read'); }
  }];
  await p.element('documentInput').dispatchEvent({type:'change'});
  assert.match(p.text('uploadStatus'), /too large/);
  assert.equal(p.queries().some(q=>/^(storage upload|insert|invoke)/.test(q)), false);
});

test('the size boundary and PDF 2.0 header are accepted by the browser checks', async () => {
  const p = await page();
  const file = new File(['%PDF-2.0\n', new Uint8Array(10*1024*1024-15), '%%EOF\n'], 'Boundary.PDF', {type:'application/pdf'});
  assert.equal(file.size, 10*1024*1024);
  p.element('documentInput').files = [file];
  await p.element('documentInput').dispatchEvent({type:'change'});
  assert.match(p.text('uploadStatus'), /Uploaded and processed successfully/);
});

test('unknown MIME types are normalized after checking the PDF bytes and storage paths hide original filenames', async () => {
  for (const type of ['', 'application/octet-stream']) {
    const p = await page();
    p.element('documentInput').files = [pdfFile('Fictional Patient 中文.PDF', type)];
    await p.element('documentInput').dispatchEvent({type:'change'});
    const upload = p.queries().find(q=>q.startsWith('storage upload '));
    assert.ok(upload);
    const [path, options] = JSON.parse(upload.slice('storage upload '.length));
    assert.match(path, /^fixture-hospital-a\/[0-9a-f-]{36}\.pdf$/);
    assert.equal(path.includes('Patient'), false);
    assert.deepEqual(options, {contentType:'application/pdf',upsert:false});
  }
});

test('sign-out while file checking is pending prevents uploading or creating records', async () => {
  const p = await page();
  const file = pdfFile();
  let release;
  p.element('documentInput').files = [{
    name:file.name, type:file.type, size:file.size,
    slice(start,end) { return start === 0 && end === 8
      ? {text:()=>new Promise(resolve=>{release=resolve;})}
      : file.slice(start,end); }
  }];
  const pending = p.element('documentInput').dispatchEvent({type:'change'});
  p.run('fixtureSignedOut = true; fixtureAuthCallback("SIGNED_OUT")');
  release('%PDF-1.7');
  await pending; await flush();
  assert.equal(p.queries().some(q=>/^(storage upload|insert|invoke)/.test(q)), false);
  assert.equal(p.element('uploadBtn').disabled, true);
});

test('file selection cannot discard an open correction draft', async () => {
  const p = await page();
  await p.review(8);
  await p.click('editDetailsBtn');
  p.element('editPatientName').value = 'Unsaved fictional correction';
  p.element('documentInput').files = [pdfFile()];
  await p.element('documentInput').dispatchEvent({type:'change'});
  assert.equal(p.element('correctionForm').hidden, false);
  assert.equal(p.element('editPatientName').value, 'Unsaved fictional correction');
  assert.equal(p.queries().some(q=>q.startsWith('storage upload')), false);
});

test('a rapid second decision is blocked while the first save is pending', async () => {
  const p = await page();
  await p.review(7);
  await p.confirm();
  const pending = p.element('approveBtn').click();
  await p.element('correctionBtn').click();
  await pending; await flush();
  assert.equal(p.queries().filter(query => query.startsWith('update cases')).length, 1);
  assert.equal(p.text('reviewStatusText'), 'Completed');
});

test('unresolved fields block approval in both the controls and the event handler', async () => {
  const p = await page();
  await p.review(8);
  await p.confirm();
  assert.equal(p.element('approveBtn').disabled,true);
  assert.match(p.text('approvalGuidance'),/Resolve the missing information/);
  await p.run('saveCaseStatus("Completed")');
  assert.equal(p.queries().some(q=>q.startsWith('update cases')),false);
});

test('corrected values and notes survive refresh, and saving does not approve the case', async () => {
  const p = await page();
  await p.review(8);
  await p.correct({editPatientName:'Corrected Synthetic Name',editInsurance:'Synthetic self-pay',editReviewNotes:'Name and payment corrected from fictional signed intake. Synthetic contact supplied.'});
  assert.equal(p.text('reviewStatusText'),'Review');
  assert.equal(p.element('approveBtn').disabled,true);
  assert.equal(p.element('correctionForm').hidden,true);
  const next = await page(p.store);
  await next.review(8);
  assert.equal(next.text('reviewPatientName'),'Corrected Synthetic Name');
  assert.equal(next.text('reviewInsurance'),'Synthetic self-pay');
  assert.match(next.text('reviewNotes'),/fictional signed intake/);
  assert.equal(next.element('missingInfoBadge').hidden,true);
  assert.equal(next.element('reviewConfirmed').checked,false);
});

test('blank notes and unchecked correction confirmation cannot submit a save', async () => {
  const p = await page();
  await p.review(8);
  await p.click('editDetailsBtn');
  p.element('editMissingInfo').value='';
  const submit=()=>p.element('correctionForm').dispatchEvent({type:'submit',preventDefault(){}});
  await submit();
  assert.match(p.text('reviewActionStatus'),/new correction note/);
  p.element('editReviewNotes').value='Synthetic note from a fictional supplied correction.';
  await submit();
  assert.match(p.text('reviewActionStatus'),/Tick the confirmation box/);
  assert.equal(p.queries().some(q=>q.startsWith('update cases')),false);
});

test('cancel discards the draft without writing and protects navigation while editing', async () => {
  const p=await page();
  await p.review(8);
  await p.click('editDetailsBtn');
  p.element('editPatientName').value='Unsubmitted synthetic value';
  assert.equal(p.element('uploadBtn').disabled,true);
  assert.equal(p.element('reloadCasesBtn').disabled,true);
  assert.ok(p.document.querySelectorAll('.review-btn').every(b=>b.disabled));
  await p.click('cancelEditBtn');
  assert.equal(p.text('reviewPatientName'),'Sample Patient A');
  assert.equal(p.element('editPatientName').value,'');
  assert.equal(p.element('uploadBtn').disabled,false);
  assert.equal(p.queries().some(q=>q.startsWith('update cases')),false);
});

test('a failed correction save retains the draft without showing it as saved', async () => {
  const p=await page();
  await p.review(8);
  p.run('fixtureFailSave=true');
  await p.correct({editPatientName:'Draft Synthetic Name'});
  assert.equal(p.text('reviewPatientName'),'Sample Patient A');
  assert.equal(p.element('editPatientName').value,'Draft Synthetic Name');
  assert.equal(p.element('correctionForm').hidden,false);
  assert.match(p.text('reviewActionStatus'),/Could not save/);
  assert.equal(p.element('saveDetailsBtn').disabled,false);
});

test('a changed revision is rejected instead of overwriting another open tab', async () => {
  const p=await page();
  await p.review(8);
  p.run('fixtureCases.find(row=>row.id===8).review_revision+=1');
  await p.correct({editPatientName:'Stale Synthetic Name'});
  assert.match(p.text('reviewActionStatus'),/Could not save/);
  assert.equal(p.element('correctionForm').hidden,false);
  assert.equal(p.run('fixtureCases.find(row=>row.id===8).patient_name'),'Sample Patient A');
});

test('sign-out clears unsaved fields and their confirmation', async () => {
  const p=await page();
  await p.review(8);
  await p.click('editDetailsBtn');
  p.element('editReviewNotes').value='Synthetic private draft';
  p.element('correctionsConfirmed').checked=true;
  p.run('fixtureAuthCallback("SIGNED_OUT")');
  for(const id of ['editPatientName','editDocumentType','editDocumentDate','editInsurance','editMissingInfo','editReviewNotes']) assert.equal(p.element(id).value,'');
  assert.equal(p.element('correctionsConfirmed').checked,false);
  assert.equal(p.element('correctionForm').hidden,true);
});

test('partial corrections keep missing items visible and approval disabled', async () => {
  const p=await page();
  await p.review(8);
  await p.correct({editMissingInfo:'Synthetic authorization number still needed'});
  assert.equal(p.text('reviewStatusText'),'Correction Required');
  assert.equal(p.element('missingInfoBadge').hidden,false);
  assert.equal(p.element('approveBtn').disabled,true);
});
