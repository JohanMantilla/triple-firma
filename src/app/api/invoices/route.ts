import { detectSourceFormat, processInvoice } from "@/pipeline/process-invoice";
import { getDb } from "@/store/db";
import { jsonError } from "../responses";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const STATUS_BY_REASON = {
  EMPTY_SOURCE_TEXT: 400,
  SOURCE_TEXT_TOO_LONG: 413,
  NO_RULES_CONFIG: 409,
} as const;

// Upload one invoice as multipart field "file". 201 for a new decision, 200 for a file already decided.
export async function POST(request: Request): Promise<Response> {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return jsonError(400, "MISSING_FILE");
  if (file.size > MAX_FILE_BYTES) return jsonError(413, "FILE_TOO_LARGE");
  const sourceFormat = detectSourceFormat(file.name);
  if (sourceFormat === null) return jsonError(400, "UNSUPPORTED_FILE_TYPE");

  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const result = await processInvoice(
    await getDb(),
    { fileName: file.name, fileBuffer, sourceFormat },
    new Date().toISOString(),
  );
  if (!result.ok) return jsonError(STATUS_BY_REASON[result.reason], result.reason);
  return Response.json(result.record, { status: result.isResubmission ? 200 : 201 });
}
