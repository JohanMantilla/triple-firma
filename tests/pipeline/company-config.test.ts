import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toRulesConfig } from "@/pipeline/company-config";

describe("toRulesConfig", () => {
  const company = JSON.parse(readFileSync("data/config/company.json", "utf8"));

  it("turns the fictitious company into a valid RulesConfig", () => {
    const config = toRulesConfig(company);
    expect(config.baseCurrency).toBe("USD");
    expect(config.approvalThresholdMinor).toBe(200000);
    expect(config.blockedPayees).toEqual(["Tierra Verde Logística SAS"]);
    expect(config.agreements).toHaveLength(company.agreements.length);
  });
});
