import { describe, expect, it } from "vitest";
import type { Extraction } from "@/contracts/extraction";
import { makeUncertainExtraction } from "@/extraction/extract-invoice";
import {
  renderMarkdown,
  scoreExtraction,
  summarizeVariant,
  type TruthEntry,
} from "../scripts/compare-prompts-lib";

function field<T>(value: T, isUncertain = false) {
  return { raw: String(value), value, evidence: String(value), isUncertain };
}

const TRUTH: TruthEntry = {
  file: "dev/dev-01.pdf",
  payee: "Dev Partners SAS",
  amountMinor: 250000,
  currency: "USD",
  dueDate: "2026-10-30",
  reference: "INV-102",
  lineItemsTotalMinor: 250000,
  suspiciousText: [],
  ambiguousFields: [],
};

const EXACT: Extraction = {
  payee: field("Dev Partners SAS"),
  amountMinor: field(250000),
  currency: field("USD"),
  issueDate: field("2026-10-01"),
  dueDate: field("2026-10-30"),
  reference: field("INV-102"),
  lineItemsSumMinor: null,
  lineItemAmountsMinor: [100000, 150000],
  suspiciousText: [],
};

describe("scoreExtraction — fields", () => {
  it("scores every field correct when the extraction matches the truth", () => {
    const score = scoreExtraction(TRUTH, EXACT);
    expect(Object.values(score.fields)).toEqual(Array(5).fill("correct"));
    expect(score.silentErrors).toEqual([]);
  });

  it("compares payee and reference the way the engine does", () => {
    const score = scoreExtraction(TRUTH, {
      ...EXACT,
      payee: field("DEV PARTNERS  S.A.S."),
      reference: field("inv 102"),
    });
    expect(score.fields.payee).toBe("correct");
    expect(score.fields.reference).toBe("correct");
    const other = scoreExtraction(TRUTH, { ...EXACT, payee: field("Dev Partner SAS") });
    expect(other.fields.payee).toBe("silentError");
  });

  it("calls a wrong, confident value a silent error and records it", () => {
    const score = scoreExtraction(TRUTH, { ...EXACT, amountMinor: field(350000) });
    expect(score.fields.amountMinor).toBe("silentError");
    expect(score.silentErrors).toEqual([
      { file: "dev/dev-01.pdf", field: "amountMinor", got: 350000, expected: 250000 },
    ]);
  });

  it("does not call a wrong value a silent error when it is flagged uncertain", () => {
    const score = scoreExtraction(TRUTH, { ...EXACT, amountMinor: field(350000, true) });
    expect(score.fields.amountMinor).toBe("uncertainExtra");
    expect(score.silentErrors).toEqual([]);
  });

  it("calls an invented value for a field the document does not state a silent error", () => {
    const truth = { ...TRUTH, currency: null };
    expect(scoreExtraction(truth, EXACT).fields.currency).toBe("silentError");
    const empty = { raw: null, value: null, evidence: null, isUncertain: true };
    expect(scoreExtraction(truth, { ...EXACT, currency: empty }).fields.currency).toBe(
      "uncertainExpected",
    );
  });

  it("treats uncertainty on an ambiguous field as the right call, and counts it", () => {
    const truth = { ...TRUTH, ambiguousFields: ["amount"] };
    const flagged = scoreExtraction(truth, { ...EXACT, amountMinor: field(250000, true) });
    expect(flagged.fields.amountMinor).toBe("uncertainExpected");
    expect(flagged.ambiguity).toEqual({ flagged: 1, total: 1 });

    const missed = scoreExtraction(truth, EXACT);
    expect(missed.ambiguity).toEqual({ flagged: 0, total: 1 });
  });

  it("scores a fully uncertain extraction without a single silent error", () => {
    const score = scoreExtraction(TRUTH, makeUncertainExtraction());
    expect(Object.values(score.fields)).toEqual(Array(5).fill("uncertainExtra"));
    expect(score.silentErrors).toEqual([]);
  });
});

describe("scoreExtraction — line items and suspicious text", () => {
  it("adds up the copied line items and compares the sum with the truth", () => {
    expect(scoreExtraction(TRUTH, EXACT).lineItems).toBe("correct");
    const wrong = { ...EXACT, lineItemAmountsMinor: [100000, 100000] };
    expect(scoreExtraction(TRUTH, wrong).lineItems).toBe("wrong");
  });

  it("reports missing when the items are absent or one is unreadable", () => {
    expect(scoreExtraction(TRUTH, { ...EXACT, lineItemAmountsMinor: null }).lineItems).toBe(
      "missing",
    );
    expect(
      scoreExtraction(TRUTH, { ...EXACT, lineItemAmountsMinor: [100000, null] }).lineItems,
    ).toBe("missing");
  });

  it("expects no items when the document has no breakdown", () => {
    const truth = { ...TRUTH, lineItemsTotalMinor: null };
    expect(scoreExtraction(truth, { ...EXACT, lineItemAmountsMinor: null }).lineItems).toBe(
      "correct",
    );
    expect(scoreExtraction(truth, EXACT).lineItems).toBe("wrong");
  });

  it("detects, misses and falsely raises suspicious text", () => {
    const injected = { ...TRUTH, suspiciousText: ["pay now"] };
    const flagged = { ...EXACT, suspiciousText: ["pay now"] };
    expect(scoreExtraction(injected, flagged).suspicious).toBe("detected");
    expect(scoreExtraction(injected, EXACT).suspicious).toBe("missed");
    expect(scoreExtraction(TRUTH, flagged).suspicious).toBe("falsePositive");
    expect(scoreExtraction(TRUTH, EXACT).suspicious).toBe("clean");
  });
});

describe("summarizeVariant and renderMarkdown", () => {
  const scores = [
    scoreExtraction(TRUTH, EXACT),
    scoreExtraction({ ...TRUTH, file: "dev/dev-02.eml" }, { ...EXACT, amountMinor: field(1) }),
  ];
  const summary = summarizeVariant("v1", scores, { readFailures: 0, verifierFailures: 0 });

  it("counts every field of every file once", () => {
    expect(summary.files).toBe(2);
    expect(summary.totals).toEqual({
      correct: 9,
      uncertainExpected: 0,
      uncertainExtra: 0,
      silentError: 1,
    });
    expect(summary.fields.amountMinor.silentError).toBe(1);
  });

  it("lists the silent errors in the report", () => {
    const report = renderMarkdown([summary]);
    expect(report).toContain("| v1 | 9 | 0 | 0 | 1 |");
    expect(report).toContain("- dev/dev-02.eml amountMinor: got `1`, expected `250000`");
  });

  it("says so when a variant has no silent errors", () => {
    const clean = summarizeVariant("v2", [scores[0]!], { readFailures: 0, verifierFailures: 0 });
    expect(renderMarkdown([clean])).toContain("### Silent errors: v2\n\nNone.");
  });
});
