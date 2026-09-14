# CareFlow Paddle billing activation

The application uses Paddle Billing for the live **CareFlow AI Clinic Subscription** at **$99 USD per month**.

Public values used by the browser:

- Client-side token: `live_30378679accd73c018c6de9b176`
- Price ID: `pri_01m2gcpjxz4wqjft7z10zcz3zq`

The client-side token and price ID identify checkout configuration; they are not private API keys. Never place a Paddle API key, webhook secret, bank information, or identity document in the website or GitHub.

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
8. Sign in to CareFlow as a clinic admin, open **Billing**, and run one controlled live checkout.

CareFlow stores only Paddle customer, subscription and price identifiers, subscription status, renewal dates, and a short-lived one-time checkout reference. Paddle handles customers' payment details and applicable sales tax as Merchant of Record.
