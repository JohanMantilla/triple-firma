import { describe, expect, it } from "vitest";
import { buildRuleContext, toLocalDate } from "@/engine/rule-context";
import { evaluateDueDateRule } from "@/engine/rules/due-date-rule";
import type { RulesConfig } from "@/contracts/rules-config";
import { buildInvoice, buildRulesConfig } from "./fixtures";

// Policy in the fixture config: up to 30 days overdue, up to 90 days ahead.
// NOW is 2026-10-17T14:00:00Z, which is 2026-10-17 in America/New_York.
function evaluate(
  dueDate: string | null,
  now = "2026-10-17T14:00:00Z",
  isUncertain = false,
  config: Partial<RulesConfig> = {},
) {
  const invoice = buildInvoice();
  invoice.extraction.dueDate = { ...invoice.extraction.dueDate, value: dueDate, isUncertain };
  return evaluateDueDateRule(
    buildRuleContext({ invoice, config: buildRulesConfig(config), history: [], now }),
  );
}

describe("evaluateDueDateRule (R9)", () => {
  it.each([
    ["due today", "2026-10-17"],
    ["due in 13 days", "2026-10-30"],
    ["exactly 90 days ahead", "2027-01-15"],
    ["overdue by 3 days", "2026-10-14"],
    ["exactly 30 days overdue", "2026-09-17"],
  ])("passes a date %s", (_case, dueDate) => {
    expect(evaluate(dueDate).outcome).toBe("PASS");
  });

  it("explains a passing date with the days until it is due", () => {
    expect(evaluate("2026-10-30")).toMatchObject({
      message: "R9: vence el 2026-10-30, dentro de 13 días, dentro de la política.",
      compared: { today: "2026-10-17", daysUntilDue: 13 },
    });
  });

  it("escalates one day beyond the overdue limit", () => {
    expect(evaluate("2026-09-16")).toMatchObject({
      outcome: "ESCALATE",
      message: "R9: venció el 2026-09-16, hace 31 días; la política admite hasta 30.",
      compared: { daysUntilDue: -31 },
    });
  });

  it("escalates one day beyond the days-ahead limit", () => {
    expect(evaluate("2027-01-16")).toMatchObject({
      outcome: "ESCALATE",
      message: "R9: vence el 2027-01-16, dentro de 91 días; la política admite hasta 90.",
    });
  });

  it.each([
    ["unreadable", null, false],
    ["uncertain", "2026-10-30", true],
  ])("escalates an %s due date", (_case, dueDate, isUncertain) => {
    expect(evaluate(dueDate, undefined, isUncertain)).toMatchObject({
      outcome: "ESCALATE",
      message: "R9: no se pudo leer con certeza la fecha de vencimiento; se escala por seguridad.",
    });
  });

  it("counts days from today in the company time zone, not in UTC", () => {
    // 02:00 UTC on Oct 31 is still Oct 30 in New York: a due date of Oct 30 is due today.
    expect(evaluate("2026-10-30", "2026-10-31T02:00:00Z").compared).toMatchObject({
      today: "2026-10-30",
      daysUntilDue: 0,
    });
  });

  it("is not shifted by a day across the daylight-saving change", () => {
    // New York leaves daylight saving time on 2026-11-01.
    expect(evaluate("2026-11-05", "2026-10-30T14:00:00Z").compared).toMatchObject({
      daysUntilDue: 6,
    });
  });

  it("with a zero-day overdue policy, passes today and escalates yesterday", () => {
    const strict = { dueDatePolicy: { maxDaysOverdue: 0, maxDaysAhead: 90 } };
    expect(evaluate("2026-10-17", undefined, false, strict).outcome).toBe("PASS");
    expect(evaluate("2026-10-16", undefined, false, strict).outcome).toBe("ESCALATE");
  });

  it("counts the days of a year below 100 correctly instead of reading it as 19xx", () => {
    const result = evaluate("0050-01-01");
    expect(result.outcome).toBe("ESCALATE");
    expect(result.compared.daysUntilDue).toBeLessThan(-700_000);
  });

  it("counts a leap day", () => {
    expect(evaluate("2028-03-01", "2028-02-28T14:00:00Z").compared).toMatchObject({
      daysUntilDue: 2,
    });
  });
});

describe("toLocalDate", () => {
  it.each([
    ["2026-10-31T02:00:00Z", "America/New_York", "2026-10-30"],
    ["2026-10-31T04:00:00Z", "America/New_York", "2026-10-31"],
    ["2026-10-31T02:00:00Z", "UTC", "2026-10-31"],
    ["2026-10-30T18:29:00Z", "Asia/Kolkata", "2026-10-30"],
    ["2026-10-30T18:30:00Z", "Asia/Kolkata", "2026-10-31"],
    ["2026-10-30T09:59:00Z", "Pacific/Kiritimati", "2026-10-30"],
    ["2026-10-30T10:00:00Z", "Pacific/Kiritimati", "2026-10-31"],
    ["2026-10-31T10:59:00Z", "Pacific/Pago_Pago", "2026-10-30"],
  ])("puts %s in %s on %s", (isoUtc, timezone, expected) => {
    expect(toLocalDate(isoUtc, timezone)).toBe(expected);
  });
});
