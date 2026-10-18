import { connection } from "next/server";
import { computeMetrics } from "@/pipeline/compute-metrics";
import { readExpectedDecisions } from "@/pipeline/dataset";
import { getDb } from "@/store/db";
import { listDecisionRecords } from "@/store/decision-repository";

// The header of the app: autonomy, accuracy and leaks of the stored decisions against expected.csv.
export async function GET(): Promise<Response> {
  await connection();
  const records = await listDecisionRecords(await getDb());
  return Response.json(computeMetrics(records, await readExpectedDecisions()));
}
