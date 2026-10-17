import { z } from "zod";

export const IsoDateSchema = z.iso.date();

// Stored timestamps are always UTC ("...Z"), so comparing or sorting them as strings is correct.
// The period of a timestamp is computed with the configured time zone, never from its offset.
export const IsoDateTimeSchema = z.iso.datetime();

export const PeriodSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Period must look like 2026-10");
export type Period = z.infer<typeof PeriodSchema>;

export const TimezoneSchema = z.string().refine(isValidTimezone, "Must be an IANA time zone");

function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}
