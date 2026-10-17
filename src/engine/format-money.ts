// Formats minor units for the audit log in Spanish style: "USD 2.500,00" (dots group thousands, comma
// before cents). Integer arithmetic only; amounts are safe integers, so nothing is rounded.
export function formatMoney(amountMinor: number, currency: string): string {
  const sign = amountMinor < 0 ? "-" : "";
  const absolute = Math.abs(amountMinor);
  const units = String(Math.floor(absolute / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const cents = String(absolute % 100).padStart(2, "0");
  return `${currency} ${sign}${units},${cents}`;
}
