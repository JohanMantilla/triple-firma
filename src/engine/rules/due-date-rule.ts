import type { RuleResult } from "@/contracts/decision";
import { MESSAGES } from "../messages";
import { type RuleContext, toLocalDate } from "../rule-context";

const MS_PER_DAY = 86_400_000;

// R9: the due date must not be overdue by more than maxDaysOverdue nor further ahead than
// maxDaysAhead. "Today" is the injected now in the company's time zone, and whole calendar days are
// compared, so daylight-saving changes never shift the result by a day. Impossible dates such as
// 2026-02-30 never get here: the extraction contract rejects them.
export function evaluateDueDateRule(ctx: RuleContext): RuleResult {
  const { value: dueDate, isUncertain } = ctx.invoice.extraction.dueDate;
  const { maxDaysOverdue, maxDaysAhead } = ctx.config.dueDatePolicy;
  const today = toLocalDate(ctx.now, ctx.config.timezone);
  const daysUntilDue = dueDate === null ? null : daysBetween(today, dueDate);
  const compared = { dueDate, today, daysUntilDue, maxDaysOverdue, maxDaysAhead };

  const escalate = (message: string): RuleResult => ({
    ruleId: "R9",
    outcome: "ESCALATE",
    message,
    compared,
  });

  if (dueDate === null || daysUntilDue === null || isUncertain) {
    return escalate(MESSAGES.dueDate.unreadable);
  }
  if (daysUntilDue < -maxDaysOverdue) {
    return escalate(MESSAGES.dueDate.tooOverdue(dueDate, -daysUntilDue, maxDaysOverdue));
  }
  if (daysUntilDue > maxDaysAhead) {
    return escalate(MESSAGES.dueDate.tooFarAhead(dueDate, daysUntilDue, maxDaysAhead));
  }
  return {
    ruleId: "R9",
    outcome: "PASS",
    message: MESSAGES.dueDate.withinPolicy(dueDate, daysUntilDue),
    compared,
  };
}

// Whole calendar days from one "YYYY-MM-DD" to another.
function daysBetween(from: string, to: string): number {
  return (toUtcMidnight(to) - toUtcMidnight(from)) / MS_PER_DAY;
}

// setUTCFullYear, unlike Date.UTC, keeps years 0-99 as they are instead of mapping them to 1900-1999.
function toUtcMidnight(isoDate: string): number {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getTime();
}
