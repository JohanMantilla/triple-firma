import type { RuleResult } from "@/contracts/decision";
import type { Extraction } from "@/contracts/extraction";
import { MESSAGES } from "../messages";
import type { RuleContext } from "../rule-context";

const REQUIRED_FIELDS = ["payee", "amountMinor", "currency", "dueDate", "reference"] as const;
type RequiredField = (typeof REQUIRED_FIELDS)[number];

// R1: every required field must have a value, be certain and come with evidence. When the original
// text of the invoice is available (emails and chats), the evidence must also appear in it: evidence
// the reader invented or altered is caught deterministically, without trusting the LLM.
export function evaluateExtractionRule(ctx: RuleContext): RuleResult {
  const { extraction, sourceText } = ctx.invoice;
  const searchableSource = sourceText === null ? null : normalizeForSearch(sourceText);

  const unreadable: RequiredField[] = [];
  const withoutEvidence: RequiredField[] = [];
  const evidenceNotInSource: RequiredField[] = [];

  for (const field of REQUIRED_FIELDS) {
    const { value, isUncertain, evidence } = extraction[field] as Extraction[RequiredField];
    if (value === null || isUncertain) {
      unreadable.push(field);
    } else if (evidence === null || evidence.trim() === "") {
      withoutEvidence.push(field);
    } else if (
      searchableSource !== null &&
      !searchableSource.includes(normalizeForSearch(evidence))
    ) {
      evidenceNotInSource.push(field);
    }
  }

  const compared = {
    unreadable: unreadable.join(","),
    withoutEvidence: withoutEvidence.join(","),
    evidenceNotInSource: evidenceNotInSource.join(","),
  };
  const reasons = [
    unreadable.length > 0 && MESSAGES.extraction.unreadable(labelsOf(unreadable)),
    withoutEvidence.length > 0 && MESSAGES.extraction.withoutEvidence(labelsOf(withoutEvidence)),
    evidenceNotInSource.length > 0 &&
      MESSAGES.extraction.evidenceNotInSource(labelsOf(evidenceNotInSource)),
  ].filter((reason): reason is string => typeof reason === "string");

  if (reasons.length === 0) {
    return { ruleId: "R1", outcome: "PASS", message: MESSAGES.extraction.passed, compared };
  }
  return {
    ruleId: "R1",
    outcome: "ESCALATE",
    message: MESSAGES.extraction.escalated(reasons),
    compared,
  };
}

function labelsOf(fields: readonly RequiredField[]): string {
  return fields.map((field) => MESSAGES.fieldLabels[field]).join(", ");
}

// Case, invisible characters, compatibility forms and runs of whitespace do not change the evidence.
function normalizeForSearch(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
