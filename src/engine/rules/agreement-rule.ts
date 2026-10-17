import type { RuleResult } from "@/contracts/decision";
import { normalizePayee } from "@/contracts/payee";
import type { Agreement } from "@/contracts/rules-config";
import { formatMoney } from "../format-money";
import { MESSAGES } from "../messages";
import type { RuleContext } from "../rule-context";
import { isDateSupported } from "./extraction-evidence";

// R4: the invoice must match what was agreed with its payee (identical name). As in accounts payable,
// the agreement must be in force on the invoice's issue date, not on the processing date. Issued
// outside the agreement, in another currency or for more than agreed (plus tolerance, in the
// agreement's currency) -> BLOCK. No agreement, an unreadable issue date or less than agreed -> ESCALATE.
export function evaluateAgreementRule(ctx: RuleContext): RuleResult {
  const { payee, amountMinor, currency, issueDate } = ctx.invoice.extraction;
  const { agreements, toleranceMinor } = ctx.config;
  const compared: Record<string, string | number | null> = {
    payee: payee.value,
    issueDate: issueDate.value,
    amountMinor: amountMinor.value,
    currency: currency.value,
    agreedAmountMinor: null,
    agreedCurrency: null,
    validFrom: null,
    validUntil: null,
    toleranceMinor,
  };
  const result = (outcome: RuleResult["outcome"], message: string): RuleResult => ({
    ruleId: "R4",
    outcome,
    message,
    compared,
  });

  if (payee.value === null || payee.isUncertain) {
    return result("ESCALATE", MESSAGES.agreement.unreadable(MESSAGES.fieldLabels.payee));
  }

  const payeeAgreements = agreements.filter(
    (agreement) => normalizePayee(agreement.payee) === normalizePayee(payee.value ?? ""),
  );
  if (payeeAgreements.length === 0) {
    return result("ESCALATE", MESSAGES.agreement.none(payee.value));
  }

  const isIssueDateReadable =
    issueDate.value !== null &&
    !issueDate.isUncertain &&
    issueDate.evidence !== null &&
    isDateSupported(issueDate.value, issueDate.evidence);
  if (!isIssueDateReadable || issueDate.value === null) {
    return result("ESCALATE", MESSAGES.agreement.issueDateUnreadable);
  }

  const issuedOn = issueDate.value;
  const agreement = payeeAgreements.find((candidate) => isInForce(candidate, issuedOn));
  if (agreement === undefined) {
    const latest = latestAgreement(payeeAgreements);
    Object.assign(compared, { validFrom: latest.validFrom, validUntil: latest.validUntil });
    return result(
      "BLOCK",
      MESSAGES.agreement.outOfForce(issuedOn, latest.payee, latest.validFrom, latest.validUntil),
    );
  }
  Object.assign(compared, {
    agreedAmountMinor: agreement.amountMinor,
    agreedCurrency: agreement.currency,
    validFrom: agreement.validFrom,
    validUntil: agreement.validUntil,
  });

  if (amountMinor.value === null || amountMinor.isUncertain) {
    return result("ESCALATE", MESSAGES.agreement.unreadable(MESSAGES.fieldLabels.amountMinor));
  }
  if (currency.value === null || currency.isUncertain) {
    return result("ESCALATE", MESSAGES.agreement.unreadable(MESSAGES.fieldLabels.currency));
  }
  if (currency.value !== agreement.currency) {
    return result(
      "BLOCK",
      MESSAGES.agreement.currencyMismatch(currency.value, agreement.payee, agreement.currency),
    );
  }

  const differenceMinor = amountMinor.value - agreement.amountMinor;
  compared.differenceMinor = differenceMinor;
  const charged = formatMoney(amountMinor.value, agreement.currency);
  const agreed = formatMoney(agreement.amountMinor, agreement.currency);
  const tolerance = formatMoney(toleranceMinor, agreement.currency);

  if (differenceMinor > toleranceMinor) {
    return result(
      "BLOCK",
      MESSAGES.agreement.overAgreed(charged, agreement.payee, agreed, tolerance),
    );
  }
  if (differenceMinor < -toleranceMinor) {
    return result(
      "ESCALATE",
      MESSAGES.agreement.underAgreed(charged, agreement.payee, agreed, tolerance),
    );
  }
  return result("PASS", MESSAGES.agreement.matches(charged, agreement.payee, agreed, tolerance));
}

function isInForce(agreement: Agreement, isoDate: string): boolean {
  return (
    agreement.validFrom <= isoDate &&
    (agreement.validUntil === null || isoDate <= agreement.validUntil)
  );
}

function latestAgreement(agreements: readonly Agreement[]): Agreement {
  return agreements.reduce((latest, candidate) =>
    candidate.validFrom > latest.validFrom ? candidate : latest,
  );
}
