import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "npm:@supabase/server@^1";

interface ViewDocumentPayload {
  document_id: string;
  case_id: number;
}

const SIGNED_URL_SECONDS = 300;

function isUuid(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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

      const body = (await req.json()) as ViewDocumentPayload;
      const documentId = body?.document_id;
      const caseId = Number(body?.case_id);

      if (!isUuid(documentId) || !Number.isSafeInteger(caseId) || caseId <= 0) {
        return Response.json({ error: "A valid case and document are required" }, { status: 400 });
      }

      const { data: caseRow, error: caseError } = await ctx.supabase
        .from("cases")
        .select("id, organization_id, document_id")
        .eq("id", caseId)
        .eq("document_id", documentId)
        .single();

      if (caseError || !caseRow) {
        return Response.json({ error: "Document not found or access denied" }, { status: 404 });
      }

      const { data: documentRow, error: documentError } = await ctx.supabase
        .from("documents")
        .select("id, organization_id, file_name, storage_path")
        .eq("id", documentId)
        .eq("organization_id", caseRow.organization_id)
        .single();

      if (documentError || !documentRow?.storage_path) {
        return Response.json({ error: "Document not found or access denied" }, { status: 404 });
      }

      const expectedPrefix = `${caseRow.organization_id}/`;
      if (!documentRow.storage_path.startsWith(expectedPrefix)) {
        console.error("Storage path organization mismatch", {
          document_id: documentId,
          organization_id: caseRow.organization_id,
        });
        return Response.json({ error: "Document storage path is invalid" }, { status: 500 });
      }

      const { data: membership, error: membershipError } = await ctx.supabase
        .from("organization_members")
        .select("organization_id")
        .eq("user_id", actor.id)
        .eq("organization_id", caseRow.organization_id)
        .single();

      if (membershipError || !membership) {
        return Response.json({ error: "Hospital access is no longer available" }, { status: 403 });
      }

      const { data: signed, error: signedError } = await ctx.supabaseAdmin.storage
        .from("documents")
        .createSignedUrl(documentRow.storage_path, SIGNED_URL_SECONDS);

      if (signedError || !signed?.signedUrl) {
        return Response.json({ error: "Could not create secure document link" }, { status: 500 });
      }

      const { error: auditError } = await ctx.supabaseAdmin
        .from("document_access_audit")
        .insert({
          organization_id: caseRow.organization_id,
          user_id: actor.id,
          user_email: actor.email || null,
          case_id: caseRow.id,
          document_id: documentRow.id,
          access_type: "view",
        });

      if (auditError) {
        console.error("Document access audit insert failed", auditError);
        return Response.json({ error: "Could not record document access" }, { status: 500 });
      }

      return Response.json({
        success: true,
        signed_url: signed.signedUrl,
        expires_in: SIGNED_URL_SECONDS,
        file_name: documentRow.file_name,
      });
    } catch (error) {
      console.error(error);
      return Response.json(
        { error: error instanceof Error ? error.message : "Unknown document-view error" },
        { status: 500 }
      );
    }
  }),
};
