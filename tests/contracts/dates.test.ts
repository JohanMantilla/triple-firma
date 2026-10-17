import { describe, expect, it } from "vitest";
import { IsoDateTimeSchema, PeriodSchema } from "@/contracts/dates";

describe("IsoDateTimeSchema", () => {
  it.each(["2026-10-17T14:00:00Z", "2026-10-17T14:00:00.123Z"])(
    "accepts the UTC timestamp %s",
    (value) => {
      expect(IsoDateTimeSchema.safeParse(value).success).toBe(true);
    },
  );

  it.each(["2026-10-17T10:00:00-04:00", "2026-10-17T14:00:00", "2026-10-17"])(
    "rejects %s, which is not UTC",
    (value) => {
      expect(IsoDateTimeSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe("PeriodSchema", () => {
  it.each(["2026-01", "2026-10", "2026-12"])("accepts %s", (period) => {
    expect(PeriodSchema.safeParse(period).success).toBe(true);
  });

  it.each(["2026-00", "2026-13", "2026-1", "202610", "2026-10-01"])("rejects %s", (period) => {
    expect(PeriodSchema.safeParse(period).success).toBe(false);
  });
});
