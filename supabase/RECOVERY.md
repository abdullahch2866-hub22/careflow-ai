# CareFlow AI recovery plan

This plan is intentionally honest about the current Free-plan beta. It does
not claim that source PDFs are backed up when they are not.

## What is protected now

- Application code, database changes, and recovery instructions are versioned
  in GitHub.
- The database records case history, processing attempts, review corrections,
  source-document access, staff changes, and private hourly health snapshots.
- Every ten minutes, a private scheduled job safely converts processing runs
  stuck for more than 15 minutes into retryable failures. It never overwrites a
  reviewed or completed result.
- Every hour, CareFlow records PHI-free counts for database size, cases,
  documents, Storage objects, processing failures, missing source objects, and
  orphaned uploads.
- Expired upload reservations are kept for seven days, health snapshots for 90
  days, and then removed automatically.

## Current backup boundary

The Supabase organization is on the Free plan. Supabase recommends regular
off-site logical exports for Free projects; accessible scheduled backups and
Point-in-Time Recovery are paid production features. Database backups also do
not include the PDF bytes stored through the Storage API.

Therefore, use fictional data only during this beta. Before onboarding a real
hospital, CareFlow must move to a paid production plan and add a separate,
encrypted backup destination for the private `documents` bucket. Never store
patient PDFs in GitHub or ordinary unencrypted CI artifacts.

## Incident order

1. Stop uploads and processing if the incident could change or expose data.
2. Record the time, affected hospital, affected case IDs, and observed error.
   Do not copy patient fields into tickets or chat.
3. Check Supabase project health, Logs, Reports, Cron job runs, and the latest
   row in `careflow_private.operational_health_snapshots`.
4. For a stuck AI run, allow the scheduled recovery to mark it retryable, then
   retry the same case. Never create a duplicate case.
5. For a database restore, choose the last verified recovery point before the
   incident. Expect downtime and re-test authentication, RLS, Edge Functions,
   Cron jobs, and Case #13 afterward.
6. For a missing Storage object, do not manufacture a replacement or delete
   its database history. Restore the encrypted source copy when production
   Storage backups exist; otherwise record the loss and require an authorized
   re-upload.

## Recovery verification checklist

- Hospital A cannot access Hospital B.
- Existing reviewed values and correction history remain unchanged.
- Source PDFs open only through the secure viewer.
- A fake PDF completes upload, processing, review, correction, and approval.
- A failed AI call keeps one case and allows a safe retry.
- Scheduled health and recovery jobs report successful runs.
- No synthetic users, cases, documents, reservations, or Storage objects remain.
