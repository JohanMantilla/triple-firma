import { describe, expect, it } from "vitest";
import { AuditVerificationSchema } from "@/contracts/audit-entry";
import { VALID_HASH } from "./fixtures";

describe("AuditVerificationSchema", () => {
  it("accepts an empty log", () => {
    const empty = { isValid: true, entryCount: 0, firstInvalidSeq: null, lastHash: null };
    expect(AuditVerificationSchema.safeParse(empty).success).toBe(true);
  });

  it("accepts a broken chain that names its first invalid entry", () => {
    const broken = { isValid: false, entryCount: 3, firstInvalidSeq: 2, lastHash: VALID_HASH };
    expect(AuditVerificationSchema.safeParse(broken).success).toBe(true);
  });

  it("rejects a valid chain that names an invalid entry", () => {
    const wrong = { isValid: true, entryCount: 3, firstInvalidSeq: 2, lastHash: VALID_HASH };
    expect(AuditVerificationSchema.safeParse(wrong).success).toBe(false);
  });

  it("rejects entries without a last hash", () => {
    const wrong = { isValid: true, entryCount: 1, firstInvalidSeq: null, lastHash: null };
    expect(AuditVerificationSchema.safeParse(wrong).success).toBe(false);
  });
});
