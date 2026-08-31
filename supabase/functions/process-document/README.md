# Document processor

This directory tracks the Supabase Edge Function called by the existing frontend.
The previous version is preserved in the parent commit for rollback.

Deployment must keep the function name `process-document`, entrypoint `index.ts`,
and `verify_jwt = true`. Keep the existing `auth: "user"` wrapper. Existing
environment variables are managed in Supabase and must never be committed here.
The original access-hardening patch changed no database or storage policies.
The correction release additionally requires the additive schema described in
`../../review-corrections.md` before deploying the matching function/frontend.

The handler now uses the signed-in user's Supabase client for both downloading
the PDF and saving extraction results. It checks the document's hospital folder
before accessing the file, and confirms one case was updated before returning
the extracted data. Storage RLS remains the authoritative file-access check.

After an approved deployment, use a fake PDF to verify upload, AI extraction,
saved review details, and status changes. Do not test with real patient data.
The full release still needs broader permission, audit, retention, upload-limit,
account-security, and healthcare compliance review.

The processor now reads the case revision before processing. Existing saved
results or review decisions cannot be processed again; reviewers use Edit
Details instead. The final write must match the original revision so delayed
AI results cannot overwrite a correction made while processing was in flight.
