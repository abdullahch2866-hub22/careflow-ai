# CareFlow billing activation

The repository contains the secure Lemon Squeezy checkout and webhook foundation. Keep it in test mode until the store is approved and a complete synthetic payment test passes.

## Owner-only setup

1. Create and activate a Lemon Squeezy store for the **CareFlow AI SaaS subscription**. Do not describe it as consulting or another service.
2. Complete identity verification and add the Turkish bank account inside Lemon Squeezy. Never put identity documents, bank details, or API keys in GitHub.
3. Create one monthly subscription product/variant for the paid pilot.
4. In Supabase Edge Function Secrets, set:
   - `LEMONSQUEEZY_API_KEY`
   - `LEMONSQUEEZY_STORE_ID`
   - `LEMONSQUEEZY_VARIANT_ID`
   - `LEMONSQUEEZY_WEBHOOK_SECRET`
   - `LEMONSQUEEZY_TEST_MODE=true`
5. Configure the webhook URL as:
   `https://qyrxexraolqyymyozrtl.supabase.co/functions/v1/billing-webhook`
6. Subscribe the webhook to subscription created, updated, cancelled, resumed, expired, paused, and unpaused events.
7. Run a synthetic test-mode checkout and verify one organization subscription row is created.
8. Only after the test passes, switch the Lemon Squeezy store and `LEMONSQUEEZY_TEST_MODE` to live mode.

Lemon Squeezy receives the customer's payment information. CareFlow stores only provider IDs, subscription status, and renewal dates.
