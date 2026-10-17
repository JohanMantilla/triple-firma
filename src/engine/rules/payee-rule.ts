import type { RuleResult } from "@/contracts/decision";
import { normalizePayee } from "@/contracts/payee";
import { MESSAGES } from "../messages";
import type { RuleContext } from "../rule-context";
import { isNearPayee } from "./payee-similarity";

// R3: the payee is checked against the company's lists in a fixed order, and the first match decides:
// identical to a blocked payee -> BLOCK; looks like a blocked payee -> ESCALATE (even if it is also
// identical to an allowed one); identical to an allowed payee -> PASS; looks like an allowed payee or is
// on no list -> ESCALATE. Lookalikes are reported as "requires human review", never as fraud.
export function evaluatePayeeRule(ctx: RuleContext): RuleResult {
  const { value: payee, isUncertain } = ctx.invoice.extraction.payee;
  const { allowedPayees, blockedPayees } = ctx.config;

  const result = (
    outcome: RuleResult["outcome"],
    message: string,
    match: string,
    matchedPayee: string | null = null,
  ): RuleResult => ({ ruleId: "R3", outcome, message, compared: { payee, match, matchedPayee } });

  if (payee === null || isUncertain) {
    return result("ESCALATE", MESSAGES.payee.unreadable, "UNREADABLE");
  }

  const exactBlocked = findExact(payee, blockedPayees);
  if (exactBlocked !== undefined) {
    return result("BLOCK", MESSAGES.payee.blocked(exactBlocked), "BLOCKED", exactBlocked);
  }

  const nearBlocked = findNear(payee, blockedPayees);
  if (nearBlocked !== undefined) {
    return result(
      "ESCALATE",
      MESSAGES.payee.nearBlocked(payee, nearBlocked),
      "NEAR_BLOCKED",
      nearBlocked,
    );
  }

  const exactAllowed = findExact(payee, allowedPayees);
  if (exactAllowed !== undefined) {
    return result("PASS", MESSAGES.payee.allowed(exactAllowed), "ALLOWED", exactAllowed);
  }

  const nearAllowed = findNear(payee, allowedPayees);
  if (nearAllowed !== undefined) {
    return result(
      "ESCALATE",
      MESSAGES.payee.nearAllowed(payee, nearAllowed),
      "NEAR_ALLOWED",
      nearAllowed,
    );
  }

  return result("ESCALATE", MESSAGES.payee.unknown(payee), "UNKNOWN");
}

function findExact(payee: string, list: readonly string[]): string | undefined {
  const normalized = normalizePayee(payee);
  return list.find((candidate) => normalizePayee(candidate) === normalized);
}

function findNear(payee: string, list: readonly string[]): string | undefined {
  return list.find((candidate) => isNearPayee(payee, candidate));
}
