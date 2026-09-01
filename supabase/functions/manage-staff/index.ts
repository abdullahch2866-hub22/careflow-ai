import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "npm:@supabase/server@1.5.1";

interface ManageStaffPayload {
  action: "invite" | "change_role" | "remove";
  email: string;
  role?: "admin" | "staff";
}

const ALLOWED_ROLES = new Set(["admin", "staff"]);
const CAREFLOW_APP_URL = "https://abdullahch2866-hub22.github.io/careflow-ai/";

function normalizeEmail(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function validEmail(email: string) {
  return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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

      const { data: actorMembership, error: membershipError } = await ctx.supabase
        .from("organization_members")
        .select("organization_id, role")
        .eq("user_id", actor.id)
        .single();

      if (membershipError || !actorMembership) {
        return Response.json({ error: "Hospital membership not found" }, { status: 403 });
      }
      if (actorMembership.role !== "admin") {
        return Response.json({ error: "Only hospital admins can manage staff" }, { status: 403 });
      }

      let body: ManageStaffPayload;
      try {
        body = (await req.json()) as ManageStaffPayload;
      } catch (_) {
        return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
      }
      const action = body?.action;
      const email = normalizeEmail(body?.email);
      const role = body?.role;

      if (!validEmail(email)) {
        return Response.json({ error: "Enter a valid email address" }, { status: 400 });
      }
      if (!new Set(["invite", "change_role", "remove"]).has(action)) {
        return Response.json({ error: "Invalid staff action" }, { status: 400 });
      }
      if ((action === "invite" || action === "change_role") && !ALLOWED_ROLES.has(role || "")) {
        return Response.json({ error: "Role must be admin or staff" }, { status: 400 });
      }

      const findAuthUser = async () => {
        const { data, error } = await ctx.supabaseAdmin.rpc("careflow_service_find_auth_user", { p_email: email });
        if (error) throw error;
        const row = Array.isArray(data) ? data[0] : data;
        return row || null;
      };

      const findHospitalMember = async () => {
        const { data, error } = await ctx.supabaseAdmin.rpc("careflow_service_find_member", {
          p_actor_user_id: actor.id,
          p_email: email,
        });
        if (error) throw error;
        const row = Array.isArray(data) ? data[0] : data;
        return row || null;
      };

      if (action === "invite") {
        let target = await findAuthUser();
        let createdByInvite = false;

        if (target) {
          const { data: existingMembership, error: existingMembershipError } = await ctx.supabaseAdmin
            .from("organization_members")
            .select("organization_id, role")
            .eq("user_id", target.user_id)
            .maybeSingle();

          if (existingMembershipError) throw existingMembershipError;
          if (existingMembership) {
            const sameHospital = existingMembership.organization_id === actorMembership.organization_id;
            return Response.json(
              { error: sameHospital ? "This user is already a member of your hospital" : "This email cannot be added to your hospital" },
              { status: 409 }
            );
          }
        } else {
          const { data: inviteData, error: inviteError } = await ctx.supabaseAdmin.auth.admin.inviteUserByEmail(email, {
            redirectTo: CAREFLOW_APP_URL,
            data: { careflow_invited_role: role, careflow_invited_organization: actorMembership.organization_id },
          });
          if (inviteError || !inviteData?.user) {
            return Response.json({ error: inviteError?.message || "Could not send invitation" }, { status: 400 });
          }
          target = { user_id: inviteData.user.id, email: inviteData.user.email || email };
          createdByInvite = true;
        }

        const { error: addError } = await ctx.supabaseAdmin.rpc("careflow_service_add_member", {
          p_actor_user_id: actor.id,
          p_target_user_id: target.user_id,
          p_target_email: email,
          p_role: role,
        });

        if (addError) {
          if (createdByInvite) {
            try { await ctx.supabaseAdmin.auth.admin.deleteUser(target.user_id); } catch (_) { /* best-effort cleanup */ }
          }
          return Response.json({ error: addError.message || "Could not add this user" }, { status: 409 });
        }

        return Response.json({
          success: true,
          action,
          email,
          role,
          message: "Staff access prepared. A secure invitation is sent when the email is new to CareFlow."
        });
      }

      const target = await findHospitalMember();
      if (!target) {
        return Response.json({ error: "User is not a member of this hospital" }, { status: 404 });
      }
      if (target.user_id === actor.id) {
        return Response.json(
          { error: action === "remove" ? "You cannot remove your own account" : "You cannot change your own role" },
          { status: 400 }
        );
      }

      if (action === "change_role") {
        const { error } = await ctx.supabaseAdmin.rpc("careflow_service_change_member_role", {
          p_actor_user_id: actor.id,
          p_target_user_id: target.user_id,
          p_target_email: email,
          p_new_role: role,
        });
        if (error) {
          return Response.json({ error: error.message || "Could not change this role" }, { status: 409 });
        }
        return Response.json({ success: true, action, email, role, message: "Role updated." });
      }

      const { error } = await ctx.supabaseAdmin.rpc("careflow_service_remove_member", {
        p_actor_user_id: actor.id,
        p_target_user_id: target.user_id,
        p_target_email: email,
      });
      if (error) {
        return Response.json({ error: error.message || "Could not remove this user" }, { status: 409 });
      }

      return Response.json({
        success: true,
        action,
        email,
        message: "User removed from this hospital. Their CareFlow sign-in account was not deleted."
      });
    } catch (error) {
      console.error(error);
      return Response.json(
        { error: error instanceof Error ? error.message : "Unknown staff-management error" },
        { status: 500 }
      );
    }
  }),
};
