# Saved-case regression checks

Run with Node.js 22 or later; no package installation is needed:

```sh
node --test tests/cases.test.mjs
```

The tests execute the real inline application script with a minimal DOM adapter
and a synthetic Supabase adapter. They cover case loading, explicit organization
filtering, plain-text filenames, selection, saved status after a fresh page,
failed and zero-row saves, empty/error states, session clearing, upload integration,
and repeated clicks. They do not prove browser layout, live API behavior, or RLS.

For a browser check with synthetic data and no live backend requests:

```sh
node tests/serve-fixture.mjs
```

Open `http://127.0.0.1:8765`. The orange fixture panel simulates failures, upload,
and sign-out. Confirm review details belong to the selected case, approve and
request correction, then refresh and reopen the case. Action labels should remain
unchanged. The filename containing HTML must appear as text. The other hospital's
synthetic case must not appear. The server replaces the CDN SDK with the mock and
blocks outbound connections through CSP.

These fixtures never use live credentials or patient data. The production page
does not import any files from `tests/`.

## Document processor access checks

Run all checks with Node.js 24 or later (the database tests use pinned PGlite):

```sh
npm ci --ignore-scripts
npm test
```

`processor-access.test.mjs` runs the actual TypeScript handler after stripping
types, with synthetic user-scoped clients and a stubbed AI response. It checks
successful processing, foreign folder rejection, invalid paths, Storage denial,
inaccessible records, access removed before saving, zero-row saves, and input
validation. It throws if the handler tries to use the administrator client.
No actual JWT verification, Deno deployment, Storage HTTP call, or AI call occurs
in these tests; the deployed handler still needs a fake-PDF end-to-end check.

## Correction and approval checks

`review-database.test.mjs` executes `supabase/review-corrections.sql` in a real
in-memory PostgreSQL engine with synthetic tables and identities. It tests
database approval constraints, separate save/approve steps, preserved prior
values, immutable history, actor stamping, optimistic revisions, and RLS for
two synthetic hospitals. It does not validate the production JWT verifier or
the complete production permission configuration.

The frontend tests additionally cover correction persistence, required notes
and confirmation, partial corrections, failed/stale saves, cancellation, and
clearing drafts on sign-out. Use the browser fixture to inspect the form and
compare visible saved values after a refresh. All fixture data is fictional.

## PDF upload protection

Browser tests use File/Blob objects and
cover type/size checks, obvious renamed and truncated PDFs, the exact 10 MB
boundary, MIME normalization, opaque storage paths, sign-out during validation,
and preserving open correction drafts. Processor tests cover Storage info
denial, invalid/oversized metadata, the downloaded size, and header/EOF checks
before AI calls. The PDF envelopes in these tests are synthetic, not a full
PDF parser test corpus. See `supabase/upload-protection.md` for scope and the
separate Storage configuration requirement.
