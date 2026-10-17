import type { RuleResult } from "@/contracts/decision";
import { isSupportedCurrency } from "@/contracts/money";
import { formatMoney } from "../format-money";
import { MESSAGES } from "../messages";
import type { RuleContext } from "../rule-context";

// R8: the invoice currency must be readable, supported and configured with a fixed rate, and the
// conversion to the base currency must succeed. An unreadable amount is R1's and R5's concern.
export function evaluateCurrencyRule(ctx: RuleContext): RuleResult {
  const { currency, config, baseAmountMinor } = ctx;
  const { currency: currencyField, amountMinor: amountField } = ctx.invoice.extraction;
  const configuredRate =
    currency !== null && isSupportedCurrency(currency) ? config.exchangeRates[currency] : undefined;
  const compared = { currency, exchangeRate: configuredRate ?? null, baseAmountMinor };

  const escalate = (message: string): RuleResult => ({
    ruleId: "R8",
    outcome: "ESCALATE",
    message,
    compared,
  });

  if (currency === null || currencyField.isUncertain) return escalate(MESSAGES.currency.unreadable);
  if (!isSupportedCurrency(currency)) return escalate(MESSAGES.currency.unsupported(currency));
  if (configuredRate === undefined) return escalate(MESSAGES.currency.withoutRate(currency));

  const isAmountReadable = amountField.value !== null && !amountField.isUncertain;
  if (isAmountReadable && baseAmountMinor === null) {
    return escalate(MESSAGES.currency.conversionFailed(currency));
  }

  return {
    ruleId: "R8",
    outcome: "PASS",
    message:
      baseAmountMinor === null
        ? MESSAGES.currency.supported(currency, configuredRate)
        : MESSAGES.currency.converted(
            currency,
            configuredRate,
            formatMoney(baseAmountMinor, config.baseCurrency),
          ),
    compared,
  };
}
