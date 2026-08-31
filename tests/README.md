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
