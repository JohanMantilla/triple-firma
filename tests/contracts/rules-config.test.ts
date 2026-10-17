import { describe, expect, it } from "vitest";
import { RulesConfigSchema } from "@/contracts/rules-config";
import { buildRulesConfig } from "./fixtures";

function issuesOf(input: unknown) {
  const result = RulesConfigSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe("RulesConfigSchema", () => {
  it("accepts a complete configuration", () => {
    expect(RulesConfigSchema.safeParse(buildRulesConfig()).success).toBe(true);
  });

  it("accepts the hard cap turned off", () => {
    expect(RulesConfigSchema.safeParse(buildRulesConfig({ hardCapMinor: null })).success).toBe(
      true,
    );
  });

  it("rejects a configuration with a missing field, so no rule passes unconfigured", () => {
    const { monthlyBudgetMinor: _omitted, ...incomplete } = buildRulesConfig();
    expect(RulesConfigSchema.safeParse(incomplete).success).toBe(false);
  });

  it("rejects a hard cap left undefined instead of explicitly null", () => {
    const { hardCapMinor: _omitted, ...withoutCap } = buildRulesConfig();
    expect(RulesConfigSchema.safeParse(withoutCap).success).toBe(false);
  });

  it.each([0, -100, 1500.5])("rejects an approval threshold of %s", (approvalThresholdMinor) => {
    expect(RulesConfigSchema.safeParse(buildRulesConfig({ approvalThresholdMinor })).success).toBe(
      false,
    );
  });

  it("rejects a hard cap equal to the approval threshold", () => {
    expect(issuesOf(buildRulesConfig({ hardCapMinor: 200_000 }))).toContain(
      "hardCapMinor must be greater than approvalThresholdMinor",
    );
  });

  it("rejects exchange rates without the base currency", () => {
    expect(issuesOf(buildRulesConfig({ exchangeRates: { COP: "4000" } }))).toContain(
      "exchangeRates must include the base currency with rate 1",
    );
  });

  it("rejects a base currency rate different from 1", () => {
    expect(issuesOf(buildRulesConfig({ exchangeRates: { USD: "1.01" } }))).toContain(
      "exchangeRates must include the base currency with rate 1",
    );
  });

  it("rejects exchange rates written as numbers", () => {
    expect(
      RulesConfigSchema.safeParse(buildRulesConfig({ exchangeRates: { USD: 1 } as never })).success,
    ).toBe(false);
  });

  it("rejects a payee that is both allowed and blocked, ignoring case and spaces", () => {
    expect(issuesOf(buildRulesConfig({ blockedPayees: ["  café andino sas "] }))).toContain(
      "A payee cannot be both allowed and blocked",
    );
  });

  it("rejects an agreement in a currency without exchange rate", () => {
    const config = buildRulesConfig();
    const agreements = [{ ...config.agreements[0], currency: "EUR" }];
    expect(issuesOf({ ...config, agreements })).toContain(
      "Agreement currency has no exchange rate",
    );
  });

  it("rejects an agreement that ends before it starts", () => {
    const config = buildRulesConfig();
    const agreements = [
      { ...config.agreements[0], validFrom: "2026-10-01", validUntil: "2026-09-30" },
    ];
    expect(issuesOf({ ...config, agreements })).toContain("validFrom must not be after validUntil");
  });

  it("rejects an unknown time zone", () => {
    expect(
      RulesConfigSchema.safeParse(buildRulesConfig({ timezone: "Mars/Olympus" })).success,
    ).toBe(false);
  });
});
