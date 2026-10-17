import { z } from "zod";

export const IsoDateSchema = z.iso.date();

export const IsoDateTimeSchema = z.iso.datetime({ offset: true });

export const TimezoneSchema = z.string().refine(isValidTimezone, "Must be an IANA time zone");

function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}
