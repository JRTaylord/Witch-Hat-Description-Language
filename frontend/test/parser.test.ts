import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { parse, ParseError } from "../src/serialize/parse.js";
import { validate } from "../src/serialize/validate.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(HERE, "fixtures", `${name}.json`), "utf8"));

// Deep clone so individual tests can mutate without polluting other tests.
const load = (name: string): any => structuredClone(fixture(name));

// ─── Positive: parse + validate the worked-example fixtures ──────────────

describe("parse + validate (canonical fixtures)", () => {
  for (const name of [
    "pyreball",
    "dada-mountains",
    "preserve-food",
    "mixed-spell",
    "linked-amplification",
    "empty-spell",
  ]) {
    test(`${name} parses cleanly and validates`, () => {
      const parsed = parse(fixture(name));
      const result = validate(parsed);
      expect(result.errors).toEqual([]);
      expect(result.ok).toBe(true);
    });
  }

  test("preserve-food carries target = bread_loaf", () => {
    const parsed = parse(fixture("preserve-food"));
    expect(parsed.target).toBe("bread_loaf");
  });

  test("mixed-spell has two sigils", () => {
    const parsed = parse(fixture("mixed-spell"));
    expect(parsed.glyphs[0]!.sigils).toHaveLength(2);
    expect(parsed.glyphs[0]!.sigils[0]!.element).toEqual({ kind: "Rune", rune_kind: "Fire" });
    expect(parsed.glyphs[0]!.sigils[1]!.element).toEqual({ kind: "Rune", rune_kind: "Water" });
  });
});

// ─── Negative: parse() rejects shape errors ──────────────────────────────

describe("parse() — shape errors", () => {
  test("rejects unsupported version", () => {
    const doc = load("pyreball");
    doc.whdl_version = "2.0";
    expect(() => parse(doc)).toThrow(/unsupported version/);
  });

  test("rejects missing version", () => {
    const doc = load("pyreball");
    delete doc.whdl_version;
    expect(() => parse(doc)).toThrow(/missing required field "whdl_version"/);
  });

  test("rejects missing required glyph field", () => {
    const doc = load("pyreball");
    delete doc.glyphs[0].coherence;
    expect(() => parse(doc)).toThrow(/missing required field "coherence"/);
  });

  test("rejects wrong type", () => {
    const doc = load("pyreball");
    doc.glyphs[0].rotation = "spinny";
    expect(() => parse(doc)).toThrow(/expected number/);
  });

  test("rejects NaN in number field", () => {
    const doc = load("pyreball");
    doc.glyphs[0].coherence.stroke = Number.NaN;
    expect(() => parse(doc)).toThrow(/expected finite number/);
  });

  test("rejects unknown top-level field", () => {
    const doc = load("pyreball");
    doc.surprise = 42;
    expect(() => parse(doc)).toThrow(/unexpected field "surprise"/);
  });

  test("rejects unknown rune kind", () => {
    const doc = load("pyreball");
    doc.glyphs[0].sigils[0].element.rune_kind = "Plasma";
    expect(() => parse(doc)).toThrow(/unknown RuneKind "Plasma"/);
  });

  test("rejects unknown boundary kind", () => {
    const doc = load("pyreball");
    doc.glyphs[0].boundary = { kind: "Hexagonal" };
    expect(() => parse(doc)).toThrow(/unknown Boundary kind "Hexagonal"/);
  });

  test("error path points at the offending location", () => {
    const doc = load("pyreball");
    doc.glyphs[0].sigils[0].coherence.placement = "high";
    try {
      parse(doc);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      expect((e as ParseError).path).toBe("$.glyphs[0].sigils[0].coherence.placement");
    }
  });
});

// ─── Negative: validate() catches semantic errors ────────────────────────

describe("validate() — semantic errors", () => {
  test("duplicate GlyphId (rule 3, also covers rule 10)", () => {
    const doc = load("linked-amplification");
    doc.glyphs[1].id = "g1";
    // Also fix up the link so it doesn't add a separate complaint.
    doc.links[0].endpoints = ["g1", "g1"];
    const result = validate(parse(doc));
    expect(result.ok).toBe(false);
    expect(result.errors.map(e => e.code)).toContain("DuplicateGlyphId");
  });

  test("empty sigils (rule 4)", () => {
    const doc = load("pyreball");
    doc.glyphs[0].sigils = [];
    const result = validate(parse(doc));
    expect(result.errors.map(e => e.code)).toContain("EmptySigils");
  });

  test("coherence out of [0, 1] (rule 6)", () => {
    const doc = load("pyreball");
    doc.glyphs[0].coherence.stroke = 1.5;
    const result = validate(parse(doc));
    const codes = result.errors.map(e => e.code);
    expect(codes).toContain("CoherenceOutOfRange");
  });

  test("extent non-positive (rule 7)", () => {
    const doc = load("pyreball");
    doc.glyphs[0].sigils[0].extent.major = 0;
    const result = validate(parse(doc));
    expect(result.errors.map(e => e.code)).toContain("ExtentNonPositive");
  });

  test("circular boundary radius non-positive (rule 8)", () => {
    const doc = load("pyreball");
    doc.glyphs[0].boundary.radius = -1;
    const result = validate(parse(doc));
    expect(result.errors.map(e => e.code)).toContain("BoundaryNonPositive");
  });

  test("polygon with too few vertices (rule 8)", () => {
    const doc = load("pyreball");
    doc.glyphs[0].boundary = { kind: "Polygonal", vertices: [[0, 0], [1, 0]] };
    const result = validate(parse(doc));
    expect(result.errors.map(e => e.code)).toContain("PolygonTooFewVertices");
  });

  test("polygon wound clockwise (rule 8)", () => {
    const doc = load("pyreball");
    // Square wound CW under +y-up: (1,0) -> (0,0) -> (0,1) -> (1,1)
    doc.glyphs[0].boundary = {
      kind: "Polygonal",
      vertices: [[1, 0], [0, 0], [0, 1], [1, 1]],
    };
    const result = validate(parse(doc));
    expect(result.errors.map(e => e.code)).toContain("PolygonClockwise");
  });

  test("polygon wound counter-clockwise is accepted", () => {
    const doc = load("pyreball");
    // Same square CCW: (0,0) -> (1,0) -> (1,1) -> (0,1)
    doc.glyphs[0].boundary = {
      kind: "Polygonal",
      vertices: [[0, 0], [1, 0], [1, 1], [0, 1]],
    };
    const result = validate(parse(doc));
    expect(result.errors).toEqual([]);
  });

  test("link self-loop (rule 9)", () => {
    const doc = load("linked-amplification");
    doc.links[0].endpoints = ["g1", "g1"];
    const result = validate(parse(doc));
    expect(result.errors.map(e => e.code)).toContain("LinkSelfLoop");
  });

  test("link references non-existent glyph (rule 2)", () => {
    const doc = load("linked-amplification");
    doc.links[0].endpoints = ["g1", "g_nope"];
    const result = validate(parse(doc));
    expect(result.errors.map(e => e.code)).toContain("LinkUnresolvedEndpoint");
  });

  test("CenterKeystone not in whitelist (rule 5)", () => {
    const doc = load("preserve-food");
    doc.glyphs[0].sigils[0].element.keystone_kind = "Column";
    const result = validate(parse(doc));
    expect(result.errors.map(e => e.code)).toContain("CenterKeystoneNotEligible");
  });

  test("invalid GlyphId format (rule 3)", () => {
    const doc = load("pyreball");
    doc.glyphs[0].id = "g 1!"; // space and ! both illegal
    const result = validate(parse(doc));
    expect(result.errors.map(e => e.code)).toContain("InvalidGlyphId");
  });

  test("collect-all behavior: many errors surface in one pass", () => {
    const doc = load("pyreball");
    doc.glyphs[0].sigils = []; // empty sigils
    doc.glyphs[0].coherence.stroke = 2.0; // out of range
    doc.glyphs[0].boundary.radius = -1; // non-positive
    const result = validate(parse(doc));
    const codes = new Set(result.errors.map(e => e.code));
    expect(codes).toContain("EmptySigils");
    expect(codes).toContain("CoherenceOutOfRange");
    expect(codes).toContain("BoundaryNonPositive");
  });
});
