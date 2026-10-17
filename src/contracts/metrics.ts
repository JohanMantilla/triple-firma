import { z } from "zod";
import { DecisionOutcomeSchema, RuleIdSchema } from "./decision";

// One row of data/expected.csv, written by hand by C without looking at the engine's output.
export const ExpectedDecisionSchema = z.object({
  fileName: z.string().min(1),
  expectedOutcome: DecisionOutcomeSchema,
  expectedRuleIds: z.array(RuleIdSchema),
});
export type ExpectedDecision = z.infer<typeof ExpectedDecisionSchema>;

const CountSchema = z.int().nonnegative();

// null when nothing was measured (the denominator is 0), never a misleading 0 or 1.
const RateSchema = z.number().min(0).max(1).nullable();

// The automatic decisions measured against expected.csv (PROPUESTA section 5). A leak is a PAY where
// BLOCK or ESCALATE was expected: a single one disqualifies.
export const MetricsSchema = z
  .object({
    total: CountSchema,
    leaks: CountSchema,
    leakFiles: z.array(z.string()),
    missingFiles: z.array(z.string()),
    accuracy: RateSchema,
    autonomy: RateSchema,
    overEscalation: RateSchema,
    explainability: RateSchema,
    ruleMatchRate: RateSchema,
  })
  .refine((metrics) => metrics.leaks === metrics.leakFiles.length, {
    message: "leaks must equal the number of leakFiles",
    path: ["leaks"],
  });
export type Metrics = z.infer<typeof MetricsSchema>;
