// WHDL v1.0 IR types — direct translation of WHDL_SPEC.md.
// Output-side types (SimulationResult, Effect, Diagnostic) live in a separate
// module since the parser does not consume them.

export const WHDL_VERSION = "1.0" as const;

// ─── Primitives ──────────────────────────────────────────────────────────

export type Cartesian = readonly [x: number, y: number];
export type Polar = readonly [r: number, theta: number];
export type ObjectRef = string;

// ─── Enums ───────────────────────────────────────────────────────────────

export const RUNE_KINDS = [
  "Fire", "Water", "Earth", "Wind", "Light",
  "WindUnderfoot", "Aeriforms", "Crystal",
] as const;
export type RuneKind = typeof RUNE_KINDS[number];

export const KEYSTONE_KINDS = [
  "Column", "Dispersion", "Levitation", "Pull", "Crush", "Float",
  "Direction", "Convergence", "Diamond", "Window", "Collection",
  "Crosshair", "Radial", "Bolt", "Billowing", "Eye", "Bend",
  "Repetition", "Vision", "Weave", "Enlarge", "Rain", "Bird",
  "DancingPuppet",
] as const;
export type KeystoneKind = typeof KEYSTONE_KINDS[number];

// Center-slot whitelist per spec.
export const CENTER_SLOT_WHITELIST: ReadonlySet<KeystoneKind> = new Set([
  "Repetition", "Billowing", "Vision", "Enlarge",
  "Rain", "Bird", "DancingPuppet", "Weave",
]);

export type LinkKind = "Amplify" | "Cancel";

// ─── Coherence + Extent ──────────────────────────────────────────────────

export interface Coherence {
  stroke: number;
  closure: number;
  placement: number;
  symmetry: number;
}

export interface Extent {
  major: number;
  minor: number;
}

// ─── Boundary (tagged union) ─────────────────────────────────────────────

export type Boundary =
  | { kind: "Circular"; radius: number }
  | { kind: "Elliptical"; major: number; minor: number }
  | { kind: "Polygonal"; vertices: Cartesian[] };

// ─── Sigil element (tagged union, identifier-only) ──────────────────────

export type SigilElement =
  | { kind: "Rune"; rune_kind: RuneKind }
  | { kind: "CenterKeystone"; keystone_kind: KeystoneKind };

// `Center` per spec — wrapper for a sigil placement.
export interface Center {
  element: SigilElement;
  offset: Polar;
  rotation: number;
  reversed: boolean;
  extent: Extent;
  coherence: Coherence;
}

// ─── Keystone (perimeter) ────────────────────────────────────────────────

export interface Keystone {
  kind: KeystoneKind;
  position: Polar;
  rotation: number;
  extent: Extent;
  reversed: boolean;
  coherence: Coherence;
}

// ─── Glyph ───────────────────────────────────────────────────────────────

export type GlyphId = string;

export interface Glyph {
  id: GlyphId;
  position: Cartesian;
  boundary: Boundary;
  rotation: number;
  coherence: Coherence;
  sigils: Center[];
  perimeter: Keystone[];
  children: Glyph[];
}

// ─── Link ────────────────────────────────────────────────────────────────

export interface Link {
  endpoints: readonly [GlyphId, GlyphId];
  kind: LinkKind;
}

// ─── Spell (top-level) ───────────────────────────────────────────────────

export interface Spell {
  whdl_version: string;
  target: ObjectRef | null;
  glyphs: Glyph[];
  links: Link[];
}
