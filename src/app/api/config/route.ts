import { connection } from "next/server";
import { RulesConfigSchema } from "@/contracts/rules-config";
import { saveRulesConfig } from "@/pipeline/save-rules-config";
import { findCurrentRulesConfig } from "@/store/config-repository";
import { getDb } from "@/store/db";
import { requireHumanKey } from "../require-human-key";
import { jsonError } from "../responses";

export async function GET(): Promise<Response> {
  await connection();
  const current = await findCurrentRulesConfig(await getDb());
  return current === null ? jsonError(404, "NOT_FOUND") : Response.json(current);
}

// Saves a new version. An invalid config is never stored: 400 lists the invalid fields.
export async function PUT(request: Request): Promise<Response> {
  const denied = requireHumanKey(request);
  if (denied !== null) return denied;
  const parsed = RulesConfigSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return jsonError(400, "INVALID_REQUEST", parsed.error.issues);
  return Response.json(await saveRulesConfig(await getDb(), parsed.data, new Date().toISOString()));
}
