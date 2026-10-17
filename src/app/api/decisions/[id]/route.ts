import { connection } from "next/server";
import { getDb } from "@/store/db";
import { findDecisionRecord } from "@/store/decision-repository";
import { jsonError } from "../../responses";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/decisions/[id]">,
): Promise<Response> {
  await connection();
  const { id } = await ctx.params;
  const record = await findDecisionRecord(await getDb(), id);
  return record === null ? jsonError(404, "NOT_FOUND") : Response.json(record);
}
