import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const BUCKET = "nautia-pdfs";
const BATCH_SIZE = 100;
const encoder = new TextEncoder();

type ClaimedPdf = {
  document_id: string;
  object_path: string;
  expires_at: string;
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function secretsEqual(actual: string | null, expected: string): Promise<boolean> {
  if (!actual) return false;
  const [actualHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(actualHash);
  const right = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }

  const retentionSecret = Deno.env.get("NAUTIA_RETENTION_SECRET") ?? "";
  if (retentionSecret.length < 32) {
    console.error("NAUTIA_RETENTION_SECRET is missing or too short");
    return json(500, { error: "worker_not_configured" });
  }
  if (!(await secretsEqual(
    request.headers.get("x-nautia-retention-secret"),
    retentionSecret,
  ))) {
    return json(401, { error: "unauthorized" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Required Supabase runtime variables are missing");
    return json(500, { error: "worker_not_configured" });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let claimedCount = 0;
  let deletedCount = 0;
  let failedCount = 0;

  const { data, error } = await supabase.rpc("nautia_claim_expired_pdfs", {
    p_limit: BATCH_SIZE,
  });
  if (error) {
    console.error("Unable to claim expired PDFs", error.message);
    return json(500, { error: "claim_failed", claimed: 0, deleted: 0, failed: 0 });
  }

  const documents = (data ?? []) as ClaimedPdf[];
  claimedCount = documents.length;
  if (documents.length > 0) {
    const { error: storageError } = await supabase.storage
      .from(BUCKET)
      .remove(documents.map((document) => document.object_path));
    if (storageError) {
      console.error("Storage batch deletion failed", storageError.message);
      failedCount = documents.length;
    } else {
      const { data: finalized, error: finalizeError } = await supabase.rpc(
        "nautia_finalize_pdf_deletions",
        { p_documents: documents },
      );
      if (finalizeError) {
        console.error("Metadata batch deletion failed", finalizeError.message);
        failedCount = documents.length;
      } else {
        deletedCount = Number(finalized ?? 0);
        failedCount = Math.max(0, documents.length - deletedCount);
      }
    }
  }

  const status = failedCount === 0 ? 200 : 500;
  return json(status, {
    claimed: claimedCount,
    deleted: deletedCount,
    failed: failedCount,
  });
});
