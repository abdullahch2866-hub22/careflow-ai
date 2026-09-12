import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const MAX_WEBHOOK_BYTES = 1024 * 1024;
const SUPPORTED_EVENTS = new Set([
  "subscription_created",
  "subscription_updated",
  "subscription_cancelled",
  "subscription_resumed",
  "subscription_expired",
  "subscription_paused",
  "subscription_unpaused",
]);
const SUBSCRIPTION_STATUSES = new Set([
  "on_trial", "active", "paused", "past_due", "unpaid", "cancelled", "expired",
]);

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function hmacSha256Hex(secret: string, body: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(body)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(body: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

function isUuid(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function numericId(value: unknown) {
  const normalized = typeof value === "number" ? String(value) : value;
  return typeof normalized === "string" && /^[0-9]+$/.test(normalized) ? normalized : "";
}

function timestampOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new Error("Invalid timestamp");
  return new Date(value).toISOString();
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const secret = Deno.env.get("LEMONSQUEEZY_WEBHOOK_SECRET") || "";
  const expectedStoreId = numericId(Deno.env.get("LEMONSQUEEZY_STORE_ID"));
  const expectedTestMode = (Deno.env.get("LEMONSQUEEZY_TEST_MODE") || "true").toLowerCase() !== "false";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  if (!secret || !expectedStoreId || !supabaseUrl || !serviceRoleKey) {
    console.error("Billing webhook is not configured");
    return Response.json({ error: "Webhook unavailable" }, { status: 503 });
  }

  const contentLength = Number(req.headers.get("Content-Length") || "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BYTES) {
    return Response.json({ error: "Payload too large" }, { status: 413 });
  }

  const rawBody = await req.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_WEBHOOK_BYTES) {
    return Response.json({ error: "Payload too large" }, { status: 413 });
  }

  const suppliedSignature = (req.headers.get("X-Signature") || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(suppliedSignature)) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }
  const expectedSignature = await hmacSha256Hex(secret, rawBody);
  if (!constantTimeEqual(suppliedSignature, expectedSignature)) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: any;
  try { payload = JSON.parse(rawBody); } catch (_) {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const headerEvent = req.headers.get("X-Event-Name") || "";
  const eventName = payload?.meta?.event_name;
  if (typeof eventName !== "string" || eventName !== headerEvent) {
    return Response.json({ error: "Event name mismatch" }, { status: 400 });
  }
  if (!SUPPORTED_EVENTS.has(eventName)) {
    return Response.json({ received: true, ignored: true });
  }

  const attributes = payload?.data?.attributes;
  const organizationId = payload?.meta?.custom_data?.organization_id;
  const subscriptionId = numericId(payload?.data?.id);
  const storeId = numericId(attributes?.store_id);
  const customerId = numericId(attributes?.customer_id);
  const variantId = numericId(attributes?.variant_id);
  const status = attributes?.status;
  const testMode = attributes?.test_mode;

  if (payload?.data?.type !== "subscriptions" || !isUuid(organizationId) ||
      !subscriptionId || !storeId || !customerId || !variantId ||
      !SUBSCRIPTION_STATUSES.has(status) || storeId !== expectedStoreId ||
      typeof testMode !== "boolean" ||
      testMode !== expectedTestMode) {
    return Response.json({ error: "Invalid subscription event" }, { status: 400 });
  }

  let renewsAt: string | null;
  let endsAt: string | null;
  let providerUpdatedAt: string | null;
  try {
    renewsAt = timestampOrNull(attributes?.renews_at);
    endsAt = timestampOrNull(attributes?.ends_at);
    providerUpdatedAt = timestampOrNull(attributes?.updated_at);
  } catch (_) {
    return Response.json({ error: "Invalid subscription timestamp" }, { status: 400 });
  }
  if (!providerUpdatedAt) {
    return Response.json({ error: "Missing subscription timestamp" }, { status: 400 });
  }

  const eventId = `${eventName}:${await sha256Hex(rawBody)}`;
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabaseAdmin.rpc("careflow_service_apply_billing_event", {
    p_event_id: eventId,
    p_event_name: eventName,
    p_organization_id: organizationId,
    p_store_id: storeId,
    p_customer_id: customerId,
    p_subscription_id: subscriptionId,
    p_variant_id: variantId,
    p_product_name: typeof attributes?.product_name === "string" ? attributes.product_name : "",
    p_variant_name: typeof attributes?.variant_name === "string" ? attributes.variant_name : "",
    p_status: status,
    p_renews_at: renewsAt,
    p_ends_at: endsAt,
    p_provider_updated_at: providerUpdatedAt,
    p_test_mode: testMode,
  });

  if (error) {
    console.error("Billing webhook database update failed", { code: error.code });
    return Response.json({ error: "Could not record billing event" }, { status: 500 });
  }

  return Response.json({ received: true, result: data });
});
