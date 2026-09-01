from pathlib import Path


def replace_once(path, old, new, label):
    text = path.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')

cases = Path('tests/cases.test.mjs')
replace_once(
    cases,
'''    querySelectorAll: selector => {
      assert.equal(selector, '.review-btn');
      return all(body).filter(element => element.className.split(' ').includes('review-btn'));
    },''',
'''    querySelectorAll: selector => {
      const allowed = new Set(['.review-btn', '.retry-processing-btn', '.review-btn, .retry-processing-btn']);
      assert.ok(allowed.has(selector), 'Unexpected selector: ' + selector);
      const classes = selector.split(',').map(value => value.trim().replace(/^\./, ''));
      return all(body).filter(element => classes.some(name => element.className.split(' ').includes(name)));
    },''',
    'DOM querySelectorAll support'
)

mock = Path('tests/mock-supabase.js')
replace_once(
    mock,
'''fixtureCases.forEach(row => { row.review_revision ??= 1; row.review_confirmed ??= false; row.review_notes ??= null; });''',
'''fixtureCases.forEach(row => {
  row.review_revision ??= 1;
  row.review_confirmed ??= false;
  row.review_notes ??= null;
  row.processing_status ??= 'ready';
  row.processing_attempts ??= 1;
  row.processing_error_code ??= null;
  row.processing_error_message ??= null;
  row.processing_started_at ??= null;
  row.processing_completed_at ??= row.created_at || null;
  row.processing_retryable ??= false;
});''',
    'fixture processing defaults'
)
replace_once(
    mock,
'''          fixtureCases.push({ ...payload[0], id: 9, created_at: "2026-09-01T00:00:00Z", review_revision: 0, review_confirmed: false, review_notes: null });''',
'''          fixtureCases.push({ ...payload[0], id: 9, created_at: "2026-09-01T00:00:00Z", review_revision: 0, review_confirmed: false, review_notes: null, processing_status: 'pending', processing_attempts: 0, processing_error_code: null, processing_error_message: null, processing_started_at: null, processing_completed_at: null, processing_retryable: true });''',
    'insert pending processing state'
)
replace_once(
    mock,
'''    recordFixtureQuery("invoke process-document");
    const extracted = { patient_name: "Uploaded Sample Patient", document_date: "2026-08-31", insurance_information: "Uploaded sample insurer", missing_information: "Sample missing contact" };
    Object.assign(fixtureCases.find(row => row.id === 9), extracted, { review_revision: 1 });
    storeFixtureCases();
    return { data: { success: true, extracted }, error: null };''',
'''    const documentId = options?.body?.document_id;
    recordFixtureQuery("invoke process-document " + documentId);
    const row = fixtureCases.find(item => item.document_id === documentId && item.organization_id === fixtureOrg);
    if (!row) return { data: null, error: { message: "Fixture: processing access denied" } };
    if (row.processing_status === 'ready') return { data: { success: true, processing_status: 'ready', already_ready: true }, error: null };
    row.processing_status = 'processing';
    row.processing_attempts = (row.processing_attempts || 0) + 1;
    row.processing_started_at = '2026-09-01T00:00:01Z';
    const extracted = { patient_name: "Uploaded Sample Patient", document_date: "2026-08-31", insurance_information: "Uploaded sample insurer", missing_information: "Sample missing contact" };
    Object.assign(row, extracted, { review_revision: 1, processing_status: 'ready', processing_error_code: null, processing_error_message: null, processing_completed_at: '2026-09-01T00:00:02Z', processing_retryable: false });
    storeFixtureCases();
    return { data: { success: true, processing_status: 'ready', attempt_number: row.processing_attempts, extracted }, error: null };''',
    'process-document fixture behavior'
)

processor = Path('tests/processor-access.test.mjs')
replace_once(
    processor,
"const documentId = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';",
"const documentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';",
    'valid synthetic document UUID'
)

print('Processing reliability test fixtures patched')
