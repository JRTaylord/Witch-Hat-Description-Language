// Semantic validator for parsed WHDL Spells.
// Implements the spec's Validation rules. Accumulates errors instead of
// failing fast — callers see the full picture in one pass.
//
// What this does NOT check:
//   - whdl_version (parse() rejects unsupported versions outright)
//   - NaN/Infinity in numbers (parse() already rejects)
//   - ObjectRef resolution: ObjectRefs point into the simulator's scene
//     registry, which WHDL has no view of. Resolution is the simulator's job.

import {
  CENTER_SLOT_WHITELIST,
  type Boundary, type Cartesian, type Center, type Coherence,
  type Glyph, type Keystone, type Spell,
} from "../model/types.js";

export interface ValidationError {
  code: string;
  message: string;
  path: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
}

const ID_REGEX = /^[A-Za-z0-9_-]+$/;
const ID_MAX_LEN = 64;

class V {
  readonly errors: ValidationError[] = [];
  readonly seenIds = new Set<string>();
  add(code: string, path: string, message: string): void {
    this.errors.push({ code, message, path });
  }
}

// ─── Top-level ───────────────────────────────────────────────────────────

export function validate(spell: Spell): ValidationResult {
  const v = new V();

  for (let i = 0; i < spell.glyphs.length; i++) {
    validateGlyph(v, spell.glyphs[i]!, `$.glyphs[${i}]`);
  }

  for (let i = 0; i < spell.links.length; i++) {
    validateLink(v, spell.links[i]!, v.seenIds, `$.links[${i}]`);
  }

  return { ok: v.errors.length === 0, errors: v.errors };
}

// ─── Glyph (recursive) ───────────────────────────────────────────────────

function validateGlyph(v: V, g: Glyph, path: string): void {
  // Rule 3: GlyphId format + uniqueness
  if (g.id.length === 0 || g.id.length > ID_MAX_LEN || !ID_REGEX.test(g.id)) {
    v.add("InvalidGlyphId", `${path}.id`,
      `GlyphId "${g.id}" must be non-empty ASCII, ≤${ID_MAX_LEN} chars, matching ${ID_REGEX}`);
  }
  if (v.seenIds.has(g.id)) {
    // Rule 3 (uniqueness) also covers Rule 10 (forest shape).
    v.add("DuplicateGlyphId", `${path}.id`,
      `GlyphId "${g.id}" already used elsewhere in this Spell (must be globally unique; this also enforces tree-shaped nesting)`);
  } else {
    v.seenIds.add(g.id);
  }

  // Rule 6: glyph coherence in [0, 1]
  validateCoherence(v, g.coherence, `${path}.coherence`);

  // Rule 8: boundary
  validateBoundary(v, g.boundary, `${path}.boundary`);

  // Rule 4: at least one sigil
  if (g.sigils.length === 0) {
    v.add("EmptySigils", `${path}.sigils`,
      "every Glyph must have at least one sigil; empty sigil list is not valid");
  }
  for (let i = 0; i < g.sigils.length; i++) {
    validateCenter(v, g.sigils[i]!, `${path}.sigils[${i}]`);
  }

  for (let i = 0; i < g.perimeter.length; i++) {
    validateKeystone(v, g.perimeter[i]!, `${path}.perimeter[${i}]`);
  }

  for (let i = 0; i < g.children.length; i++) {
    validateGlyph(v, g.children[i]!, `${path}.children[${i}]`);
  }
}

// ─── Center / Sigil ──────────────────────────────────────────────────────

function validateCenter(v: V, c: Center, path: string): void {
  // Rule 5: CenterKeystone whitelist
  if (c.element.kind === "CenterKeystone" && !CENTER_SLOT_WHITELIST.has(c.element.keystone_kind)) {
    v.add("CenterKeystoneNotEligible", `${path}.element.keystone_kind`,
      `keystone "${c.element.keystone_kind}" is not in the center-slot whitelist`);
  }

  // Rule 7: extent positive
  validateExtent(v, c.extent, `${path}.extent`);

  // Rule 6: coherence in [0, 1]
  validateCoherence(v, c.coherence, `${path}.coherence`);
}

// ─── Keystone ────────────────────────────────────────────────────────────

function validateKeystone(v: V, k: Keystone, path: string): void {
  validateExtent(v, k.extent, `${path}.extent`);
  validateCoherence(v, k.coherence, `${path}.coherence`);
}

// ─── Coherence (rule 6) ──────────────────────────────────────────────────

function validateCoherence(v: V, c: Coherence, path: string): void {
  for (const [field, val] of Object.entries(c)) {
    if (val < 0 || val > 1) {
      v.add("CoherenceOutOfRange", `${path}.${field}`,
        `coherence component must be in [0, 1], got ${val}`);
    }
  }
}

// ─── Extent (rule 7) ─────────────────────────────────────────────────────

function validateExtent(v: V, e: { major: number; minor: number }, path: string): void {
  if (!(e.major > 0)) {
    v.add("ExtentNonPositive", `${path}.major`,
      `extent.major must be positive, got ${e.major}`);
  }
  if (!(e.minor > 0)) {
    v.add("ExtentNonPositive", `${path}.minor`,
      `extent.minor must be positive, got ${e.minor}`);
  }
}

// ─── Boundary (rule 8) ───────────────────────────────────────────────────

function validateBoundary(v: V, b: Boundary, path: string): void {
  switch (b.kind) {
    case "Circular":
      if (!(b.radius > 0)) {
        v.add("BoundaryNonPositive", `${path}.radius`,
          `Circular.radius must be positive, got ${b.radius}`);
      }
      return;
    case "Elliptical":
      if (!(b.major > 0)) {
        v.add("BoundaryNonPositive", `${path}.major`,
          `Elliptical.major must be positive, got ${b.major}`);
      }
      if (!(b.minor > 0)) {
        v.add("BoundaryNonPositive", `${path}.minor`,
          `Elliptical.minor must be positive, got ${b.minor}`);
      }
      return;
    case "Polygonal": {
      if (b.vertices.length < 3) {
        v.add("PolygonTooFewVertices", `${path}.vertices`,
          `Polygonal.vertices needs ≥3 entries, got ${b.vertices.length}`);
        return;
      }
      const area = signedArea(b.vertices);
      if (area === 0) {
        v.add("PolygonDegenerate", `${path}.vertices`,
          "Polygonal vertices form a degenerate (zero-area) polygon");
      } else if (area < 0) {
        v.add("PolygonClockwise", `${path}.vertices`,
          "Polygonal.vertices must be wound counter-clockwise (under +y-up convention); got clockwise");
      }
      return;
    }
  }
}

// Shoelace formula. Under +y-up: CCW gives positive area, CW gives negative.
function signedArea(verts: readonly Cartesian[]): number {
  let sum = 0;
  for (let i = 0; i < verts.length; i++) {
    const [x1, y1] = verts[i]!;
    const [x2, y2] = verts[(i + 1) % verts.length]!;
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

// ─── Link (rules 2, 9) ───────────────────────────────────────────────────

function validateLink(
  v: V,
  link: { endpoints: readonly [string, string]; kind: string },
  knownIds: ReadonlySet<string>,
  path: string,
): void {
  const [a, b] = link.endpoints;
  // Rule 9: distinct
  if (a === b) {
    v.add("LinkSelfLoop", `${path}.endpoints`,
      `Link endpoints must reference distinct glyphs (both reference "${a}")`);
  }
  // Rule 2: references resolve
  if (!knownIds.has(a)) {
    v.add("LinkUnresolvedEndpoint", `${path}.endpoints[0]`,
      `Link endpoint "${a}" does not resolve to any glyph in this Spell`);
  }
  if (!knownIds.has(b)) {
    v.add("LinkUnresolvedEndpoint", `${path}.endpoints[1]`,
      `Link endpoint "${b}" does not resolve to any glyph in this Spell`);
  }
}
