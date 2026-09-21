# CareFlow Paddle billing activation

The application uses Paddle Billing for the live **CareFlow AI Clinic Subscription** at **$99 USD per month**.

Public values used by the browser:

- Client-side token: `live_30378679accd73c018c6de9b176`
- Price ID: `pri_01m2gcpjxz4wqjft7z10zcz3zq`

The client-side token and price ID identify checkout configuration; they are not private API keys. Never place a Paddle API key, webhook secret, bank information, or identity document in the website or GitHub.

## Isolated Sandbox test

The hidden `?billing_test=sandbox` route is restricted server-side to the dedicated `careflow.test@example.com` admin account. It uses separate Paddle resources and does not replace the live checkout configuration:

- Sandbox client-side token: `test_fb2fffc73e4082c03cd98733a95`
- Sandbox product ID: `pro_01m2xtten2ynwnstyag55a6jdc`
- Sandbox price ID: `pri_01m2xtx7y26neywx40s3v3s5k3`
- Checkout function: `create-billing-checkout-sandbox`
- Webhook function: `billing-webhook-sandbox`
- Webhook secret name: `PADDLE_SANDBOX_WEBHOOK_SECRET`

The Sandbox webhook accepts only the Sandbox price and always records `test_mode = true`. The live webhook continues to accept only the live price and records live mode.

## Final owner setup

1. In Paddle, open **Developer tools → Notifications → New destination**.
2. Name it **CareFlow AI live billing**.
3. Enter this webhook URL:

   `https://qyrxexraolqyymyozrtl.supabase.co/functions/v1/billing-webhook`

4. Subscribe the destination to:
   - `subscription.created`
   - `subscription.activated`
   - `subscription.updated`
   - `subscription.trialing`
   - `subscription.past_due`
   - `subscription.paused`
   - `subscription.resumed`
   - `subscription.canceled`
5. Save the destination and copy its **Secret key**.
6. In Supabase, open **Edge Functions → Secrets** and add:
   - Name: `PADDLE_WEBHOOK_SECRET`
   - Value: the Paddle notification destination secret
7. Send a Paddle test notification and confirm it returns HTTP 200.
8. Sign in to CareFlow as a clinic admin and confirm that **Billing** can prepare
   checkout, but do not complete a live purchase during technical verification.
   Use the isolated Paddle Sandbox path for payment testing. A live purchase may
   be completed only after the owner explicitly approves the real charge.

CareFlow stores only Paddle customer, subscription and price identifiers, subscription status, renewal dates, and a short-lived one-time checkout reference. Paddle handles customers' payment details and applicable sales tax as Merchant of Record.
