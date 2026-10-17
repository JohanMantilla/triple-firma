import { describe, expect, it } from "vitest";
import type { Decision, DecisionOutcome, RuleId } from "@/contracts/decision";
import { type DecisionRecord, deriveHistoryStatus } from "@/contracts/decision-record";
import type { ExpectedDecision } from "@/contracts/metrics";
import { computeMetrics, parseExpectedCsv } from "@/pipeline/compute-metrics";
import { buildApproval, buildDecision } from "../contracts/fixtures";
import { buildInvoice } from "../engine/fixtures";

function buildRecord(
  fileName: string,
  outcome: DecisionOutcome,
  decision?: Decision,
): DecisionRecord {
  const stored = decision ?? buildDecision(fileName, outcome);
  return {
    fileName,
    status: deriveHistoryStatus(stored.outcome, null),
    invoice: buildInvoice({ id: fileName }),
    decision: stored,
    approval: null,
    extractionFailure: null,
  };
}

function expected(
  fileName: string,
  expectedOutcome: DecisionOutcome,
  expectedRuleIds: RuleId[] = [],
): ExpectedDecision {
  return { fileName, expectedOutcome, expectedRuleIds };
}

describe("computeMetrics", () => {
  it("counts a PAY where BLOCK or ESCALATE was expected as a leak", () => {
    const metrics = computeMetrics(
      [
        buildRecord("dev/a.pdf", "PAY"),
        buildRecord("dev/b.pdf", "PAY"),
        buildRecord("dev/c.pdf", "BLOCK"),
      ],
      [
        expected("dev/a.pdf", "BLOCK"),
        expected("dev/b.pdf", "PAY"),
        expected("dev/c.pdf", "ESCALATE"),
      ],
    );
    expect(metrics).toMatchObject({
      total: 3,
      leaks: 1,
      leakFiles: ["dev/a.pdf"],
      accuracy: 1 / 3,
    });
  });

  it("measures autonomy and over-escalation only on invoices expected to be paid or blocked", () => {
    const metrics = computeMetrics(
      [
        buildRecord("dev/a.pdf", "PAY"),
        buildRecord("dev/b.pdf", "ESCALATE"),
        buildRecord("dev/c.pdf", "ESCALATE"),
        buildRecord("dev/d.pdf", "BLOCK"),
      ],
      [
        expected("dev/a.pdf", "PAY"),
        expected("dev/b.pdf", "BLOCK"),
        expected("dev/c.pdf", "ESCALATE"),
        expected("dev/d.pdf", "BLOCK"),
      ],
    );
    expect(metrics).toMatchObject({
      accuracy: 3 / 4,
      autonomy: 2 / 3,
      overEscalation: 1 / 3,
      leaks: 0,
    });
  });

  it("measures every record of a file name, newest or oldest", () => {
    const older = buildRecord("dev/a.pdf", "BLOCK");
    const newer = buildRecord("dev/a.pdf", "PAY");
    for (const records of [
      [newer, older],
      [older, newer],
    ]) {
      const metrics = computeMetrics(records, [expected("dev/a.pdf", "BLOCK")]);
      expect(metrics).toMatchObject({
        total: 2,
        leaks: 1,
        leakFiles: ["dev/a.pdf"],
        accuracy: 1 / 2,
      });
    }
  });

  it("lists a file once however many of its records leak", () => {
    const metrics = computeMetrics(
      [buildRecord("dev/a.pdf", "PAY"), buildRecord("dev/a.pdf", "PAY")],
      [expected("dev/a.pdf", "ESCALATE")],
    );
    expect(metrics).toMatchObject({ total: 2, leaks: 1, leakFiles: ["dev/a.pdf"] });
  });

  it("still counts a PAY decision that carries an approval as a leak", () => {
    const record = buildRecord("dev/a.pdf", "PAY");
    record.approval = buildApproval(record.decision, "APPROVED");
    expect(computeMetrics([record], [expected("dev/a.pdf", "BLOCK")])).toMatchObject({ leaks: 1 });
  });

  it("lists expected files without a decision and leaves them out of every rate", () => {
    const metrics = computeMetrics(
      [buildRecord("dev/a.pdf", "BLOCK")],
      [expected("dev/a.pdf", "BLOCK"), expected("dev/b-copy.pdf", "BLOCK")],
    );
    expect(metrics).toMatchObject({ total: 1, missingFiles: ["dev/b-copy.pdf"], accuracy: 1 });
  });

  it("reports null rates when nothing was measured", () => {
    expect(computeMetrics([], [])).toEqual({
      total: 0,
      leaks: 0,
      leakFiles: [],
      missingFiles: [],
      accuracy: null,
      autonomy: null,
      overEscalation: null,
      explainability: null,
      ruleMatchRate: null,
    });
  });

  it("counts a decision as explained only if every failed rule shows its values and its message", () => {
    const unexplained = buildDecision("dev/u.pdf", "ESCALATE"); // fixture rules compare nothing
    const explained = buildDecision("dev/e.pdf", "ESCALATE");
    explained.ruleResults = explained.ruleResults.map((result) =>
      result.outcome === "PASS" ? result : { ...result, compared: { amountMinor: 250_000 } },
    );
    const metrics = computeMetrics(
      [
        buildRecord("dev/u.pdf", "ESCALATE", unexplained),
        buildRecord("dev/e.pdf", "ESCALATE", explained),
        buildRecord("dev/p.pdf", "PAY"),
      ],
      [
        expected("dev/u.pdf", "ESCALATE"),
        expected("dev/e.pdf", "ESCALATE"),
        expected("dev/p.pdf", "PAY"),
      ],
    );
    expect(metrics.explainability).toBe(2 / 3);
  });

  it("matches the rules that were expected to fire", () => {
    const metrics = computeMetrics(
      [buildRecord("dev/a.pdf", "ESCALATE"), buildRecord("dev/b.pdf", "ESCALATE")],
      [expected("dev/a.pdf", "ESCALATE", ["R5"]), expected("dev/b.pdf", "ESCALATE", ["R2"])],
    );
    expect(metrics.ruleMatchRate).toBe(1 / 2);
  });
});

describe("parseExpectedCsv", () => {
  it("reads every row, with an empty rule list when no rule must fire", () => {
    const text = "file,expected_outcome,expected_rules\ndev/01.pdf,PAY,\ndev/02.pdf,BLOCK,R2;R6\n";
    expect(parseExpectedCsv(text)).toEqual([
      { fileName: "dev/01.pdf", expectedOutcome: "PAY", expectedRuleIds: [] },
      { fileName: "dev/02.pdf", expectedOutcome: "BLOCK", expectedRuleIds: ["R2", "R6"] },
    ]);
  });

  it("reads a file saved by a spreadsheet: BOM, CRLF, spaces and trailing blank lines", () => {
    const text =
      "\uFEFFfile,expected_outcome,expected_rules\r\n dev/01.pdf , ESCALATE , R5 ; R7 \r\n\r\n";
    expect(parseExpectedCsv(text)).toEqual([
      { fileName: "dev/01.pdf", expectedOutcome: "ESCALATE", expectedRuleIds: ["R5", "R7"] },
    ]);
  });

  it("rejects a file listed twice", () => {
    const text = "file,expected_outcome,expected_rules\ndev/01.pdf,PAY,\ndev/01.pdf,BLOCK,R2\n";
    expect(() => parseExpectedCsv(text)).toThrow("dev/01.pdf");
  });

  it("rejects a wrong header, an unknown outcome and an extra field", () => {
    expect(() => parseExpectedCsv("archivo,decision\ndev/01.pdf,PAY\n")).toThrow("header");
    expect(() =>
      parseExpectedCsv("file,expected_outcome,expected_rules\ndev/01.pdf,PAID,\n"),
    ).toThrow();
    expect(() =>
      parseExpectedCsv("file,expected_outcome,expected_rules\ndev/01.pdf,PAY,R1,x\n"),
    ).toThrow("line 2");
  });

  it("returns no rows for a header-only file and rejects a row without an outcome", () => {
    expect(parseExpectedCsv("file,expected_outcome,expected_rules\n")).toEqual([]);
    expect(() => parseExpectedCsv("file,expected_outcome,expected_rules\ndev/01.pdf\n")).toThrow();
  });

  it("returns no rows for an empty file", () => {
    expect(parseExpectedCsv("")).toEqual([]);
  });
});
