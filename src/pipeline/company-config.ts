import { type RulesConfig, RulesConfigSchema } from "@/contracts/rules-config";

type Company = {
  company: { baseCurrency: string; timezone: string };
  budget: { amountMinor: number };
  approvalThresholdMinor: number;
  absoluteCap: { enabled: boolean; amountMinor: number | null };
  fx: { rates: Record<string, string> };
  rules: {
    R4_agreement: { toleranceMinor: number };
    R7_splitting: { windowDays: number };
    R9_dates: { maxOverdueDays: number; maxFutureDays: number };
  };
  beneficiaries: { name: string; status: "allowed" | "blocked" }[];
  agreements: {
    beneficiary: string;
    amountMinor: number;
    currency: string;
    validFrom: string;
    validTo: string | null;
  }[];
};

// data/config/company.json is C's description of the fictitious company; the engine reads it as a
// RulesConfig. The parse at the end rejects anything the mapping gets wrong.
export function toRulesConfig(company: Company): RulesConfig {
  const payeesWithStatus = (status: "allowed" | "blocked") =>
    company.beneficiaries.filter((b) => b.status === status).map((b) => b.name);
  return RulesConfigSchema.parse({
    baseCurrency: company.company.baseCurrency,
    timezone: company.company.timezone,
    exchangeRates: company.fx.rates,
    approvalThresholdMinor: company.approvalThresholdMinor,
    hardCapMinor: company.absoluteCap.enabled ? company.absoluteCap.amountMinor : null,
    monthlyBudgetMinor: company.budget.amountMinor,
    allowedPayees: payeesWithStatus("allowed"),
    blockedPayees: payeesWithStatus("blocked"),
    agreements: company.agreements.map((a) => ({
      payee: a.beneficiary,
      amountMinor: a.amountMinor,
      currency: a.currency,
      validFrom: a.validFrom,
      validUntil: a.validTo,
    })),
    toleranceMinor: company.rules.R4_agreement.toleranceMinor,
    splitPaymentWindowDays: company.rules.R7_splitting.windowDays,
    dueDatePolicy: {
      maxDaysOverdue: company.rules.R9_dates.maxOverdueDays,
      maxDaysAhead: company.rules.R9_dates.maxFutureDays,
    },
  });
}
