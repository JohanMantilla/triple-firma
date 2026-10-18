import { connection } from "next/server";
import { verifyAuditChain } from "@/store/audit-log";
import { getDb } from "@/store/db";

// The "Verificar integridad del registro" button.
export async function GET(): Promise<Response> {
  await connection();
  return Response.json(await verifyAuditChain(await getDb()));
}
