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
import { convertToBaseMinor } from "./convert-to-base";
import { describeError } from "./evaluate-rules";
import { MESSAGES } from "./messages";
import { buildRuleContext, type RuleContext } from "./rule-context";
import { checkBudget } from "./rules/budget-rule";
import { checkDuplicateOnApproval, isOwnPendingEntry } from "./rules/duplicate-rule";

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
  const ctx = buildRuleContext(input);
  assertResolvable(decision, ctx);

  const resolution = {
    ...request,
    decisionId: decision.id,
    amountMinor: decision.amountMinor,
    currency: decision.currency,
    exchangeRate: decision.exchangeRate,
    baseAmountMinor: decision.baseAmountMinor,
    resolvedAt: ctx.now,
  };
  if (request.action === "REJECT") {
    return ApprovalSchema.parse({
      ...resolution,
      resultingOutcome: "BLOCK",
      revalidationResults: [],
    });
  }

  const approvalCtx = withDecisionMoney(ctx, decision);
  const revalidationResults = [
    runRevalidation("R2", () => checkDuplicateOnApproval(approvalCtx)),
    runRevalidation("R6", () => checkBudget(approvalCtx, { isApproval: true })),
  ];
  const isPaying = revalidationResults.every((result) => result.outcome === "PASS");
  return ApprovalSchema.parse({
    ...resolution,
    resultingOutcome: isPaying ? "PAY" : "BLOCK",
    revalidationResults,
  });
}

// Only what still waits for a person, with data that agrees, can be resolved. Anything else is an error
// of the caller: the function throws, so no approval is produced and E stores nothing.
function assertResolvable(decision: Decision, ctx: RuleContext): void {
  const { invoice } = ctx;
  if (decision.outcome !== "ESCALATE") {
    throw new Error(
      `Only an escalated decision can be resolved; ${decision.id} is ${decision.outcome}`,
    );
  }
  if (decision.invoiceId !== invoice.id) {
    throw new Error(`Decision ${decision.id} belongs to ${decision.invoiceId}, not ${invoice.id}`);
  }
  // A rejection is final, and so is an approval that was blocked: once its own entry is no longer
  // pending, the escalation cannot be approved again (for example next month, with a fresh budget).
  if (!ctx.history.some((entry) => isOwnPendingEntry(entry, invoice))) {
    throw new Error(`Decision ${decision.id} is no longer pending approval`);
  }
  // R2 compares the invoice and R6 the decision: both must be the same money.
  const { amountMinor, currency } = invoice.extraction;
  if (decision.amountMinor !== amountMinor.value || decision.currency !== currency.value) {
    throw new Error(`Decision ${decision.id} records other money than invoice ${invoice.id}`);
  }
  // The stored base amount must be the one its own stored rate gives; today's rate is never used.
  const { amountMinor: storedAmount, exchangeRate, baseAmountMinor } = decision;
  if (
    baseAmountMinor !== null &&
    (storedAmount === null ||
      exchangeRate === null ||
      convertToBaseMinor(storedAmount, exchangeRate) !== baseAmountMinor)
  ) {
    throw new Error(
      `Decision ${decision.id} records a base amount its exchange rate does not give`,
    );
  }
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
