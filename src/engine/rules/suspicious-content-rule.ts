import type { RuleResult } from "@/contracts/decision";
import type { Extraction } from "@/contracts/extraction";
import { formatMoney } from "../format-money";
import { MESSAGES } from "../messages";
import type { RuleContext } from "../rule-context";
import { findInstruction, type InstructionMatch } from "./instruction-patterns";

const SCANNED_FIELDS = [
  "payee",
  "amountMinor",
  "currency",
  "issueDate",
  "dueDate",
  "reference",
] as const;
type ScannedField = (typeof SCANNED_FIELDS)[number];

// R10: invoice content is data, never instructions. The rule escalates when the reader flagged
// suspicious text, when the engine finds an instruction to the system on its own (in the original
// text of emails and chats, and in what was read for each field, which also covers PDFs and images),
// or when the line items plus tax do not add up to the amount. It never blocks and never passes
// anything another rule escalates: the content of an invoice can only make a decision stricter.
export function evaluateSuspiciousContentRule(ctx: RuleContext): RuleResult {
  const { extraction, sourceText } = ctx.invoice;
  const { suspiciousText, lineItemsSumMinor } = extraction;
  const taxMinor = extraction.taxMinor ?? null;
  const sourceMatch = sourceText === null ? null : findInstruction(sourceText);
  const fieldMatch = findInstructionInFields(extraction);
  const isTotalMismatch =
    lineItemsSumMinor !== null &&
    ctx.amountMinor !== null &&
    BigInt(lineItemsSumMinor) + BigInt(taxMinor ?? 0) !== BigInt(ctx.amountMinor);

  const compared = {
    readerFlagCount: suspiciousText.length,
    sourcePatternId: sourceMatch?.patternId ?? null,
    fieldWithInstruction: fieldMatch?.field ?? null,
    fieldPatternId: fieldMatch?.patternId ?? null,
    amountMinor: ctx.amountMinor,
    lineItemsSumMinor,
    taxMinor,
    hasSourceText: sourceText !== null,
  };
  const money = (amountMinor: number) => formatMoney(amountMinor, ctx.currency ?? "").trim();
  const [firstFlag] = suspiciousText;
  const reasons = [
    firstFlag !== undefined &&
      MESSAGES.suspiciousContent.readerFlagged(firstFlag, suspiciousText.length),
    sourceMatch !== null && MESSAGES.suspiciousContent.instructionInSource(sourceMatch.match),
    fieldMatch !== null &&
      MESSAGES.suspiciousContent.instructionInField(
        MESSAGES.fieldLabels[fieldMatch.field],
        fieldMatch.match,
      ),
    isTotalMismatch &&
      MESSAGES.suspiciousContent.totalMismatch(
        money(ctx.amountMinor ?? 0),
        money(lineItemsSumMinor ?? 0),
        taxMinor === null ? null : money(taxMinor),
      ),
  ].filter((reason): reason is string => typeof reason === "string");

  if (reasons.length === 0) {
    return {
      ruleId: "R10",
      outcome: "PASS",
      message: passedMessage(lineItemsSumMinor, ctx.amountMinor, taxMinor),
      compared,
    };
  }
  return {
    ruleId: "R10",
    outcome: "ESCALATE",
    message: MESSAGES.suspiciousContent.escalated(reasons),
    compared,
  };
}

// Which total check ran, so a passing result never claims a comparison that did not happen.
function passedMessage(
  lineItemsSumMinor: number | null,
  amountMinor: number | null,
  taxMinor: number | null,
): string {
  const { passed } = MESSAGES.suspiciousContent;
  if (lineItemsSumMinor === null) return passed.noLineItems;
  if (amountMinor === null) return passed.amountUnreadable;
  return taxMinor === null ? passed.matches : passed.matchesWithTax;
}

// The first instruction found in what was read for a field, raw text first and then its evidence.
function findInstructionInFields(
  extraction: Extraction,
): (InstructionMatch & { field: ScannedField }) | null {
  for (const field of SCANNED_FIELDS) {
    for (const text of [extraction[field].raw, extraction[field].evidence]) {
      const match = text === null ? null : findInstruction(text);
      if (match !== null) return { ...match, field };
    }
  }
  return null;
}
