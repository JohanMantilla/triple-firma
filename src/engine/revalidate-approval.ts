import {
  type Approval,
  type ApprovalRequest,
  ApprovalRequestSchema,
  ApprovalSchema,
} from "@/contracts/approval";
import {
  type Decision,
  DecisionSchema,
  type RuleId,
  type RuleResult,
  RuleResultSchema,
} from "@/contracts/decision";
import type { HistoryEntry } from "@/contracts/history";
import type { Invoice } from "@/contracts/invoice";
import type { RulesConfig } from "@/contracts/rules-config";
import { describeError } from "./evaluate-rules";
import { MESSAGES } from "./messages";
import { buildRuleContext, type RuleContext } from "./rule-context";
import { checkBudget } from "./rules/budget-rule";
import { checkDuplicateOnApproval } from "./rules/duplicate-rule";

export type RevalidateApprovalInput = {
  request: ApprovalRequest;
  decision: Decision;
  invoice: Invoice;
  config: RulesConfig;
  history: readonly HistoryEntry[];
  now: string;
};

// Resolves an escalated decision. A rejection is final and revalidates nothing. An approval revalidates
// duplicates (R2) and budget (R6) against the history of this moment and pays only if both pass;
// nothing can be escalated again, so anything else blocks (invariant 8). The money is the one stored in
// the decision, never converted again with today's rates, and the budget period is that of the
// approval. The result is parsed with ApprovalSchema, a second barrier before E stores it.
export function revalidateApproval(input: RevalidateApprovalInput): Approval {
  const request = ApprovalRequestSchema.parse(input.request);
  const decision = DecisionSchema.parse(input.decision);
  if (decision.outcome !== "ESCALATE") {
    throw new Error(
      `Only an escalated decision can be resolved; ${decision.id} is ${decision.outcome}`,
    );
  }
  if (decision.invoiceId !== input.invoice.id) {
    throw new Error(
      `Decision ${decision.id} belongs to ${decision.invoiceId}, not ${input.invoice.id}`,
    );
  }

  const resolution = {
    ...request,
    decisionId: decision.id,
    amountMinor: decision.amountMinor,
    currency: decision.currency,
    exchangeRate: decision.exchangeRate,
    baseAmountMinor: decision.baseAmountMinor,
    resolvedAt: input.now,
  };
  if (request.action === "REJECT") {
    return ApprovalSchema.parse({
      ...resolution,
      resultingOutcome: "BLOCK",
      revalidationResults: [],
    });
  }

  const ctx = withDecisionMoney(buildRuleContext(input), decision);
  const revalidationResults = [
    runRevalidation("R2", () => checkDuplicateOnApproval(ctx)),
    runRevalidation("R6", () => checkBudget(ctx, { isApproval: true })),
  ];
  const isPaying = revalidationResults.every((result) => result.outcome === "PASS");
  return ApprovalSchema.parse({
    ...resolution,
    resultingOutcome: isPaying ? "PAY" : "BLOCK",
    revalidationResults,
  });
}

// The rules see the money recorded when the invoice was escalated (invariant 8): if the rate changed
// since, a recomputed amount could fit in the budget when the real one does not.
function withDecisionMoney(ctx: RuleContext, decision: Decision): RuleContext {
  return Object.freeze({
    ...ctx,
    amountMinor: decision.amountMinor,
    currency: decision.currency,
    exchangeRate: decision.exchangeRate,
    baseAmountMinor: decision.baseAmountMinor,
  });
}

// A check that throws or returns an invalid result blocks the approval, with the failure recorded: at
// this point the safe outcome is not paying, and nothing can be escalated again.
function runRevalidation(ruleId: RuleId, check: () => RuleResult): RuleResult {
  try {
    const parsed = RuleResultSchema.safeParse(check());
    if (parsed.success && parsed.data.ruleId === ruleId) return parsed.data;
    return failedRevalidation(ruleId, "invalid rule result");
  } catch (error) {
    return failedRevalidation(ruleId, describeError(error));
  }
}

function failedRevalidation(ruleId: RuleId, reason: string): RuleResult {
  return {
    ruleId,
    outcome: "BLOCK",
    message: MESSAGES.ruleFailedOnApproval(ruleId),
    compared: { error: reason },
  };
}
