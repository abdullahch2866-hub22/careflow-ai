import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "npm:@supabase/server@1.5.1";

const CHECKOUT_API = "https://api.lemonsqueezy.com/v1/checkouts";
const CAREFLOW_APP_URL = "https://abdullahch2866-hub22.github.io/careflow-ai/";

function digits(value: string | undefined) {
  return typeof value === "string" && /^[0-9]+$/.test(value) ? value : "";
}

function checkoutHostIsSafe(value: unknown) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname === "lemonsqueezy.com" || url.hostname.endsWith(".lemonsqueezy.com"));
  } catch (_) {
    return false;
  }
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

      const apiKey = Deno.env.get("LEMONSQUEEZY_API_KEY") || "";
      const storeId = digits(Deno.env.get("LEMONSQUEEZY_STORE_ID"));
      const variantId = digits(Deno.env.get("LEMONSQUEEZY_VARIANT_ID"));
      const testMode = (Deno.env.get("LEMONSQUEEZY_TEST_MODE") || "true").toLowerCase() !== "false";

      if (!apiKey || !storeId || !variantId) {
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
          { error: "This hospital already has a subscription record. Contact CareFlow before starting another checkout." },
          { status: 409 }
        );
      }

      const { data: reserved, error: reserveError } = await ctx.supabaseAdmin.rpc(
        "careflow_service_reserve_billing_checkout",
        { p_organization_id: membership.organization_id, p_user_id: actor.id }
      );
      if (reserveError) throw reserveError;
      if (reserved !== true) {
        return Response.json(
          { error: "Too many checkout requests. Wait 15 minutes and try again." },
          { status: 429 }
        );
      }

      const response = await fetch(CHECKOUT_API, {
        method: "POST",
        signal: AbortSignal.timeout(10000),
        headers: {
          Accept: "application/vnd.api+json",
          "Content-Type": "application/vnd.api+json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          data: {
            type: "checkouts",
            attributes: {
              product_options: {
                redirect_url: CAREFLOW_APP_URL + "#billing=success",
                enabled_variants: [Number(variantId)],
              },
              checkout_options: {
                embed: false,
                media: false,
                logo: true,
                desc: true,
                discount: true,
                subscription_preview: true,
                button_color: "#10988d",
              },
              checkout_data: {
                email: actor.email || "",
                custom: {
                  organization_id: membership.organization_id,
                  careflow_user_id: actor.id,
                },
              },
              test_mode: testMode,
              expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
            },
            relationships: {
              store: { data: { type: "stores", id: storeId } },
              variant: { data: { type: "variants", id: variantId } },
            },
          },
        }),
      });

      let providerBody: any = null;
      try { providerBody = await response.json(); } catch (_) { /* Report a generic provider error below. */ }

      const checkoutUrl = providerBody?.data?.attributes?.url;
      if (!response.ok || !checkoutHostIsSafe(checkoutUrl)) {
        console.error("Lemon Squeezy checkout creation failed", {
          status: response.status,
          request_id: response.headers.get("X-Request-ID"),
        });
        return Response.json({ error: "Secure checkout is temporarily unavailable." }, { status: 502 });
      }

      return Response.json({ success: true, checkout_url: checkoutUrl, test_mode: testMode });
    } catch (error) {
      console.error(error);
      return Response.json({ error: "Could not prepare secure checkout." }, { status: 500 });
    }
  }),
};
