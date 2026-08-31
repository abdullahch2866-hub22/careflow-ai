import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "npm:@supabase/server@^1";

interface ReqPayload {
  document_id: string;
}

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
    );
  }

  return btoa(binary);
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    try {
      const body = (await req.json()) as ReqPayload;
      const document_id = body.document_id;

      if (typeof document_id !== "string" || !document_id.trim()) {
        return Response.json(
          { error: "document_id is required" },
          { status: 400 }
        );
      }

      const openaiApiKey = Deno.env.get("OPENAI_API_KEY");

      if (!openaiApiKey) {
        return Response.json(
          { error: "OPENAI_API_KEY is not configured" },
          { status: 500 }
        );
      }

      // Check that the logged-in hospital user is allowed
      // to access this case through Row Level Security.
      const { data: caseRow, error: caseError } = await ctx.supabase
        .from("cases")
        .select("id, organization_id, document_id, review_revision, review_notes, status, patient_name, document_date, insurance_information, missing_information")
        .eq("document_id", document_id)
        .single();

      if (caseError || !caseRow) {
        return Response.json(
          { error: "Case not found or access denied" },
          { status: 404 }
        );
      }

      if (caseRow.review_revision !== 0 || caseRow.status !== "Review" || caseRow.review_notes ||
          caseRow.patient_name || caseRow.document_date || caseRow.insurance_information || caseRow.missing_information) {
        return Response.json(
          { error: "This case already has saved results or review decisions. Use Edit Details to make corrections." },
          { status: 409 }
        );
      }

      // Get the matching document through the logged-in user's RLS.
      const { data: documentRow, error: documentError } =
        await ctx.supabase
          .from("documents")
          .select("id, file_name, storage_path, organization_id")
          .eq("id", document_id)
          .eq("organization_id", caseRow.organization_id)
          .single();

      if (documentError || !documentRow) {
        return Response.json(
          { error: "Document not found or access denied" },
          { status: 404 }
        );
      }

      if (typeof documentRow.storage_path !== "string" || !documentRow.storage_path) {
        return Response.json(
          { error: "Document storage path is missing" },
          { status: 400 }
        );
      }

      // A document record is not proof of access to the file named in it.
      // Require the hospital folder, and let Storage enforce the caller's RLS.
      const pathSegments = documentRow.storage_path.split("/");
      if (
        pathSegments[0] !== documentRow.organization_id ||
        pathSegments.length < 2 ||
        pathSegments.slice(1).some((segment: string) =>
          !segment || segment === "." || segment === ".."
        ) ||
        documentRow.storage_path.includes("\\")
      ) {
        return Response.json(
          { error: "Document file not found or access denied" },
          { status: 404 }
        );
      }

      if (typeof documentRow.file_name !== "string" || !/\.pdf$/i.test(documentRow.file_name)) {
        return Response.json({ error: "Only PDF documents can be processed." }, { status: 415 });
      }

      // Inspect actual Storage metadata with the same user's RLS before downloading.
      const { data: fileInfo, error: infoError } = await ctx.supabase.storage
        .from("documents").info(documentRow.storage_path);
      if (infoError || !fileInfo) {
        return Response.json({ error: "Document file not found or access denied" }, { status: 404 });
      }
      if (!Number.isSafeInteger(fileInfo.size) || fileInfo.size <= 0) {
        return Response.json({ error: "The stored PDF is empty or has invalid size information." }, { status: 415 });
      }
      if (fileInfo.size > MAX_DOCUMENT_BYTES) {
        return Response.json({ error: "PDF files must be no larger than 10 MB." }, { status: 413 });
      }

      const { data: fileBlob, error: downloadError } =
        await ctx.supabase.storage
          .from("documents")
          .download(documentRow.storage_path);

      if (downloadError || !fileBlob) {
        return Response.json(
          {
            error: "Document file not found or access denied",
          },
          { status: 404 }
        );
      }

      // Recheck the downloaded bytes too; metadata and extension alone are not proof.
      if (fileBlob.size > MAX_DOCUMENT_BYTES) {
        return Response.json({ error: "PDF files must be no larger than 10 MB." }, { status: 413 });
      }
      const header = await fileBlob.slice(0, 8).text();
      const ending = await fileBlob.slice(Math.max(0, fileBlob.size - 1024)).text();
      if (!fileBlob.size || !/^%PDF-[12]\.\d$/.test(header) || !/%%EOF[\x00\t\n\f\r ]*$/.test(ending)) {
        return Response.json({ error: "The stored file does not look like a complete PDF." }, { status: 415 });
      }

      const bytes = new Uint8Array(await fileBlob.arrayBuffer());
      const base64File = bytesToBase64(bytes);

      // Send the PDF securely to OpenAI.
      const openaiResponse = await fetch(
        "https://api.openai.com/v1/responses",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${openaiApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-5.6",
            store: false,

            input: [
              {
                role: "user",
                content: [
                  {
                    type: "input_file",
                    filename: documentRow.file_name,
                    file_data: `data:application/pdf;base64,${base64File}`,
                  },
                  {
                    type: "input_text",
                    text: `
Extract administrative information from this healthcare document.

Rules:
- Extract only information explicitly present in the document.
- Never guess or invent information.
- patient_name: full patient name, or empty string if unclear or missing.
- document_date: return YYYY-MM-DD only when a clear document or service date exists; otherwise empty string.
- insurance_information: concise insurer name, member ID, policy number, group number, or other insurance information explicitly shown. Return empty string if none.
- missing_information: concise comma-separated list of important targeted administrative information that is missing or unreadable. Return empty string if nothing is clearly missing.
`,
                  },
                ],
              },
            ],

            text: {
              format: {
                type: "json_schema",
                name: "careflow_document_extraction",
                strict: true,
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    patient_name: {
                      type: "string",
                    },
                    document_date: {
                      type: "string",
                    },
                    insurance_information: {
                      type: "string",
                    },
                    missing_information: {
                      type: "string",
                    },
                  },
                  required: [
                    "patient_name",
                    "document_date",
                    "insurance_information",
                    "missing_information",
                  ],
                },
              },
            },
          }),
        }
      );

      const openaiData = await openaiResponse.json();

      if (!openaiResponse.ok) {
        return Response.json(
          {
            error: "OpenAI processing failed",
            details:
              openaiData?.error?.message ??
              "Unknown OpenAI API error",
          },
          { status: 502 }
        );
      }

      const outputText = openaiData.output
        ?.flatMap((item: any) =>
          Array.isArray(item.content) ? item.content : []
        )
        ?.find((part: any) => part.type === "output_text")
        ?.text;

      if (!outputText) {
        return Response.json(
          { error: "AI returned no extraction result" },
          { status: 502 }
        );
      }

      const extracted = JSON.parse(outputText);

      const cleanText = (value: unknown) => {
        if (typeof value !== "string") {
          return null;
        }

        const cleaned = value.trim();

        return cleaned.length > 0 ? cleaned : null;
      };

      const rawDate = cleanText(extracted.document_date);

      const documentDate =
        rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
          ? rawDate
          : null;

      const finalData = {
        patient_name: cleanText(extracted.patient_name),
        document_date: documentDate,
        insurance_information: cleanText(
          extracted.insurance_information
        ),
        missing_information: cleanText(
          extracted.missing_information
        ),
      };

      // Recheck permissions at save time using the caller's scoped client.
      // Do not return extracted data if access was removed during processing.
      const { data: updatedCase, error: updateError } = await ctx.supabase
        .from("cases")
        .update(finalData)
        .eq("id", caseRow.id)
        .eq("document_id", document_id)
        .eq("organization_id", caseRow.organization_id)
        .eq("review_revision", caseRow.review_revision)
        .select("id")
        .single();

      if (updateError || !updatedCase) {
        return Response.json(
          {
            error: "Could not save AI results",
          },
          { status: 500 }
        );
      }

      return Response.json({
        success: true,
        document_id,
        extracted: finalData,
      });
    } catch (error) {
      console.error(error);

      return Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Unknown processing error",
        },
        { status: 500 }
      );
    }
  }),
};
