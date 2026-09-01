import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const processor = fs.readFileSync(new URL('../supabase/functions/process-document/index.ts', import.meta.url), 'utf8');

test('case queries include persistent processing state', () => {
  for (const field of [
    'processing_status', 'processing_error_code', 'processing_error_message',
    'processing_attempts', 'processing_started_at', 'processing_completed_at', 'processing_retryable'
  ]) {
    assert.match(html, new RegExp(field));
  }
});

test('frontend exposes safe processing states and recovery controls', () => {
  assert.match(html, /AI Processing/);
  assert.match(html, /Retry Processing/);
  assert.match(html, /function canRetryProcessing\(/);
  assert.match(html, /function processingIsStale\(/);
  assert.match(html, /PROCESSING_STALE_MS = 10 \* 60 \* 1000/);
  assert.match(html, /processing_attempts \?\? 0/);
  assert.match(html, /Processing failed/);
});

test('review and approval are blocked until processing is ready', () => {
  assert.match(html, /row\.processing_status !== "ready"/);
  assert.match(html, /currentCase\?\.processing_status !== "ready"/);
  assert.match(html, /currentCase\.processing_status !== "ready"/);
});

test('upload keeps a saved case when AI processing fails', () => {
  assert.match(html, /Upload saved\. AI is processing the document/);
  assert.match(html, /Use Retry Processing on the saved case/);
  assert.match(html, /await loadCases\(\);\s*uploadStatus\.textContent = "Upload saved/);
  assert.doesNotMatch(html, /throw new Error\("AI processing failed: " \+ details\)/);
});

test('frontend retry invokes the same saved document rather than creating a duplicate case', () => {
  assert.match(html, /async function retryCaseProcessing\(caseId\)/);
  assert.match(html, /invokeDocumentProcessing\(row\.document_id\)/);
  const retryBody = html.match(/async function retryCaseProcessing\(caseId\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.doesNotMatch(retryBody, /\.from\("cases"\)\.insert/);
  assert.doesNotMatch(retryBody, /storage\.from\("documents"\)\.upload/);
});

test('processor uses claim finish and failure RPCs instead of a direct case update', () => {
  assert.match(processor, /careflow_claim_document_processing/);
  assert.match(processor, /careflow_finish_document_processing/);
  assert.match(processor, /careflow_fail_document_processing/);
  assert.match(processor, /withSupabase\(\{ auth: "user" \}/);
  assert.match(processor, /ctx\.supabase\.auth\.getUser\(\)/);
  assert.doesNotMatch(processor, /\.from\("cases"\)\s*\.update\(/);
});

test('processor returns idempotent running and ready states', () => {
  assert.match(processor, /already_ready: true/);
  assert.match(processor, /already_processing: true/);
  assert.match(processor, /claim\.claim_state === "retry_limit"/);
  assert.match(processor, /processing_status: "failed"/);
  assert.match(processor, /retryable/);
});
