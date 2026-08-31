# Correction release

This release adds Edit Details and Save Corrections to the selected case.
Reviewers can correct administrative fields, record supplied missing details
and their source in a new note, and retain unresolved items in the missing list.
There is no unrestricted "approve anyway" override in this release.

Saving corrections returns the case to Review or Correction Required. A separate
confirmation and approval is required afterward. Completion requires a linked
document, patient name, document type, document date, and no unresolved items.
Insurance is optional (for example, a self-pay document). The database enforces
these prototype rules; hospital-specific policy configuration is future work.

The source PDF is unchanged. Existing statuses and extracted details are not
rewritten by the additive schema migration. Old completed cases with missing
details stay visible and can be reopened with Edit Details. Protected history
records the before/after values of new updates, the authenticated actor, and
server time. History is not backfilled for actions that predate this release.

The private SECURITY DEFINER trigger only appends history after a permitted
case write and checks membership again. Clients have SELECT-only access to
their hospital's history and cannot forge or alter it. Case authorization
continues to use the existing RLS policies. Review revision filters prevent
stale browser edits and delayed AI responses from replacing newer changes.
Previously saved extraction is not sent for AI processing again.

## Release order

The owner explicitly approved the live database and website update on
2026-08-31. Supabase migration `20260831022650_case_review_corrections` and
processor version 3 were deployed. All 45 automated tests passed. A live
rollback-only transaction verified missing-information rejection, correction,
separate approval, actor recording, protected history, and non-member denial.
Before/after checksums confirmed all existing case details and document rows
were unchanged, and the test history rows were rolled back.

The local preview was inaccessible to the cloud browser. The final signed-in
form check on fake data remains necessary after the frontend is published.
These checks do not certify the complete production permission setup or
healthcare compliance.

1. Run `npm ci --ignore-scripts` and `npm test` with Node 24 or later.
2. Apply `review-corrections.sql` as one named Supabase migration. The schema
   has not yet existed before this release; do not run the script twice.
3. Deploy `process-document/index.ts` with `verify_jwt = true` and its existing
   user-auth wrapper. Do not change secrets or provider settings.
4. Publish the matching `index.html`, then verify the served contents.
5. Test Edit Details, Save Corrections, refresh, confirmation, and approval on
   a fake case. Existing tabs must refresh to use the updated controls.

Keep the schema and history on rollback. An older frontend lacks the new
confirmation fields, so its approval action will be blocked by the new guard;
prefer a forward fix. Do not remove validation or history to restore a button.

The CLI was not available in the working environment, so this reviewed SQL is
kept by descriptive name; the production migration service records its version.
No fabricated timestamp is used.

## Remaining release limitations

- Tests do not certify healthcare compliance, complete tenant isolation,
  retention/deletion policy, or a full audit system.
- Auth's leaked-password protection was disabled during preflight. It needs
  review before real patient use. The organizations table intentionally remains
  inaccessible through the client; this release adds no permissive policy.
- Broad existing table grants, rate/file limits, source-document viewing,
  clinician/administrator role separation, and history UI need separate review.
- Only fake patient data is approved for testing at this stage.
