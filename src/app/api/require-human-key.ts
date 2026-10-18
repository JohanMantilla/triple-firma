import { createHash, timingSafeEqual } from "node:crypto";
import { jsonError } from "./responses";

const digest = (value: string) => createHash("sha256").update(value).digest();

// Guards the actions only a person may take (saving rules, resolving approvals) with the
// HUMAN_ACTIONS_KEY secret, sent in the x-api-key header. Without the variable they stay open, in
// development and in production: the public demo lets the jury approve without a key. Setting the
// variable turns the check back on, with no code change.
export function requireHumanKey(request: Request): Response | null {
  const key = process.env.HUMAN_ACTIONS_KEY;
  if (key === undefined || key === "") return null;
  const sent = request.headers.get("x-api-key") ?? "";
  return timingSafeEqual(digest(sent), digest(key)) ? null : jsonError(401, "UNAUTHORIZED");
}
