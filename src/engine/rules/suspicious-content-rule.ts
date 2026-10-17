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
//
// The engine adds up the amount of each line itself (lineItemAmountsMinor): the reader only copies
// them, so a reader that skips or miscomputes the sum cannot hide an inflated total. When the invoice
// also prints a subtotal, it must equal that sum. Without line amounts, the printed subtotal is used.
export function evaluateSuspiciousContentRule(ctx: RuleContext): RuleResult {
  const { extraction, sourceText } = ctx.invoice;
  const { suspiciousText, lineItemsSumMinor } = extraction;
  const taxMinor = extraction.taxMinor ?? null;
  const sourceMatch = sourceText === null ? null : findInstruction(sourceText);
  const fieldMatch = findInstructionInFields(extraction);
  const lineItemAmounts = extraction.lineItemAmountsMinor ?? [];
  const summedItemsMinor = lineItemAmounts.length === 0 ? null : sumMinor(lineItemAmounts);
  const itemsTotalMinor = summedItemsMinor ?? lineItemsSumMinor;
  const isSubtotalMismatch =
    summedItemsMinor !== null &&
    lineItemsSumMinor !== null &&
    summedItemsMinor !== lineItemsSumMinor;
  const isTotalMismatch =
    itemsTotalMinor !== null &&
    ctx.amountMinor !== null &&
    BigInt(itemsTotalMinor) + BigInt(taxMinor ?? 0) !== BigInt(ctx.amountMinor);

  const compared = {
    readerFlagCount: suspiciousText.length,
    sourcePatternId: sourceMatch?.patternId ?? null,
    fieldWithInstruction: fieldMatch?.field ?? null,
    fieldPatternId: fieldMatch?.patternId ?? null,
    amountMinor: ctx.amountMinor,
    lineItemsSumMinor,
    lineItemCount: lineItemAmounts.length,
    summedItemsMinor,
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
    isSubtotalMismatch &&
      MESSAGES.suspiciousContent.subtotalMismatch(
        money(lineItemsSumMinor ?? 0),
        money(summedItemsMinor ?? 0),
      ),
    isTotalMismatch &&
      MESSAGES.suspiciousContent.totalMismatch(
        money(ctx.amountMinor ?? 0),
        money(itemsTotalMinor ?? 0),
        taxMinor === null ? null : money(taxMinor),
      ),
  ].filter((reason): reason is string => typeof reason === "string");

  if (reasons.length === 0) {
    return {
      ruleId: "R10",
      outcome: "PASS",
      message: passedMessage(itemsTotalMinor, ctx.amountMinor, taxMinor),
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
  itemsTotalMinor: number | null,
  amountMinor: number | null,
  taxMinor: number | null,
): string {
  const { passed } = MESSAGES.suspiciousContent;
  if (itemsTotalMinor === null) return passed.noLineItems;
  if (amountMinor === null) return passed.amountUnreadable;
  return taxMinor === null ? passed.matches : passed.matchesWithTax;
}

// Sums stay exact: a total beyond safe integers throws, and the runner escalates the rule.
function sumMinor(amounts: readonly number[]): number {
  const total = amounts.reduce((sum, amount) => sum + BigInt(amount), 0n);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Line item sum exceeds safe integer range");
  }
  return Number(total);
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
