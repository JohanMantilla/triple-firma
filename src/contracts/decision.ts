import { z } from "zod";
import { IsoDateTimeSchema } from "./dates";
import {
  CurrencyCodeSchema,
  ExchangeRateSchema,
  MinorAmountSchema,
  PositiveMinorAmountSchema,
} from "./money";

export const RULE_IDS = ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10"] as const;
export const RuleIdSchema = z.enum(RULE_IDS);
export type RuleId = z.infer<typeof RuleIdSchema>;

export const RuleOutcomeSchema = z.enum(["PASS", "ESCALATE", "BLOCK"]);
export type RuleOutcome = z.infer<typeof RuleOutcomeSchema>;

export const DecisionOutcomeSchema = z.enum(["PAY", "ESCALATE", "BLOCK"]);
export type DecisionOutcome = z.infer<typeof DecisionOutcomeSchema>;

export const RuleResultSchema = z.object({
  ruleId: RuleIdSchema,
  outcome: RuleOutcomeSchema,
  message: z.string().min(1),
  compared: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});
export type RuleResult = z.infer<typeof RuleResultSchema>;

// Precedence: any BLOCK wins, then any ESCALATE; PAY only when every rule passed.
export function combineRuleOutcomes(outcomes: readonly RuleOutcome[]): DecisionOutcome {
  if (outcomes.includes("BLOCK")) return "BLOCK";
  if (outcomes.includes("ESCALATE") || outcomes.length === 0) return "ESCALATE";
  return "PAY";
}

export const DecisionSchema = z
  .object({
    id: z.string().min(1),
    invoiceId: z.string().min(1),
    outcome: DecisionOutcomeSchema,
    ruleResults: z.array(RuleResultSchema),
    amountMinor: PositiveMinorAmountSchema.nullable(),
    currency: CurrencyCodeSchema.nullable(),
    baseAmountMinor: MinorAmountSchema.nullable(),
    exchangeRate: ExchangeRateSchema.nullable(),
    explanation: z.string().min(1),
    configVersion: z.int().positive(),
    decidedAt: IsoDateTimeSchema,
  })
  .superRefine((decision, ctx) => {
    const evaluated = decision.ruleResults.map((result) => result.ruleId);
    const isEveryRuleEvaluatedOnce =
      evaluated.length === RULE_IDS.length &&
      RULE_IDS.every((ruleId) => evaluated.includes(ruleId));
    if (!isEveryRuleEvaluatedOnce) {
      ctx.addIssue({
        code: "custom",
        message: "Every rule from R1 to R10 must be evaluated exactly once",
        path: ["ruleResults"],
      });
    }

    const expected = combineRuleOutcomes(decision.ruleResults.map((result) => result.outcome));
    if (decision.outcome !== expected) {
      ctx.addIssue({
        code: "custom",
        message: `Outcome must be ${expected}, the most restrictive rule outcome`,
        path: ["outcome"],
      });
    }

    if (
      decision.outcome === "PAY" &&
      (decision.amountMinor === null ||
        decision.currency === null ||
        decision.baseAmountMinor === null ||
        decision.exchangeRate === null)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "A PAY decision must record its amount, currency, base amount and exchange rate",
        path: ["baseAmountMinor"],
      });
    }
  });
export type Decision = z.infer<typeof DecisionSchema>;
