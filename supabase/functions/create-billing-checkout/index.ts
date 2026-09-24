import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "npm:@supabase/server@1.5.1";

const PADDLE_PRICE_ID = "pri_01m2gcpjxz4wqjft7z10zcz3zq";
const CONTROLLED_LIVE_TEST_ENABLED = true;
const LIVE_TEST_USER_ID = "91943cf3-7e02-4b61-9efe-345bb9b2262a";
const LIVE_TEST_ORGANIZATION_ID = "b9c0bcab-31f1-4d59-bfa9-e9be88153edf";

function isUuid(value: unknown) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    try {
      const { data: userData, error: userError } = await ctx.supabase.auth.getUser();
      const actor = userData?.user;
      if (userError || !actor) {
        return Response.json({ error: "Authentication required" }, { status: 401 });
      }

      const { data: membership, error: membershipError } = await ctx.supabase
        .from("organization_members")
        .select("organization_id, role")
        .eq("user_id", actor.id)
        .single();

      if (membershipError || !membership) {
        return Response.json({ error: "Hospital membership not found" }, { status: 403 });
      }
      if (membership.role !== "admin") {
        return Response.json({ error: "Only hospital admins can manage billing" }, { status: 403 });
      }

      if (!CONTROLLED_LIVE_TEST_ENABLED) {
        return Response.json(
          { error: "Live checkout is waiting for Paddle verification and domain approval." },
          { status: 503 }
        );
      }
      if (actor.id !== LIVE_TEST_USER_ID || membership.organization_id !== LIVE_TEST_ORGANIZATION_ID) {
        return Response.json(
          { error: "Live checkout is temporarily restricted to the designated CareFlow test workspace." },
          { status: 403 }
        );
      }

      if (!Deno.env.get("PADDLE_WEBHOOK_SECRET")) {
        return Response.json(
          { error: "Secure payments are being activated. Please try again later." },
          { status: 503 }
        );
      }

      const { data: subscription, error: subscriptionError } = await ctx.supabase
        .from("organization_subscriptions")
        .select("status, ends_at")
        .eq("organization_id", membership.organization_id)
        .maybeSingle();

      if (subscriptionError) throw subscriptionError;
      if (subscription && subscription.status !== "expired") {
        return Response.json(
          { error: "This hospital already has a subscription. Contact CareFlow before starting another checkout." },
          { status: 409 }
        );
      }

      const { data: checkoutReference, error: checkoutError } = await ctx.supabaseAdmin.rpc(
        "careflow_service_prepare_billing_checkout",
        {
          p_organization_id: membership.organization_id,
          p_user_id: actor.id,
          p_price_id: PADDLE_PRICE_ID,
        }
      );

      if (checkoutError) throw checkoutError;
      if (!isUuid(checkoutReference)) {
        return Response.json(
          { error: "Too many checkout requests. Wait 15 minutes and try again." },
          { status: 429 }
        );
      }

      return Response.json({
        success: true,
        checkout_reference: checkoutReference,
        price_id: PADDLE_PRICE_ID,
        customer_email: typeof actor.email === "string" ? actor.email : "",
      });
    } catch (error) {
      console.error("Paddle checkout preparation failed", {
        message: error instanceof Error ? error.message : "Unknown error",
      });
      return Response.json({ error: "Could not prepare secure checkout." }, { status: 500 });
    }
  }),
};
