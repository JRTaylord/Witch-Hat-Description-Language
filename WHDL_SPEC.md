# Witch Hat Description Language (WHDL) — v1 Specification

## Purpose and scope

This document specifies the **Witch Hat Description Language (WHDL)**, an intermediate representation for describing magical glyphs in the style of Kamome Shirahama's *Witch Hat Atelier*. WHDL is the IR layer of a three-layer spell simulator stack:

1. **Drawing layer** (TypeScript/React frontend) — user places canonical stamped glyph components on a canvas with position/rotation/scale/extent handles, or (v2, out of scope) draws glyphs freehand with a classifier.
2. **IR layer (WHDL)** — structured representation of the drawn spell, this document.
3. **Simulation layer** (C++ backend compiled to WebAssembly) — consumes WHDL, produces a simulated spell effect as vector-diagram output (force direction, magnitude, area of effect, stability).

WHDL is not intended as a hand-authored language. It is a serialization format the frontend emits and the backend consumes. A human-readable text form exists for testing, sharing, and inspection. A JSON form is the canonical wire format.

### v1 constraints

- Users do not draw freehand; they stamp canonical glyph components with handles for position, rotation, and extent. The classifier problem is deferred to v2.
- Coherence values for stamped components default to 1.0 (perfect). The fields exist so v2 freehand input slots in without IR changes.
- Visual animation / artistic rendering is out of scope. Simulation output is a vector diagram: force vectors, affected regions, stability score.

### Non-goals

- WHDL does not describe user-facing canvas interactions, undo/redo, or persistence. That is the frontend's concern.
- WHDL does not define a physics simulation. It describes what was drawn; the simulator decides what that means.
- WHDL does not encode in-world story elements (witch identity, spell legality, teaching lineage). A Spell is a geometric artifact.

---

## Conceptual model

### The three canonical primitives

Per the in-universe primer ("An Intro to Magic Glyphs"), every spell is built from three elements. WHDL uses the canon terms:

- **Rune** — the element-bearing component in the central region of a glyph. Determines the spell's general effect (fire, water, earth, wind, light, and variants). Most glyphs hold a single rune; "mixed" spells (per canon) hold two or more sigils sharing the central region.
- **Keystone** — a modifier arranged around the central region. Determines the form the magic takes (direction, dispersion, column, etc.).
- **Glyph** — the enclosing boundary. Also the unit of containment for nesting.

A complete spell consists of one or more glyphs, optionally containing nested glyphs, connected by links.

### What WHDL is

WHDL is a **static snapshot of a drawn spell**. It describes geometry, element kinds, and structural relationships at one moment in time — what is on the page. It does not describe activation, time evolution, contact between objects, or anything that would require a physical simulation step. Toggle-style spells (Sylph Shoes, glowstone path) and any other behavior that depends on object motion or contact are out of scope; if they're ever needed, they will be modelled by a separate runtime layer that consumes WHDL, not inside WHDL itself.

WHDL is a **graph, not a tree**. Glyphs nest structurally (containment), and links between glyphs are non-tree relations. Top-level collections are flat; nesting happens within glyphs.

### Spatial properties are continuous

Every spatial property is continuous. "Canonical" is the special case where coherence values are 1.0 and extents match canonical-stamp defaults. The simulator does not distinguish canonical from noisy input — it reads the same fields either way. This is the noise-tolerance commitment: v1 stamped input and v2 freehand input produce IR documents of the same shape.

### Coordinate frames

Every Glyph defines a **local frame** with origin at its `position` and axes rotated by its `rotation`, both expressed in the parent frame. All spatial fields owned by a glyph — boundary geometry (including `Polygonal.vertices`), each sigil's `offset`, perimeter keystone positions, and nested `children` — are expressed in this local frame. To place such a field in the parent frame, the simulator first applies the glyph's rotation, then translates by the glyph's position.

The parent frame for a **top-level glyph** is world coordinates. The parent frame for a **nested glyph** (inside `children`) is the enclosing glyph's local frame.

**Distances are absolute, not normalized to boundary size.** A perimeter keystone at polar `(0.7, 0)` sits at distance `0.7` from the glyph's geometric center, whether the boundary radius is `1.0` or `2.0`. The boundary describes where the boundary is; it does not rescale the contents. This applies uniformly to each sigil's `offset`, `Keystone.position`, `Polygonal.vertices`, and child `Glyph.position`.

---

## Type system

### Top-level: `Spell`

A Spell is the unit of WHDL serialization. It contains:

- `glyphs` — array of top-level Glyphs (not nested inside another Glyph)
- `links` — array of Link edges between glyphs
- `target` — optional ObjectRef indicating what object the spell is drawn on or around (may be null for spells without a specific target)

### `Glyph`

A Glyph is the enclosing boundary plus its contents.

Fields:

- `id` — unique identifier (string, frontend-generated, stable across serializations of the same spell)
- `position` — (x, y) in the parent frame. Parent frame is world coordinates for top-level glyphs, or the enclosing glyph's local frame for nested glyphs.
- `boundary` — tagged union describing the shape of the enclosing ring (see Boundary below)
- `rotation` — radians, rotation of the boundary around its position
- `coherence` — Coherence vector for the boundary itself (stroke quality, closure, etc.)
- `sigils` — array of Center occupants. At least one. Single-sigil spells (the common case) are a length-1 array; mixed spells with multiple sigils share the central region (see Sigils slot below).
- `perimeter` — array of Keystones arranged around the glyph center
- `children` — array of nested Glyphs, positioned in this glyph's local frame

### `Boundary`

Tagged union. Not all canon glyph boundaries are circles. The IR must support non-circular boundaries so v1 does not preclude future canon evidence.

Variants:

- `Circular { radius: float }`
- `Elliptical { major: float, minor: float }` — the Dada Mountains "extended glyph" case; `rotation` on the Glyph gives the ellipse its orientation
- `Polygonal { vertices: [(x, y)] }` — arbitrary closed polygon, vertex list in the glyph's local frame, first/last vertex implicitly connected. Closure quality lives in `Glyph.coherence.closure` like every other boundary kind.

The simulator treats unknown boundary-shape semantics as "circular with a warning" in v1. Behavioral interpretation of polygonal boundaries is deferred; the IR only needs to represent them.

### Sigils slot

A Glyph holds a list of sigil placements in its central region. Per canon (Spells page), "Mixed spells are spells consisting of two or more separate sigils" — so the slot is genuinely a list, not a singleton-with-an-array-shape. Each placement is a `Center` wrapper carrying its own positioning:

```
Center {
  element: Rune | CenterKeystone     // identifier only — see below
  offset: (r, θ)                     // polar offset from the glyph's geometric center; default (0, 0)
  rotation: radians
  reversed: bool                     // default false; ignored for Rune (no canonical reversed rune)
  extent: Extent
  coherence: Coherence
}
```

The `element` field is the kind tag only — the spatial fields (`rotation`, `extent`, `coherence`, `reversed`) live on the wrapper, never duplicated inside the tag. This is the single rule that decides which JSON shape is correct in §Serialization.

```
Rune          { kind: "Rune",          rune_kind:     RuneKind     }
CenterKeystone { kind: "CenterKeystone", keystone_kind: KeystoneKind }
```

**Single-sigil spells** (the common case — pyreball, watershot, repetition seal) are a length-1 `sigils` array. **Multi-sigil "mixed" spells** are length-2-or-more, with each sigil at its own offset so they don't geometrically overlap. Order in the array is not semantic; the simulator treats sigils as an unordered set.

**Rune** — element sigil. Kind is one of the canonical rune kinds (see enumerations below). Per canon there is no reversed-rune effect, so a `reversed: true` Rune is structurally legal but ignored by the simulator (a warning may be emitted).

**CenterKeystone** — a Keystone drawn from a whitelisted subset that can occupy a sigil slot in place of a Rune. Per the wiki: "certain signs, such as vision, repetition, and billowing can serve the purpose of sigil within their respective spells." The whitelist in v1: `{Repetition, Billowing, Vision, Enlarge, Rain, Bird, DancingPuppet, Weave}`. Center-slot eligibility lives in keystone metadata (data, not grammar), so adding new eligible keystones does not require IR changes. A center-slot keystone behaves like a perimeter keystone with respect to `rotation` and `reversed`; it just sits in a sigil slot.

**Offset.** Per the primer's Dada Mountains example, a sigil can be offset from the geometric center of the glyph and the spell still executes — producing different behavior. Offset is polar from the glyph's geometric center. Default `(0, 0)`. In multi-sigil spells, each sigil's offset positions it within the central region; sigils with offset `(0, 0)` would geometrically collide and is structurally legal but a `SigilCollision` warning is emitted.

### `Keystone`

A perimeter keystone.

Fields:

- `kind` — KeystoneKind (see enumerations)
- `position` — (r, θ) polar coordinates, anchored to the glyph's geometric center (not to any sigil's position, even if sigils are offset)
- `rotation` — radians
- `extent` — Extent { major, minor }
- `reversed` — boolean. If true, the simulator applies an effect-inversion rule.
- `coherence` — Coherence vector

### `Extent`

A 2D size descriptor. Replaces a simple scalar scale factor, because the canon treats major/minor dimensions of keystones and glyphs as meaningful independent variables.

```
Extent { major: float, minor: float }
```

Aspect ratio (`major / minor`) is a **derived** quantity computed by the simulator, not stored.

**Primary-axis convention.** For Extent to be meaningful, "major" needs a defined direction. That direction is metadata-defined per keystone kind:

- Directional keystones (Column, Direction, Bolt, Pull): primary axis follows the keystone's `rotation` (the arrow/shaft direction).
- Symmetric keystones (Dispersion, Crush, Convergence, Radial): primary axis follows the keystone's `rotation`; at rotation 0, major is horizontal by convention.
- Enclosing keystones (Rain, Bird, Weave, DancingPuppet): primary axis is the longest axis of the enclosing shape, derived by the simulator from the drawn/stamped geometry.

**Aspect-preservation under reversal.** Reversing a keystone (`reversed: true`) inverts its effect but does not change its geometry. A reversed high-aspect Column keystone is still geometrically long and narrow; its effect is simply inverted.

### `Coherence`

A vector of four independent quality scores, each in `[0, 1]`.

```
Coherence {
  stroke:    float  // line quality
  closure:   float  // how completely the shape closes
  placement: float  // how close the element is to its ideal position/rotation
  symmetry:  float  // element's contribution to overall glyph symmetry
}
```

Rationale for a vector instead of a scalar: each component drives a different simulator failure mode. Low `stroke` → shorter spell duration. Low `closure` on a glyph → degraded or unreliable effect. Low `placement` → directional error. Low `symmetry` → instability, possible unintended behavior.

**For v1 stamped components:** `stroke`, `closure`, `placement` default to 1.0. `symmetry` is always derived by the simulator from sigil and keystone positions, never declared.

**For v2 freehand (out of scope):** the classifier emits stroke/closure/placement values per classified element.

### `Link`

An edge between two glyphs. Directed endpoints are not required; links are symmetric.

```
Link {
  endpoints: (GlyphId, GlyphId)
  kind: Amplify | Cancel
}
```

- `Amplify` — identical linked glyphs produce amplified effect (canon: "if both spells are identical or similar, their power will increase")
- `Cancel` — identical-but-reversed glyphs cancel one another

`Compose` (dissimilar linked glyphs producing composite effects) is deferred; the canon is ambiguous about this case in v1.

### `ObjectRef`

`ObjectRef` is a type alias for `string`. The serialized form is a bare JSON string (e.g. `"bread_loaf"`), not a wrapped object. Used only for `Spell.target` — the object the spell is drawn on or around. The simulator maintains the object registry; WHDL just stores opaque string keys into it.

---

## Enumerations

### `RuneKind`

Canonical rune kinds per the wiki. More are added as metadata without grammar changes.

Primary:
- `Fire`
- `Water`
- `Earth`
- `Wind`
- `Light`

Variants (treated as distinct kinds, not modifiers):
- `WindUnderfoot`
- `Aeriforms`
- `Crystal`

### `KeystoneKind`

Per the wiki's signs catalog. v1 set:

`Column`, `Dispersion`, `Levitation`, `Pull`, `Crush`, `Float`, `Direction`, `Convergence`, `Diamond`, `Window`, `Collection`, `Crosshair`, `Radial`, `Bolt`, `Billowing`, `Eye`, `Bend`, `Repetition`, `Vision`, `Weave`, `Enlarge`, `Rain`, `Bird`, `DancingPuppet`

Animal-signs are out of v1 scope (decorative, per canon).

### Keystone metadata

Keystone metadata is a backend-owned lookup table keyed by `KeystoneKind`. The IR does not contain this data — it references it by kind. The frontend may ship a read-only copy for UI purposes (e.g., to know which keystones are center-slot-eligible so the canvas only allows valid placements).

```
KeystoneMetadata {
  kind: KeystoneKind
  center_slot_eligible: bool
  primary_axis: DirectionalFromRotation | FromShaft | FromEnclosingShape
  capabilities: [Capability]
}
```

`Capability` values in v1: `ReadStateHistory`, `WriteStateHistory` (see State Hooks below). Only `Repetition` declares these in v1.

---

## Derived quantities

The simulator computes these at evaluation time. They are not stored in the IR.

- **Aspect ratio** (Glyph, Keystone, Rune): `extent.major / extent.minor`.
- **Eccentricity** (per sigil): `{ magnitude: offset_distance / boundary_minor_extent, direction: offset_angle }`. Characterizes how off-center each sigil is. For a single-sigil spell this is the spell's directionality cue (Dada Mountains); for multi-sigil spells the simulator may sum, average, or otherwise combine per-sigil eccentricities — that's a simulator policy.
- **Symmetry score** (Glyph): computed by testing the combined configuration of sigil placements and perimeter keystone positions against candidate symmetry groups (C_n for radial, D_1 for bilateral). Each element contributes both its position and its kind as a label — a fire sigil opposite a water sigil breaks a symmetry that two fire sigils would preserve, and a Column opposite a Direction sign breaks a symmetry that two Columns would preserve. Score is max over candidate groups; asymmetric spells score low against all groups.
- **Extent uniformity** (Glyph): consistency of extent across same-kind keystones within a single glyph. Canon-attested failure mode (Coco's first glyph: one keystone longer than the rest caused unintended behavior).

---

## State hooks

The canon's Repetition keystone "continually resets objects affected by the spell to their previous state." This is stateful and cannot be modeled as pure combinational evaluation.

**Minimum viable hook.** The simulator maintains, for each object in scene, a ring buffer of prior states (position, orientation, material properties, etc.). Any keystone whose metadata declares `ReadStateHistory` or `WriteStateHistory` is provided a `StateHistory` interface at evaluation time. Keystones without these capabilities cannot reach it.

**v1 implementation.** Fixed-size ring buffer of last N frames per object. Only `Repetition` uses it. No compression, no intelligent retention. When the first spell comes along that breaks this assumption, the buffer is redesigned.

**IR implication.** None. State is a simulator concern. The IR just exposes the capability flag via keystone metadata; the simulator wires up the interface.

---

## Static-snapshot scope

WHDL describes the spell as drawn. It does not describe whether the spell is currently doing anything. Activation, ring-closure gating, link resolution order, nested-glyph evaluation order, and any other "what happens at runtime" question is the simulator's concern. The spec exposes the geometry and quality signals the simulator needs to make those decisions, and stops there.

A `coherence.closure` value below 1.0 means the boundary is drawn imperfectly — that is a fact about the drawing, recorded in the IR. Whether it is "low enough to break the spell" is a runtime threshold, defined by whatever consumes WHDL.

---

## Simulation output contract

WHDL is two-sided like an HDL module: the input side is the drawn spell (everything above), the output side is the result of evaluating it. This section pins the *shape* of the output. The simulator fills in values; consumers (frontend, test harnesses, alternative backends) interpret. Without this contract, every simulator would invent its own output shape and the frontend couldn't render results portably.

### `SimulationResult`

The envelope returned for one evaluation of one WHDL document:

```
SimulationResult {
  effects:     [Effect]
  diagnostics: [Diagnostic]
  meta:        { version: string, simulator_id: string }
}
```

- `effects` — zero or more Effects produced by the spell. An empty array is a valid result (e.g. an inert or unrecognized spell).
- `diagnostics` — warnings, quality assessments, unmodelled-kind notices. Non-fatal; effects may be present even with diagnostics.
- `meta` — version and simulator identifier so consumers can route on capability.

### `Effect`

Every effect carries a common envelope plus a kind-specific payload.

```
Effect {
  kind:         EffectKind          // tag — see v1 set below
  payload:      <kind-specific>     // shape determined by kind
  origin:       Point | ObjectRef   // where it acts
  duration:     Finite { seconds: float } | Continuous
  intensity:    float               // 0..1, normalized
  source_glyph: GlyphId             // back-reference into the input IR
}
```

`source_glyph` is the back-reference frontends use to attribute effects to the drawing element that produced them (highlighting, error reporting, animation anchoring). `intensity` is a normalized scale; absolute physical units are simulator-defined.

### v1 `EffectKind` set

Six kinds cover the canonical primary five elements plus the one stateful canon case. The spec fixes field *names and types*; semantic taxonomies (`MaterialState`, `RGB`, `Region`, `SnapshotPolicy`) are simulator-defined sub-schemas the contract treats as opaque.

- `Force { direction: (x, y), magnitude: float, area: Region }` — burst, propulsion, column. Most fire spells, physical-impact spells.
- `Emission { medium: EmissionMedium, volume_rate: float, direction: (x, y) | null, cone_angle: float }` — water, wind, sand, fluid creation. `direction: null` means radial.
- `Transform { source_state: MaterialState, target_state: MaterialState, region: Region }` — crush, integrate, billowing.
- `Illumination { color: RGB, brightness: float, cone: ConeShape | null }` — light beams, beacons, glowstones.
- `StateRestore { target: ObjectRef, snapshot_policy: SnapshotPolicy }` — repetition seal. Couples to the State Hooks section.
- `AreaModifier { region: Region, scalar: float, dimension: Spatial | Temporal }` — enlarge, shrink, dispersion fields.

`EmissionMedium` is itself extensible (`Water`, `Air`, `Sand`, `Stone`, ... — added via metadata, no grammar change). `Region` in v1: `Disc { center, radius } | Box { ... } | Polygon { ... }`.

### Extending the kind set

New `EffectKind`s are added the same way new `KeystoneKind`s are: a table entry, no grammar change. The spec's listed v1 kinds are the floor; the simulator's compiled-in registry is authoritative for what it actually emits. Frontends discover available kinds via the simulator's metadata endpoint (parallel to the keystone metadata table).

### Unrecognized spells

When the simulator parses a WHDL document containing a glyph it understands structurally but cannot map to any known effect (forbidden magic, future canon kinds, ambiguous mixed spells), it emits:

```
Effect {
  kind:    "Unsupported",
  payload: { reason: string, glyph_kind_summary: string },
  origin:  <source glyph's position>,
  duration: { kind: "Finite", seconds: 0 },
  intensity: 0,
  source_glyph: <glyph id>
}
```

Plus a `Diagnostic` of `severity: Warning`. Frontends should render this as an inert visual marker, not silently drop the spell. This is the explicit "I see it, I won't model it" channel — it keeps round-trip fidelity even when the simulator's coverage is incomplete.

### `Diagnostic`

```
Diagnostic {
  severity: Info | Warning | Error
  code:     string                // machine-readable: "SigilCollision", "ExtentNonUniform", "Unsupported", ...
  message:  string                // human-readable
  source:   GlyphId | null        // which glyph triggered it, if applicable
}
```

`Error` severity does not imply zero effects — it means the simulator could not fully evaluate something. Partial results with errors are valid.

### What this contract does *not* fix

- Numerical scales for `magnitude`, `volume_rate`, `brightness`, etc. — simulator-defined.
- The set of `MaterialState` values, the `RGB` colour space, the `ConeShape` parameterization. — simulator-defined sub-schemas.
- Rendering. — the contract guarantees the data; visualization is downstream.

The contract is a *floor* on agreement, not a ceiling. Two simulators with different physics can both be conformant if they emit the same shape; they will simply produce different values.

---

## Serialization

### JSON (canonical wire format)

Example — pyreball with four radially-symmetric column keystones:

```json
{
  "target": null,
  "glyphs": [
    {
      "id": "g1",
      "position": [0, 0],
      "boundary": { "kind": "Circular", "radius": 1.0 },
      "rotation": 0,
      "coherence": { "stroke": 1.0, "closure": 1.0, "placement": 1.0, "symmetry": 1.0 },
      "sigils": [
        {
          "element": { "kind": "Rune", "rune_kind": "Fire" },
          "offset": [0, 0],
          "rotation": 0,
          "reversed": false,
          "extent": { "major": 0.3, "minor": 0.3 },
          "coherence": { "stroke": 1.0, "closure": 1.0, "placement": 1.0, "symmetry": 1.0 }
        }
      ],
      "perimeter": [
        {
          "kind": "Column",
          "position": [0.7, 0],
          "rotation": 0,
          "extent": { "major": 0.4, "minor": 0.1 },
          "reversed": false,
          "coherence": { "stroke": 1.0, "closure": 1.0, "placement": 1.0, "symmetry": 1.0 }
        },
        {
          "kind": "Column",
          "position": [0.7, 1.5708],
          "rotation": 1.5708,
          "extent": { "major": 0.4, "minor": 0.1 },
          "reversed": false,
          "coherence": { "stroke": 1.0, "closure": 1.0, "placement": 1.0, "symmetry": 1.0 }
        },
        {
          "kind": "Column",
          "position": [0.7, 3.1416],
          "rotation": 3.1416,
          "extent": { "major": 0.4, "minor": 0.1 },
          "reversed": false,
          "coherence": { "stroke": 1.0, "closure": 1.0, "placement": 1.0, "symmetry": 1.0 }
        },
        {
          "kind": "Column",
          "position": [0.7, 4.7124],
          "rotation": 4.7124,
          "extent": { "major": 0.4, "minor": 0.1 },
          "reversed": false,
          "coherence": { "stroke": 1.0, "closure": 1.0, "placement": 1.0, "symmetry": 1.0 }
        }
      ],
      "children": []
    }
  ],
  "links": []
}
```

Positions are `[r, theta]` in polar (perimeter) or `[x, y]` in cartesian (glyph position in parent frame). Angles in radians.

### Text form (for tests and inspection)

A compact text syntax is provided for human readability. It is not the canonical format — round-tripping goes through JSON. Example:

```
spell {
  target: null

  glyph g1 {
    position: (0, 0)
    boundary: circular(radius: 1.0)
    rotation: 0
    coherence: { stroke: 1.0, closure: 1.0, placement: 1.0, symmetry: 1.0 }

    sigils: [
      sigil rune(fire) @ polar(0, 0) { rotation: 0, reversed: false, extent: { 0.3, 0.3 }, coherence: { stroke: 1.0, closure: 1.0, placement: 1.0, symmetry: 1.0 } },
    ]

    perimeter: [
      keystone column @ polar(0.7, 0°)    { rotation: 0°,   extent: { 0.4, 0.1 }, reversed: false },
      keystone column @ polar(0.7, 90°)   { rotation: 90°,  extent: { 0.4, 0.1 }, reversed: false },
      keystone column @ polar(0.7, 180°)  { rotation: 180°, extent: { 0.4, 0.1 }, reversed: false },
      keystone column @ polar(0.7, 270°)  { rotation: 270°, extent: { 0.4, 0.1 }, reversed: false },
    ]
  }
}
```

Degrees-with-° are sugar for radians. Coherence defaults to `{1,1,1,1}` and may be omitted in text form. Text form is for tests and debugging; the frontend/backend communicate in JSON.

---

## Worked examples

### Dada Mountains burst (offset rune, extended keystone)

Rune offset east by 40% of glyph radius; one column keystone extended along the east axis; others canonical. Derived: eccentricity magnitude 0.4 direction 0; symmetry score reduced; extent uniformity reduced. Simulator output: directional burst to the east.

```json
{
  "target": null,
  "glyphs": [{
    "id": "g1",
    "position": [0, 0],
    "boundary": { "kind": "Circular", "radius": 1.0 },
    "rotation": 0,
    "coherence": { "stroke": 1.0, "closure": 1.0, "placement": 1.0, "symmetry": 1.0 },
    "sigils": [
      {
        "element": { "kind": "Rune", "rune_kind": "Fire" },
        "offset": [0.4, 0],
        "rotation": 0,
        "reversed": false,
        "extent": { "major": 0.3, "minor": 0.3 },
        "coherence": { "stroke": 1.0, "closure": 1.0, "placement": 1.0, "symmetry": 1.0 }
      }
    ],
    "perimeter": [
      { "kind": "Column", "position": [0.9, 0], "rotation": 0,
        "extent": { "major": 0.6, "minor": 0.1 }, "reversed": false,
        "coherence": { "stroke": 1.0, "closure": 1.0, "placement": 1.0, "symmetry": 1.0 } },
      { "kind": "Column", "position": [0.9, 1.5708], "rotation": 1.5708,
        "extent": { "major": 0.4, "minor": 0.1 }, "reversed": false,
        "coherence": { "stroke": 1.0, "closure": 1.0, "placement": 1.0, "symmetry": 1.0 } },
      { "kind": "Column", "position": [0.9, 3.1416], "rotation": 3.1416,
        "extent": { "major": 0.4, "minor": 0.1 }, "reversed": false,
        "coherence": { "stroke": 1.0, "closure": 1.0, "placement": 1.0, "symmetry": 1.0 } },
      { "kind": "Column", "position": [0.9, 4.7124], "rotation": 4.7124,
        "extent": { "major": 0.4, "minor": 0.1 }, "reversed": false,
        "coherence": { "stroke": 1.0, "closure": 1.0, "placement": 1.0, "symmetry": 1.0 } }
    ],
    "children": []
  }],
  "links": []
}
```

### Preserve-food spell (repetition, state hook, target)

Single sigil is a Repetition keystone (no rune), three collection keystones in radial symmetry, target is a bread loaf.

```json
{
  "target": "bread_loaf",
  "glyphs": [{
    "id": "g1",
    "position": [0, 0],
    "boundary": { "kind": "Circular", "radius": 1.0 },
    "rotation": 0,
    "coherence": { "stroke": 1.0, "closure": 1.0, "placement": 1.0, "symmetry": 1.0 },
    "sigils": [
      {
        "element": { "kind": "CenterKeystone", "keystone_kind": "Repetition" },
        "offset": [0, 0],
        "rotation": 0,
        "reversed": false,
        "extent": { "major": 0.3, "minor": 0.3 },
        "coherence": { "stroke": 1.0, "closure": 1.0, "placement": 1.0, "symmetry": 1.0 }
      }
    ],
    "perimeter": [
      { "kind": "Collection", "position": [0.8, 0], "rotation": 0,
        "extent": { "major": 0.2, "minor": 0.2 }, "reversed": false,
        "coherence": { "stroke": 1.0, "closure": 1.0, "placement": 1.0, "symmetry": 1.0 } },
      { "kind": "Collection", "position": [0.8, 2.0944], "rotation": 2.0944,
        "extent": { "major": 0.2, "minor": 0.2 }, "reversed": false,
        "coherence": { "stroke": 1.0, "closure": 1.0, "placement": 1.0, "symmetry": 1.0 } },
      { "kind": "Collection", "position": [0.8, 4.1888], "rotation": 4.1888,
        "extent": { "major": 0.2, "minor": 0.2 }, "reversed": false,
        "coherence": { "stroke": 1.0, "closure": 1.0, "placement": 1.0, "symmetry": 1.0 } }
    ],
    "children": []
  }],
  "links": []
}
```

Simulator at evaluation time: walks `sigils`, sees the only sigil is a Repetition keystone, checks metadata, sees `ReadStateHistory` + `WriteStateHistory` capabilities, wires up the StateHistory interface for `bread_loaf`. What it does with that interface is the simulator's concern, not WHDL's.

### Mixed spell (two sigils in one glyph)

A two-sigil mixed spell — fire and water sigils sharing the central region, with column keystones around them. Per canon's "Mixed spells are spells consisting of two or more separate sigils." Sigils are offset symmetrically about the geometric center so they don't collide.

```json
{
  "target": null,
  "glyphs": [{
    "id": "g1",
    "position": [0, 0],
    "boundary": { "kind": "Circular", "radius": 1.0 },
    "rotation": 0,
    "coherence": { "stroke": 1.0, "closure": 1.0, "placement": 1.0, "symmetry": 1.0 },
    "sigils": [
      {
        "element": { "kind": "Rune", "rune_kind": "Fire" },
        "offset": [0.25, 0],
        "rotation": 0, "reversed": false,
        "extent": { "major": 0.25, "minor": 0.25 },
        "coherence": { "stroke": 1.0, "closure": 1.0, "placement": 1.0, "symmetry": 1.0 }
      },
      {
        "element": { "kind": "Rune", "rune_kind": "Water" },
        "offset": [0.25, 3.1416],
        "rotation": 0, "reversed": false,
        "extent": { "major": 0.25, "minor": 0.25 },
        "coherence": { "stroke": 1.0, "closure": 1.0, "placement": 1.0, "symmetry": 1.0 }
      }
    ],
    "perimeter": [
      { "kind": "Column", "position": [0.8, 1.5708], "rotation": 1.5708,
        "extent": { "major": 0.4, "minor": 0.1 }, "reversed": false,
        "coherence": { "stroke": 1.0, "closure": 1.0, "placement": 1.0, "symmetry": 1.0 } },
      { "kind": "Column", "position": [0.8, 4.7124], "rotation": 4.7124,
        "extent": { "major": 0.4, "minor": 0.1 }, "reversed": false,
        "coherence": { "stroke": 1.0, "closure": 1.0, "placement": 1.0, "symmetry": 1.0 } }
    ],
    "children": []
  }],
  "links": []
}
```

Simulator: combines the contributions of both sigils per its mixed-element rules (out of scope for the IR). The two sigils produce no `SigilCollision` warning because their offsets place them at distance 0.5 apart.

### Linked amplification (two identical pyreballs)

Two glyphs in the same spell with a link between them.

```json
{
  "target": null,
  "glyphs": [
    { "id": "g1", "position": [0, 0], "...": "same as pyreball above" },
    { "id": "g2", "position": [3, 0], "...": "same as pyreball above" }
  ],
  "links": [
    { "endpoints": ["g1", "g2"], "kind": "Amplify" }
  ]
}
```

Two identical glyphs, one Amplify edge between them. The simulator decides what the amplification means; WHDL just records the structural fact.

---

## Validation rules

A WHDL document is valid if and only if:

1. All `GlyphId` and `ObjectRef` references resolve to existing entities (or are `null` where permitted).
2. Every Glyph has at least one entry in `sigils`. (Multi-sigil "mixed" spells are valid; an empty sigil list is not.)
3. A `CenterKeystone` has `kind` in the center-slot whitelist (per keystone metadata).
4. Every component of every `coherence` block is in `[0, 1]`.
5. All `extent.major` and `extent.minor` are positive, finite floats.
6. `Boundary.Circular.radius` is positive; `Boundary.Elliptical.major/minor` positive; `Boundary.Polygonal.vertices` has at least 3 entries.
7. Link endpoints reference distinct glyphs. (A glyph may participate in multiple links — chains of identical glyphs amplifying together is canonical.)

Invalid documents are rejected at parse time.

---

## Implementation notes

### Frontend (TypeScript/React)

- Canvas interaction produces a mutable working model; serialize to WHDL JSON on save / on-backend-request.
- Canonical stamp palette is driven by the keystone metadata table. New keystones added to the table appear in the UI automatically.
- Handles on each stamped element: drag-position, rotation handle, two extent handles (major and minor axes).
- Coherence fields for v1 are always 1.0 — UI should not expose them. Their existence in the serialized JSON is for v2 forward compatibility.
- Ring-closure UX: user draws the glyph boundary; if the boundary is complete, `closure: 1.0`. Partial closures are recorded with the corresponding lower value — what that value means at runtime is a downstream concern.

### Backend (C++ → WASM)

- Parse JSON to IR structs. Keep IR types plain data (no polymorphism beyond tagged unions); pattern-match on kind during evaluation.
- Evaluation order is a simulator concern outside this spec, but the IR's link structure means link resolution (grouping amplified/cancelled glyphs) needs to happen before per-glyph evaluation regardless of policy.
- Keystone metadata table compiled in (v1). Exposed read-only to the frontend via a separate JSON file shipped with the build.
- State history: per-object ring buffer, fixed size (suggest 300 frames / 5 seconds at 60fps for v1).
- Output: conform to the §Simulation output contract. The backend's compiled-in effect registry is authoritative for which `EffectKind`s it actually emits; new kinds are added via the same metadata mechanism as keystones.

### Directory sketch

```
whdl/
├── spec/
│   └── WHDL_SPEC.md        ← this document
├── frontend/               ← TypeScript/React
│   ├── src/
│   │   ├── model/          ← WHDL types in TS
│   │   ├── canvas/         ← stamp + handle UI
│   │   ├── serialize/      ← to/from JSON
│   │   └── wasm/           ← backend bindings
│   └── metadata/
│       └── keystones.json  ← read-only copy for UI
└── backend/                ← C++
    ├── include/whdl/
    │   ├── ir.hpp          ← IR types
    │   ├── parse.hpp       ← JSON → IR
    │   ├── validate.hpp
    │   └── simulate.hpp
    ├── src/
    └── metadata/
        └── keystones.cpp   ← compiled-in metadata table
```

---

## Open questions (deferred to v2+)

- **Freehand classifier.** v2. Requires a sign/rune classifier whose output populates WHDL directly.
- **Link kind `Compose`.** Dissimilar linked glyphs — canon ambiguous. Revisit when more references confirm or deny.
- **Behavioral interpretation of polygonal boundaries.** IR supports them in v1; simulator treats as circular-with-warning. Revisit with more canon evidence.
- **Billowing as stateful.** Billowing "converts material" which implies memory of the source material. v1 does not mark Billowing stateful; revisit when a test case requires it.
- **Forbidden-magic markers.** Some spells (healing, curses, petrification) are in-world forbidden. WHDL does not currently flag these. If the simulator grows to model in-world effects, a forbidden-magic flag on validation output is probably the right addition.
- **Link amplification formula.** Canon says identical linked spells amplify; specific formula is open. Simulator will need to pick one. This is a simulation concern, not an IR concern.
- **Animal-sign decorative keystones.** Out of v1 scope; trivial to add as new keystone kinds with `has_effect: false` metadata if needed.
- **Wrapped spell with gap-fill.** Canon (Magic page) describes wrapping one spell inside another ring and filling the gap between them with a second spell. This is structurally distinct from plain nesting (spell-inside-spell, both fully closed) — the "filler" spell sits *between* the two rings, not inside the inner one. v1 does not model it; expressing it cleanly may require either a new edge type or treating it as a constrained two-glyph nesting case. Revisit when a worked example demands it.
- **Toggle / Half spells.** Sylph Shoes, glowstone path, and similar spells split a glyph across two surfaces and depend on object contact. WHDL is a static-snapshot format and intentionally does not model them. If they're ever needed, the natural place is a separate runtime layer that consumes WHDL plus scene state, not inside the IR.
