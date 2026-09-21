# CareFlow AI production-readiness record

Audit date: 2026-09-21

This record separates technical availability from approval to process real
patient information. It contains no patient data, secrets, or billing details.

## Current safe launch lane

CareFlow may be demonstrated, marketed, and tested with fictional documents.
The public $99/month Paddle plan, checkout preparation, signed webhooks, and
isolated Sandbox path are connected. A real live checkout creates a real charge
and must never be completed as a technical test without explicit owner approval.

Real patient information is not approved during the current Free-plan beta.
Before accepting it, CareFlow needs an appropriate production Supabase plan,
verified off-site encrypted database and private-Storage backups, and a legal and
healthcare privacy review for the countries and customers involved.

## Verified controls

- All 109 baseline automated tests passed before readiness changes; all 113
  tests passed after the new safeguards were added.
- Hospital-scoped database access, private document viewing, strong password
  rules, upload quotas, processing retries, human review, and audit history have
  automated regression coverage.
- Live and Sandbox Paddle resources are isolated by separate tokens, price IDs,
  functions, secrets, and database `test_mode` values.
- Paddle webhook signatures are verified before JSON parsing; replay, stale
  update, wrong-price, oversized-body, and simulation-event paths are guarded.
- The live project reports no stuck processing, recent processing failures, or
  missing source objects.
- No committed private API keys, webhook secrets, bank details, or patient
  documents were found.

## Open items that were not changed

- Supabase leaked-password protection is unavailable on the current Free plan.
  No upgrade was made.
- Four small orphan Storage objects and three legacy document rows remain from
  old testing. They appear non-operational, but no data was deleted.
- The latest health snapshot remains `watch` because the orphan counter is
  intentionally honest. Monitoring was not weakened to force a green status.
- Billing is connected but is not yet an entitlement gate for every workspace
  action. Trial/pilot access policy must be decided before enforcing a payment
  lock, so no customer was locked out during this audit.
- Production data retention, malware scanning, contractual terms, incident
  ownership, and customer-specific compliance obligations still require a
  business/legal decision rather than an automatic code change.

## Repeatable verification

1. Run `npm ci --ignore-scripts` and `npm test` with Node.js 24 or later.
2. Run `supabase/production-readiness-audit.sql` in the Supabase SQL editor.
   It is read-only and returns aggregate health and permission metadata.
3. Use the isolated Sandbox account for a payment rehearsal.
4. Use only fictional PDFs for upload, processing, review, and retry checks.
5. Review any orphan or legacy records individually. Deletion requires a
   separate, explicit approval and a recoverable backup plan.

## Launch decision

- **Marketing and fictional-data pilots:** technically ready.
- **Live Paddle sale:** technically connected; perform only as a deliberate
  customer purchase, never as a free verification click.
- **Real patient-data production:** not yet approved because backup, plan, and
  compliance work remains.
