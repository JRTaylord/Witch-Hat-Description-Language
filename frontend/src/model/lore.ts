// Read-only canonical metadata for runes and keystones — the frontend copy of
// the backend's keystone-metadata table (WHDL_SPEC.md §Keystone metadata,
// §Implementation notes). Lore blurbs are grounded in the spec's element/effect
// mapping and the Witch Hat Atelier canon. This is data, not grammar: adding a
// new eligible kind is a table entry, no IR change.

import {
  CENTER_SLOT_WHITELIST, KEYSTONE_KINDS, RUNE_KINDS,
  type KeystoneKind, type RuneKind,
} from "./types.js";

// ─── Runes ───────────────────────────────────────────────────────────────
//
// A Rune is the element-bearing sigil; it sets the spell's general effect.

export interface RuneInfo {
  kind: RuneKind;
  /** Short canon description of what this element does. */
  lore: string;
  /** Fill colour used when rendering the sigil. */
  color: string;
}

export const RUNE_INFO: Record<RuneKind, RuneInfo> = {
  Fire: { kind: "Fire", color: "#d6452a",
    lore: "Fire element — burst and propulsion. Most fire spells emit a Force effect." },
  Water: { kind: "Water", color: "#3a7ad6",
    lore: "Water element — creates and directs water as an Emission." },
  Earth: { kind: "Earth", color: "#8a6238",
    lore: "Earth element — shapes and raises stone and sand." },
  Wind: { kind: "Wind", color: "#a3c8a3",
    lore: "Wind element — gusts, lift, and air currents." },
  Light: { kind: "Light", color: "#e8d97a",
    lore: "Light element — beams and beacons, an Illumination effect." },
  WindUnderfoot: { kind: "WindUnderfoot", color: "#7aa37a",
    lore: "Wind variant — air channelled underfoot for lift and gliding (Sylph-Shoes lineage)." },
  Aeriforms: { kind: "Aeriforms", color: "#b0c8d8",
    lore: "Air variant — diffuse aeriform bodies: mist, vapour, gaseous forms." },
  Crystal: { kind: "Crystal", color: "#c0a8d0",
    lore: "Earth variant — crystalline growth into hardened, faceted structures." },
};

// ─── Keystones ───────────────────────────────────────────────────────────
//
// A Keystone is a modifier arranged around (or, for the whitelisted few, in)
// the central region. It sets the *form* the magic takes.

// Primary-axis convention groups (WHDL_SPEC.md §Extent). Drives nothing in the
// IR; used here only to group the palette and hint how "major" is oriented.
export type KeystoneCategory = "Directional" | "Symmetric" | "Enclosing" | "Other";

export interface KeystoneInfo {
  kind: KeystoneKind;
  category: KeystoneCategory;
  /** True if this keystone may occupy a sigil slot (CENTER_SLOT_WHITELIST). */
  centerEligible: boolean;
  lore: string;
}

// Lore only — category and centerEligible are filled in below from the spec's
// canonical groupings so the two never drift apart.
const KEYSTONE_LORE: Record<KeystoneKind, string> = {
  Column: "Channels the effect into a directed column along its rotation — pyreball's propulsion sign.",
  Dispersion: "Spreads the effect across an area instead of concentrating it (AreaModifier).",
  Levitation: "Counters gravity, lifting the affected object.",
  Pull: "Draws objects toward the glyph along its axis.",
  Crush: "Compresses matter inward — a Transform effect.",
  Float: "Sustains gentle buoyancy, holding objects aloft.",
  Direction: "Aims the effect along a chosen heading.",
  Convergence: "Focuses multiple vectors onto a single point.",
  Diamond: "Faceting sign — sharpens and concentrates the form.",
  Window: "Opens a framed aperture in the effect.",
  Collection: "Gathers and holds the effect in place — preserve-food's binding sign.",
  Crosshair: "Pinpoints a precise target locus.",
  Radial: "Radiates the effect evenly in every direction.",
  Bolt: "Fires a fast, narrow projectile of force.",
  Billowing: "Billows material outward, converting it as it expands (Transform). May sit in the sigil slot.",
  Eye: "Sensing sign — perception and watchfulness.",
  Bend: "Curves the effect's path along an arc.",
  Repetition: "Continually resets affected objects to a prior state — the only stateful sign (StateRestore).",
  Vision: "Grants sight or projection; eligible to occupy the sigil slot.",
  Weave: "Weaves an enclosing lattice around the target.",
  Enlarge: "Scales the affected region up — an AreaModifier.",
  Rain: "Showers an emission over an enclosed area.",
  Bird: "Forms an enclosing bird-shaped construct.",
  DancingPuppet: "Animates an enclosing puppet form.",
};

const DIRECTIONAL = new Set<KeystoneKind>(["Column", "Direction", "Bolt", "Pull"]);
const SYMMETRIC = new Set<KeystoneKind>(["Dispersion", "Crush", "Convergence", "Radial"]);
const ENCLOSING = new Set<KeystoneKind>(["Rain", "Bird", "Weave", "DancingPuppet"]);

const categoryOf = (k: KeystoneKind): KeystoneCategory =>
  DIRECTIONAL.has(k) ? "Directional"
    : SYMMETRIC.has(k) ? "Symmetric"
      : ENCLOSING.has(k) ? "Enclosing"
        : "Other";

export const KEYSTONE_INFO: Record<KeystoneKind, KeystoneInfo> = Object.fromEntries(
  KEYSTONE_KINDS.map((k) => [k, {
    kind: k,
    category: categoryOf(k),
    centerEligible: CENTER_SLOT_WHITELIST.has(k),
    lore: KEYSTONE_LORE[k],
  }]),
) as Record<KeystoneKind, KeystoneInfo>;

// Convenience lists for building UI palettes.
export const RUNE_OPTIONS: readonly RuneInfo[] = RUNE_KINDS.map((k) => RUNE_INFO[k]);
export const KEYSTONE_OPTIONS: readonly KeystoneInfo[] = KEYSTONE_KINDS.map((k) => KEYSTONE_INFO[k]);
export const CENTER_KEYSTONE_OPTIONS: readonly KeystoneInfo[] =
  KEYSTONE_OPTIONS.filter((k) => k.centerEligible);
