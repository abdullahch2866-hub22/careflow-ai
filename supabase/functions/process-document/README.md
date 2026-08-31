# Document processor

This directory tracks the Supabase Edge Function called by the existing frontend.
The previous version is preserved in the parent commit for rollback.

Deployment must keep the function name `process-document`, entrypoint `index.ts`,
and `verify_jwt = true`. Keep the existing `auth: "user"` wrapper. Existing
environment variables are managed in Supabase and must never be committed here.
No database or storage policy changes are part of this patch.

The handler now uses the signed-in user's Supabase client for both downloading
the PDF and saving extraction results. It checks the document's hospital folder
before accessing the file, and confirms one case was updated before returning
the extracted data. Storage RLS remains the authoritative file-access check.

After an approved deployment, use a fake PDF to verify upload, AI extraction,
saved review details, and status changes. Do not test with real patient data.
The full release still needs broader permission, audit, retention, upload-limit,
account-security, and healthcare compliance review.
