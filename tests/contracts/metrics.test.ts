import { describe, expect, it } from "vitest";
import { ExpectedDecisionSchema, type Metrics, MetricsSchema } from "@/contracts/metrics";

const METRICS: Metrics = {
  total: 2,
  leaks: 1,
  leakFiles: ["dev/03-duplicate.pdf"],
  missingFiles: [],
  accuracy: 0.5,
  autonomy: null,
  overEscalation: null,
  explainability: 1,
  ruleMatchRate: 0.5,
};

describe("MetricsSchema", () => {
  it("accepts rates in [0, 1] and null when nothing was measured", () => {
    expect(MetricsSchema.safeParse(METRICS).success).toBe(true);
  });

  it("rejects a rate above 1", () => {
    expect(MetricsSchema.safeParse({ ...METRICS, accuracy: 1.5 }).success).toBe(false);
  });

  it("rejects a leak count that does not match the leaking files", () => {
    expect(MetricsSchema.safeParse({ ...METRICS, leaks: 0 }).success).toBe(false);
  });
});

describe("ExpectedDecisionSchema", () => {
  it("accepts an outcome and rule ids from the contracts", () => {
    const row = { fileName: "dev/01.pdf", expectedOutcome: "BLOCK", expectedRuleIds: ["R2"] };
    expect(ExpectedDecisionSchema.safeParse(row).success).toBe(true);
  });

  it("rejects an outcome outside PAY, BLOCK and ESCALATE", () => {
    const row = { fileName: "dev/01.pdf", expectedOutcome: "PAID", expectedRuleIds: [] };
    expect(ExpectedDecisionSchema.safeParse(row).success).toBe(false);
  });
});
