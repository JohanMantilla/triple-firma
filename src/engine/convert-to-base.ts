import type { ExchangeRate } from "@/contracts/money";

// Converts an amount in minor units of any supported currency to minor units of the base currency.
// The rate is "units per 1 base unit" as an exact decimal string, so the conversion is the exact
// fraction amountMinor / rate, computed with BigInt and rounded once to the cent, half up.
// Returns null when the result does not fit in a safe integer: the calling rule must escalate.
export function convertToBaseMinor(amountMinor: number, exchangeRate: ExchangeRate): number | null {
  const { numerator, denominator } = parseExchangeRate(exchangeRate);
  const exact = BigInt(amountMinor) * denominator;
  const rounded = (2n * exact + numerator) / (2n * numerator);
  return rounded <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(rounded) : null;
}

// "18.50" -> 1850 / 100. The schema guarantees a positive plain decimal string.
function parseExchangeRate(exchangeRate: ExchangeRate): { numerator: bigint; denominator: bigint } {
  const [integerPart, fractionPart = ""] = exchangeRate.split(".");
  return {
    numerator: BigInt(integerPart + fractionPart),
    denominator: 10n ** BigInt(fractionPart.length),
  };
}
