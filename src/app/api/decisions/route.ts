import { connection } from "next/server";
import { HistoryEntryStatusSchema } from "@/contracts/history";
import { getDb } from "@/store/db";
import { listDecisionRecords } from "@/store/decision-repository";
import { jsonError } from "../responses";

// Every decision, newest first. ?status=PAYABLE|PENDING_APPROVAL|REJECTED|BLOCKED filters by the
// resulting status; the inbox asks for PENDING_APPROVAL.
export async function GET(request: Request): Promise<Response> {
  await connection();
  const status = new URL(request.url).searchParams.get("status") ?? undefined;
  const parsed = HistoryEntryStatusSchema.optional().safeParse(status);
  if (!parsed.success) return jsonError(400, "INVALID_REQUEST", parsed.error.issues);
  return Response.json(await listDecisionRecords(await getDb(), parsed.data));
}
