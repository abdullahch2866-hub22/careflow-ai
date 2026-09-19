import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "npm:@supabase/server@1.5.1";

const PADDLE_PRICE_ID = "pri_01m2xtx7y26neywx40s3v3s5k3";
const SANDBOX_TEST_USER_ID = "5ebb6f53-f8b6-464d-af65-c19fa3a28e85";
const SANDBOX_TEST_EMAIL = "careflow.test@example.com";

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
      if (actor.id !== SANDBOX_TEST_USER_ID || actor.email !== SANDBOX_TEST_EMAIL) {
        return Response.json({ error: "Sandbox billing is restricted to the CareFlow test account" }, { status: 403 });
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

      if (!Deno.env.get("PADDLE_SANDBOX_WEBHOOK_SECRET")) {
        return Response.json(
          { error: "Sandbox payments are being activated. Please try again later." },
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
          { error: "This test hospital already has a subscription." },
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
        environment: "sandbox",
        checkout_reference: checkoutReference,
        price_id: PADDLE_PRICE_ID,
        customer_email: actor.email,
      });
    } catch (error) {
      console.error("Paddle sandbox checkout preparation failed", {
        message: error instanceof Error ? error.message : "Unknown error",
      });
      return Response.json({ error: "Could not prepare the Sandbox checkout." }, { status: 500 });
    }
  }),
};
