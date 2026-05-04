// JSON → IR shape parser.
// Throws ParseError on structural problems (wrong type, missing required field).
// Semantic validation (per the spec's Validation rules) lives in validate.ts.

import {
  type Boundary, type Cartesian, type Center, type Coherence,
  type Extent, type Glyph, type Keystone, type KeystoneKind,
  type Link, type Polar, type RuneKind, type SigilElement, type Spell,
  KEYSTONE_KINDS, RUNE_KINDS, WHDL_VERSION,
} from "../model/types.js";

export class ParseError extends Error {
  constructor(message: string, public readonly path: string) {
    super(`${path}: ${message}`);
    this.name = "ParseError";
  }
}

// ─── Walker with path tracking ───────────────────────────────────────────

class P {
  constructor(public readonly path: string) {}
  child(seg: string | number): P {
    return new P(typeof seg === "number" ? `${this.path}[${seg}]` : `${this.path}.${seg}`);
  }
  fail(msg: string): never {
    throw new ParseError(msg, this.path);
  }
}

// ─── Shape helpers ───────────────────────────────────────────────────────

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function expectObject(p: P, v: unknown): Record<string, unknown> {
  if (!isObject(v)) p.fail(`expected object, got ${describe(v)}`);
  return v;
}

function expectArray(p: P, v: unknown): unknown[] {
  if (!Array.isArray(v)) p.fail(`expected array, got ${describe(v)}`);
  return v;
}

function expectFiniteNumber(p: P, v: unknown): number {
  if (typeof v !== "number") p.fail(`expected number, got ${describe(v)}`);
  if (!Number.isFinite(v)) p.fail(`expected finite number, got ${v}`);
  return v;
}

function expectString(p: P, v: unknown): string {
  if (typeof v !== "string") p.fail(`expected string, got ${describe(v)}`);
  return v;
}

function expectBoolean(p: P, v: unknown): boolean {
  if (typeof v !== "boolean") p.fail(`expected boolean, got ${describe(v)}`);
  return v;
}

function describe(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function expectKnownKeys(p: P, obj: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(obj)) {
    if (!allowedSet.has(key)) p.fail(`unexpected field "${key}" (allowed: ${allowed.join(", ")})`);
  }
}

function expectRequired(p: P, obj: Record<string, unknown>, keys: readonly string[]): void {
  for (const key of keys) {
    if (!(key in obj)) p.fail(`missing required field "${key}"`);
  }
}

// ─── Field-type helpers ──────────────────────────────────────────────────

function parseCartesian(p: P, v: unknown): Cartesian {
  const arr = expectArray(p, v);
  if (arr.length !== 2) p.fail(`expected [x, y], got array of length ${arr.length}`);
  return [expectFiniteNumber(p.child(0), arr[0]), expectFiniteNumber(p.child(1), arr[1])];
}

function parsePolar(p: P, v: unknown): Polar {
  const arr = expectArray(p, v);
  if (arr.length !== 2) p.fail(`expected [r, theta], got array of length ${arr.length}`);
  return [expectFiniteNumber(p.child(0), arr[0]), expectFiniteNumber(p.child(1), arr[1])];
}

function parseCoherence(p: P, v: unknown): Coherence {
  const obj = expectObject(p, v);
  expectRequired(p, obj, ["stroke", "closure", "placement", "symmetry"]);
  expectKnownKeys(p, obj, ["stroke", "closure", "placement", "symmetry"]);
  return {
    stroke: expectFiniteNumber(p.child("stroke"), obj["stroke"]),
    closure: expectFiniteNumber(p.child("closure"), obj["closure"]),
    placement: expectFiniteNumber(p.child("placement"), obj["placement"]),
    symmetry: expectFiniteNumber(p.child("symmetry"), obj["symmetry"]),
  };
}

function parseExtent(p: P, v: unknown): Extent {
  const obj = expectObject(p, v);
  expectRequired(p, obj, ["major", "minor"]);
  expectKnownKeys(p, obj, ["major", "minor"]);
  return {
    major: expectFiniteNumber(p.child("major"), obj["major"]),
    minor: expectFiniteNumber(p.child("minor"), obj["minor"]),
  };
}

// ─── Boundary ────────────────────────────────────────────────────────────

function parseBoundary(p: P, v: unknown): Boundary {
  const obj = expectObject(p, v);
  const kind = expectString(p.child("kind"), obj["kind"]);
  switch (kind) {
    case "Circular":
      expectKnownKeys(p, obj, ["kind", "radius"]);
      expectRequired(p, obj, ["radius"]);
      return { kind: "Circular", radius: expectFiniteNumber(p.child("radius"), obj["radius"]) };
    case "Elliptical":
      expectKnownKeys(p, obj, ["kind", "major", "minor"]);
      expectRequired(p, obj, ["major", "minor"]);
      return {
        kind: "Elliptical",
        major: expectFiniteNumber(p.child("major"), obj["major"]),
        minor: expectFiniteNumber(p.child("minor"), obj["minor"]),
      };
    case "Polygonal": {
      expectKnownKeys(p, obj, ["kind", "vertices"]);
      expectRequired(p, obj, ["vertices"]);
      const verts = expectArray(p.child("vertices"), obj["vertices"]);
      return {
        kind: "Polygonal",
        vertices: verts.map((vert, i) => parseCartesian(p.child("vertices").child(i), vert)),
      };
    }
    default:
      throw new ParseError(`unknown Boundary kind "${kind}"`, p.child("kind").path);
  }
}

// ─── Sigil element + Center ──────────────────────────────────────────────

function parseSigilElement(p: P, v: unknown): SigilElement {
  const obj = expectObject(p, v);
  const kind = expectString(p.child("kind"), obj["kind"]);
  if (kind === "Rune") {
    expectKnownKeys(p, obj, ["kind", "rune_kind"]);
    expectRequired(p, obj, ["rune_kind"]);
    const rk = expectString(p.child("rune_kind"), obj["rune_kind"]);
    if (!(RUNE_KINDS as readonly string[]).includes(rk)) {
      p.child("rune_kind").fail(`unknown RuneKind "${rk}"`);
    }
    return { kind: "Rune", rune_kind: rk as RuneKind };
  }
  if (kind === "CenterKeystone") {
    expectKnownKeys(p, obj, ["kind", "keystone_kind"]);
    expectRequired(p, obj, ["keystone_kind"]);
    const kk = expectString(p.child("keystone_kind"), obj["keystone_kind"]);
    if (!(KEYSTONE_KINDS as readonly string[]).includes(kk)) {
      p.child("keystone_kind").fail(`unknown KeystoneKind "${kk}"`);
    }
    return { kind: "CenterKeystone", keystone_kind: kk as KeystoneKind };
  }
  throw new ParseError(`unknown sigil element kind "${kind}" (expected Rune | CenterKeystone)`, p.child("kind").path);
}

function parseCenter(p: P, v: unknown): Center {
  const obj = expectObject(p, v);
  expectKnownKeys(p, obj, ["element", "offset", "rotation", "reversed", "extent", "coherence"]);
  expectRequired(p, obj, ["element", "offset", "rotation", "reversed", "extent", "coherence"]);
  return {
    element: parseSigilElement(p.child("element"), obj["element"]),
    offset: parsePolar(p.child("offset"), obj["offset"]),
    rotation: expectFiniteNumber(p.child("rotation"), obj["rotation"]),
    reversed: expectBoolean(p.child("reversed"), obj["reversed"]),
    extent: parseExtent(p.child("extent"), obj["extent"]),
    coherence: parseCoherence(p.child("coherence"), obj["coherence"]),
  };
}

// ─── Keystone ────────────────────────────────────────────────────────────

function parseKeystone(p: P, v: unknown): Keystone {
  const obj = expectObject(p, v);
  expectKnownKeys(p, obj, ["kind", "position", "rotation", "extent", "reversed", "coherence"]);
  expectRequired(p, obj, ["kind", "position", "rotation", "extent", "reversed", "coherence"]);
  const kind = expectString(p.child("kind"), obj["kind"]);
  if (!(KEYSTONE_KINDS as readonly string[]).includes(kind)) {
    p.child("kind").fail(`unknown KeystoneKind "${kind}"`);
  }
  return {
    kind: kind as KeystoneKind,
    position: parsePolar(p.child("position"), obj["position"]),
    rotation: expectFiniteNumber(p.child("rotation"), obj["rotation"]),
    extent: parseExtent(p.child("extent"), obj["extent"]),
    reversed: expectBoolean(p.child("reversed"), obj["reversed"]),
    coherence: parseCoherence(p.child("coherence"), obj["coherence"]),
  };
}

// ─── Glyph ───────────────────────────────────────────────────────────────

function parseGlyph(p: P, v: unknown): Glyph {
  const obj = expectObject(p, v);
  expectKnownKeys(p, obj, [
    "id", "position", "boundary", "rotation", "coherence",
    "sigils", "perimeter", "children",
  ]);
  expectRequired(p, obj, [
    "id", "position", "boundary", "rotation", "coherence",
    "sigils", "perimeter", "children",
  ]);
  return {
    id: expectString(p.child("id"), obj["id"]),
    position: parseCartesian(p.child("position"), obj["position"]),
    boundary: parseBoundary(p.child("boundary"), obj["boundary"]),
    rotation: expectFiniteNumber(p.child("rotation"), obj["rotation"]),
    coherence: parseCoherence(p.child("coherence"), obj["coherence"]),
    sigils: expectArray(p.child("sigils"), obj["sigils"]).map(
      (s, i) => parseCenter(p.child("sigils").child(i), s),
    ),
    perimeter: expectArray(p.child("perimeter"), obj["perimeter"]).map(
      (k, i) => parseKeystone(p.child("perimeter").child(i), k),
    ),
    children: expectArray(p.child("children"), obj["children"]).map(
      (g, i) => parseGlyph(p.child("children").child(i), g),
    ),
  };
}

// ─── Link ────────────────────────────────────────────────────────────────

function parseLink(p: P, v: unknown): Link {
  const obj = expectObject(p, v);
  expectKnownKeys(p, obj, ["endpoints", "kind"]);
  expectRequired(p, obj, ["endpoints", "kind"]);
  const eps = expectArray(p.child("endpoints"), obj["endpoints"]);
  if (eps.length !== 2) p.child("endpoints").fail(`expected [GlyphId, GlyphId], got array of length ${eps.length}`);
  const kindStr = expectString(p.child("kind"), obj["kind"]);
  if (kindStr !== "Amplify" && kindStr !== "Cancel") {
    throw new ParseError(`unknown Link kind "${kindStr}" (expected Amplify | Cancel)`, p.child("kind").path);
  }
  return {
    endpoints: [
      expectString(p.child("endpoints").child(0), eps[0]),
      expectString(p.child("endpoints").child(1), eps[1]),
    ],
    kind: kindStr,
  };
}

// ─── Top-level ───────────────────────────────────────────────────────────

export function parse(input: unknown): Spell {
  const p = new P("$");
  const obj = expectObject(p, input);
  expectKnownKeys(p, obj, ["whdl_version", "target", "glyphs", "links"]);
  expectRequired(p, obj, ["whdl_version", "glyphs", "links"]);

  const version = expectString(p.child("whdl_version"), obj["whdl_version"]);
  if (version !== WHDL_VERSION) {
    p.child("whdl_version").fail(`unsupported version "${version}" (this parser supports "${WHDL_VERSION}")`);
  }

  let target: string | null;
  if (!("target" in obj) || obj["target"] === null) {
    target = null;
  } else {
    target = expectString(p.child("target"), obj["target"]);
  }

  return {
    whdl_version: version,
    target,
    glyphs: expectArray(p.child("glyphs"), obj["glyphs"]).map(
      (g, i) => parseGlyph(p.child("glyphs").child(i), g),
    ),
    links: expectArray(p.child("links"), obj["links"]).map(
      (l, i) => parseLink(p.child("links").child(i), l),
    ),
  };
}
