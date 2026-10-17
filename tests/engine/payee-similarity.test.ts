import { describe, expect, it } from "vitest";
import { isNearPayee, loosePayee } from "@/engine/rules/payee-similarity";

const CYRILLIC_A = String.fromCodePoint(0x0430);
const CYRILLIC_O = String.fromCodePoint(0x043e);
const GREEK_OMICRON = String.fromCodePoint(0x03bf);
const DOTLESS_I = String.fromCodePoint(0x0131);
const SCRIPT_G = String.fromCodePoint(0x0261);

describe("loosePayee", () => {
  it.each([
    ["Acmé Corp", "acmecorp"],
    ["A&B Corp", "abcorp"],
    ["Dev-Partners S.A.S.", "devpartnerssas"],
    [`${CYRILLIC_A}cme Corp`, "acmecorp"],
    [`Acme C${GREEK_OMICRON}rp`, "acmecorp"],
    [`${SCRIPT_G}lobex ${DOTLESS_I}nc`, "globexinc"],
  ])("loosens %j to %j", (name, expected) => {
    expect(loosePayee(name)).toBe(expected);
  });
});

describe("isNearPayee", () => {
  it.each([
    ["Acmé Corp", "Acme Corp", "an accent"],
    [`${CYRILLIC_A}cme Corp`, "Acme Corp", "a Cyrillic letter"],
    [`Acme C${CYRILLIC_O}rp`, "Acme Corp", "a Cyrillic o"],
    ["A&B Corp", "AB Corp", "a symbol"],
    ["Dev-Partners SAS", "Dev Partners SAS", "a dash"],
    ["Acme C0rp", "Acme Corp", "a zero instead of an O"],
    ["Acme Corpp", "Acme Corp", "an added letter"],
    ["Acme Cor", "Acme Corp", "a removed letter"],
    ["Old Vendor L.L.C", "Old Vendor LLC", "punctuation"],
  ])("finds %j near %j (%s)", (a, b) => {
    expect(isNearPayee(a, b)).toBe(true);
  });

  it.each([
    ["Shady LLC", "Dev Partners SAS"],
    ["Acme Corporation", "Acme Corp"],
    ["Acme Group", "Acme Corp"],
    ["Acme Crop", "Acme Corp"],
    ["...", "Acme Corp"],
  ])("does not find %j near %j", (a, b) => {
    expect(isNearPayee(a, b)).toBe(false);
  });
});
