import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const MAX_WEBHOOK_BYTES = 1024 * 1024;
const SIGNATURE_TOLERANCE_SECONDS = 300;
const PADDLE_PRICE_ID = "pri_01m2gcpjxz4wqjft7z10zcz3zq";
const SUPPORTED_EVENTS = new Set([
  "subscription.created",
  "subscription.activated",
  "subscription.updated",
  "subscription.trialing",
  "subscription.past_due",
  "subscription.paused",
  "subscription.resumed",
  "subscription.canceled",
]);
const PADDLE_STATUSES = new Set(["active", "canceled", "past_due", "paused", "trialing"]);

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

function parsePaddleSignature(value: string) {
  let timestamp = "";
  const signatures: string[] = [];
  for (const part of value.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const item = part.slice(separator + 1).trim().toLowerCase();
    if (key === "ts" && /^[0-9]+$/.test(item)) timestamp = item;
    if (key === "h1" && /^[0-9a-f]{64}$/.test(item)) signatures.push(item);
  }
  return { timestamp, signatures };
}

function paddleId(value: unknown, prefix: "evt" | "ctm" | "sub" | "pri") {
  return typeof value === "string" && new RegExp(`^${prefix}_[a-z0-9]{26}$`).test(value) ? value : "";
}

function isUuid(value: unknown) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function timestampOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new Error("Invalid timestamp");
  return new Date(value).toISOString();
}

function internalStatus(value: string) {
  const statusByPaddleStatus: Record<string, string> = {
    active: "active",
    canceled: "expired",
    past_due: "past_due",
    paused: "paused",
    trialing: "on_trial",
  };
  return statusByPaddleStatus[value] || "";
}

function safeName(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : fallback;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const secret = Deno.env.get("PADDLE_WEBHOOK_SECRET") || "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const testMode = (Deno.env.get("PADDLE_ENVIRONMENT") || "live").toLowerCase() === "sandbox";
  if (!secret || !supabaseUrl || !serviceRoleKey) {
    console.error("Paddle billing webhook is not configured");
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

  const { timestamp, signatures } = parsePaddleSignature(req.headers.get("Paddle-Signature") || "");
  const timestampNumber = Number(timestamp);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(timestampNumber) || timestampNumber <= 0 || signatures.length === 0 ||
      Math.abs(nowSeconds - timestampNumber) > SIGNATURE_TOLERANCE_SECONDS) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  const expectedSignature = await hmacSha256Hex(secret, `${timestamp}:${rawBody}`);
  if (!signatures.some(signature => constantTimeEqual(signature, expectedSignature))) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch (_) {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = payload?.event_type;
  if (typeof eventType !== "string" || !SUPPORTED_EVENTS.has(eventType)) {
    return Response.json({ received: true, ignored: true });
  }

  const eventId = paddleId(payload?.event_id, "evt");
  const data = payload?.data;
  const subscriptionId = paddleId(data?.id, "sub");
  const customerId = paddleId(data?.customer_id, "ctm");
  const paddleStatus = data?.status;
  if (!eventId || !subscriptionId || !customerId || !PADDLE_STATUSES.has(paddleStatus)) {
    return Response.json({ error: "Invalid subscription event" }, { status: 400 });
  }

  const matchingItem = Array.isArray(data?.items)
    ? data.items.find((item: any) => paddleId(item?.price?.id, "pri") === PADDLE_PRICE_ID)
    : null;
  if (!matchingItem) {
    return Response.json({ received: true, ignored: true });
  }

  const customReference = data?.custom_data?.careflow_checkout_reference;
  const checkoutReference = isUuid(customReference) ? customReference : null;
  let renewsAt: string | null;
  let endsAt: string | null;
  let providerUpdatedAt: string | null;
  try {
    renewsAt = timestampOrNull(data?.next_billed_at);
    const scheduledCancellation = data?.scheduled_change?.action === "cancel"
      ? data?.scheduled_change?.effective_at
      : null;
    endsAt = timestampOrNull(
      scheduledCancellation ||
      (paddleStatus === "canceled" ? data?.canceled_at || data?.current_billing_period?.ends_at : null)
    );
    providerUpdatedAt = timestampOrNull(data?.updated_at || payload?.occurred_at);
  } catch (_) {
    return Response.json({ error: "Invalid subscription timestamp" }, { status: 400 });
  }
  if (!providerUpdatedAt) {
    return Response.json({ error: "Missing subscription timestamp" }, { status: 400 });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: result, error } = await supabaseAdmin.rpc("careflow_service_apply_paddle_event", {
    p_event_id: eventId,
    p_event_name: eventType,
    p_checkout_reference: checkoutReference,
    p_customer_id: customerId,
    p_subscription_id: subscriptionId,
    p_price_id: PADDLE_PRICE_ID,
    p_product_name: safeName(matchingItem?.product?.name, "CareFlow AI Clinic Subscription"),
    p_price_name: safeName(matchingItem?.price?.name || matchingItem?.price?.description, "Monthly"),
    p_status: internalStatus(paddleStatus),
    p_renews_at: renewsAt,
    p_ends_at: endsAt,
    p_provider_updated_at: providerUpdatedAt,
    p_test_mode: testMode,
  });

  if (error) {
    console.error("Paddle webhook database update failed", { code: error.code });
    return Response.json({ error: "Could not record billing event" }, { status: 500 });
  }

  return Response.json({ received: true, result });
});
