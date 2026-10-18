import { ApprovalRequestSchema } from "@/contracts/approval";
import { resolveApproval } from "@/pipeline/resolve-approval";
import { getDb } from "@/store/db";
import { jsonError } from "../../responses";

const STATUS_BY_REASON = {
  NOT_FOUND: 404,
  NOT_ESCALATED: 409,
  ALREADY_RESOLVED: 409,
  NO_RULES_CONFIG: 409,
} as const;

// Approve or reject an escalated decision. 200 with the updated record, also when the revalidation
// turned an approval into BLOCK: the record's approval explains why.
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/approvals/[decisionId]">,
): Promise<Response> {
  const parsed = ApprovalRequestSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return jsonError(400, "INVALID_REQUEST", parsed.error.issues);

  const { decisionId } = await ctx.params;
  const result = await resolveApproval(
    await getDb(),
    decisionId,
    parsed.data,
    new Date().toISOString(),
  );
  if (!result.ok) return jsonError(STATUS_BY_REASON[result.reason], result.reason);
  return Response.json(result.record);
}
