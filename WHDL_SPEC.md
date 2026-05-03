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

- **Rune** — the element-bearing component in the center of a glyph. Determines the spell's general effect (fire, water, earth, wind, light, and variants).
- **Keystone** — a modifier arranged around the rune. Determines the form the magic takes (direction, dispersion, column, etc.).
- **Glyph** — the enclosing boundary. The spell activates when the glyph is closed. Also the unit of containment for nesting.

A complete spell consists of one or more glyphs, optionally containing nested glyphs, connected by links or split across object-bound halves for toggle spells.

### What WHDL is

WHDL is a **graph, not a tree**. Glyphs nest structurally (containment), but links between glyphs, and toggle-halves that reference each other across object boundaries, are non-tree relations. Top-level collections are flat; nesting happens within glyphs.

Activation is **separate from structure**. A WHDL document describes what was drawn. A second pass resolves which glyphs are closed, which halves are touching, and whether the spell is currently active. A spell with an unclosed ring is a valid WHDL document — just an inactive spell.

### Spatial properties are continuous

Every spatial property is continuous. "Canonical" is the special case where coherence values are 1.0 and extents match canonical-stamp defaults. The simulator does not distinguish canonical from noisy input — it reads the same fields either way. This is the noise-tolerance commitment: v1 stamped input and v2 freehand input produce IR documents of the same shape.

### Coordinate frames

Every Glyph defines a **local frame** with origin at its `position` and axes rotated by its `rotation`, both expressed in the parent frame. All spatial fields owned by a glyph — boundary geometry (including `Polygonal.vertices`), `center.offset`, perimeter keystone positions, and nested `children` — are expressed in this local frame. To place such a field in the parent frame, the simulator first applies the glyph's rotation, then translates by the glyph's position.

The parent frame for a **top-level glyph** is world coordinates. The parent frame for a **nested glyph** (inside `children`) is the enclosing glyph's local frame.

For a **Half**, the parent frame of `glyph_fragment` is the local frame of the object named by `object_ref` — the fragment moves with the object, which is what makes toggle spells work (lift the foot, the half moves with it). The simulator owns the object→world transform; WHDL stores positions relative to the object only.

**Distances are absolute, not normalized to boundary size.** A perimeter keystone at polar `(0.7, 0)` sits at distance `0.7` from the glyph's geometric center, whether the boundary radius is `1.0` or `2.0`. The boundary describes where the boundary is; it does not rescale the contents. This applies uniformly to `center.offset`, `Keystone.position`, `Polygonal.vertices`, and child `Glyph.position`.

---

## Type system

### Top-level: `Spell`

A Spell is the unit of WHDL serialization. It contains:

- `glyphs` — array of top-level Glyphs (not nested inside another Glyph)
- `halves` — array of Half objects for toggle-style spells
- `links` — array of Link edges between glyphs
- `toggles` — array of Toggle edges between halves
- `target` — optional ObjectRef indicating what object the spell acts on (may be null for ambient spells)

### `Glyph`

A Glyph is the enclosing boundary plus its contents.

Fields:

- `id` — unique identifier (string, frontend-generated, stable across serializations of the same spell)
- `position` — (x, y) in the parent frame. Parent frame is world coordinates for top-level glyphs, or the enclosing glyph's local frame for nested glyphs.
- `boundary` — tagged union describing the shape of the enclosing ring (see Boundary below)
- `rotation` — radians, rotation of the boundary around its position
- `coherence` — Coherence vector for the boundary itself (stroke quality, closure, etc.)
- `center` — the Center slot (Rune or center-eligible Keystone, with offset; see below)
- `perimeter` — array of Keystones arranged around the glyph center
- `children` — array of nested Glyphs, positioned in this glyph's local frame

### `Boundary`

Tagged union. Not all canon glyph boundaries are circles. The IR must support non-circular boundaries so v1 does not preclude future canon evidence.

Variants:

- `Circular { radius: float }`
- `Elliptical { major: float, minor: float }` — the Dada Mountains "extended glyph" case; `rotation` on the Glyph gives the ellipse its orientation
- `Polygonal { vertices: [(x, y)] }` — arbitrary closed polygon, vertex list in the glyph's local frame, first/last vertex implicitly connected. Closure quality lives in `Glyph.coherence.closure` like every other boundary kind.

The simulator treats unknown boundary-shape semantics as "circular with a warning" in v1. Behavioral interpretation of polygonal boundaries is deferred; the IR only needs to represent them.

### Center slot

The center of a Glyph is a tagged union of element kinds, wrapped in a container that carries the center's own spatial properties.

```
Center {
  element: Rune | CenterKeystone
  offset: (r, θ)       // polar offset from the glyph's geometric center; default (0, 0)
  rotation: radians
  extent: Extent
  coherence: Coherence
}
```

**Rune** — element sigil. Kind is one of the canonical rune kinds (see enumerations below).

**CenterKeystone** — a Keystone drawn from a whitelisted subset that can occupy the center slot in place of a Rune. The whitelist in v1: `{Repetition, Billowing, Vision, Enlarge, Rain, Bird, DancingPuppet, Weave}`. Center-slot eligibility lives in keystone metadata (data, not grammar), so adding new eligible keystones does not require IR changes.

**Offset.** Per the primer's Dada Mountains example, the rune can be offset from the geometric center of the glyph and the spell still executes — producing different behavior. Offset is polar from the glyph's geometric center. Default `(0, 0)`.

### `Keystone`

A perimeter keystone.

Fields:

- `kind` — KeystoneKind (see enumerations)
- `position` — (r, θ) polar coordinates, anchored to the glyph's geometric center (not the rune's position, even if the rune is offset)
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

Rationale for a vector instead of a scalar: each component drives a different simulator failure mode. Low `stroke` → shorter spell duration. Low `closure` on a glyph → spell may not activate. Low `placement` → directional error. Low `symmetry` → instability, possible unintended behavior.

**For v1 stamped components:** `stroke`, `closure`, `placement` default to 1.0. `symmetry` is always derived by the simulator from keystone positions, never declared.

**For v2 freehand (out of scope):** the classifier emits stroke/closure/placement values per classified element.

### `Half`

A glyph fragment bound to an object, completable only by touching its complement. Models toggle-style spells (glowstone path, Sylph Shoes).

Fields:

- `id` — unique identifier
- `object_ref` — ObjectRef identifying which object this half is drawn on
- `glyph_fragment` — a Glyph with intentionally incomplete closure (the missing portion is supplied by the other half when contact occurs)

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

### `Toggle`

An edge between two Halves, with an activation condition.

```
Toggle {
  halves: (HalfId, HalfId)
  condition: ContactCondition
}
```

v1 `ContactCondition` variants:

- `Contact` — halves are physically touching
- `Pressure { threshold: float }` — halves pressed together with force above threshold (glowstone path case)

### `ObjectRef`

An opaque string reference to a scene object (`"bread_loaf"`, `"stone_surface"`, `"foot"`). The simulator maintains the object registry; WHDL just stores references.

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
- **Eccentricity** (Glyph): `{ magnitude: offset_distance / boundary_minor_extent, direction: offset_angle }`. Characterizes how off-center the rune is.
- **Symmetry score** (Glyph): computed by testing keystone positions against candidate symmetry groups (C_n for radial, D_1 for bilateral). Score is max over candidate groups; asymmetric spells score low against all groups.
- **Extent uniformity** (Glyph): consistency of extent across same-kind keystones within a single glyph. Canon-attested failure mode (Coco's first glyph: one keystone longer than the rest caused unintended behavior).

---

## State hooks

The canon's Repetition keystone "continually resets objects affected by the spell to their previous state." This is stateful and cannot be modeled as pure combinational evaluation.

**Minimum viable hook.** The simulator maintains, for each object in scene, a ring buffer of prior states (position, orientation, material properties, etc.). Any keystone whose metadata declares `ReadStateHistory` or `WriteStateHistory` is provided a `StateHistory` interface at evaluation time. Keystones without these capabilities cannot reach it.

**v1 implementation.** Fixed-size ring buffer of last N frames per object. Only `Repetition` uses it. No compression, no intelligent retention. When the first spell comes along that breaks this assumption, the buffer is redesigned.

**IR implication.** None. State is a simulator concern. The IR just exposes the capability flag via keystone metadata; the simulator wires up the interface.

---

## Activation semantics

A spell is **structurally valid** if it parses and all referenced IDs resolve. A spell is **active** at a given moment if:

1. All non-half glyphs have `coherence.closure` above a simulator-defined threshold (default: 0.95 for v1 stamped components, meaning effectively closed).
2. All Halves have their Toggle conditions satisfied (e.g., in contact with their complement).
3. All Links endpoints resolve to extant glyphs.

Only the glyph's own `coherence.closure` gates activation. Closure values on sub-elements (center, perimeter keystones) are quality signals the simulator may fold into stability, symmetry, or diagnostics, but they do not block a spell from activating.

Activation is a per-frame computation. A spell can become inactive (toggle half lifts, ring breaks) and reactivate without changing its IR.

**Link resolution must run before per-glyph evaluation.** Amplification is non-local: two identical linked glyphs produce more than the sum of their individual outputs. The simulator cannot evaluate glyphs in isolation and sum the results; it must resolve links first, then evaluate.

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
      "center": {
        "element": { "kind": "Rune", "rune_kind": "Fire" },
        "offset": [0, 0],
        "rotation": 0,
        "extent": { "major": 0.3, "minor": 0.3 },
        "coherence": { "stroke": 1.0, "closure": 1.0, "placement": 1.0, "symmetry": 1.0 }
      },
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
  "halves": [],
  "links": [],
  "toggles": []
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

    center: rune(fire) {
      offset: polar(0, 0)
      rotation: 0
      extent: { major: 0.3, minor: 0.3 }
      coherence: { stroke: 1.0, closure: 1.0, placement: 1.0, symmetry: 1.0 }
    }

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
    "center": {
      "element": { "kind": "Rune", "rune_kind": "Fire" },
      "offset": [0.4, 0],
      "rotation": 0,
      "extent": { "major": 0.3, "minor": 0.3 },
      "coherence": { "stroke": 1.0, "closure": 1.0, "placement": 1.0, "symmetry": 1.0 }
    },
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
  "halves": [], "links": [], "toggles": []
}
```

### Preserve-food spell (repetition, state hook, target)

Repetition keystone in center slot (no rune), three collection keystones in radial symmetry, target is a bread loaf.

```json
{
  "target": { "kind": "ObjectRef", "ref": "bread_loaf" },
  "glyphs": [{
    "id": "g1",
    "position": [0, 0],
    "boundary": { "kind": "Circular", "radius": 1.0 },
    "rotation": 0,
    "coherence": { "stroke": 1.0, "closure": 1.0, "placement": 1.0, "symmetry": 1.0 },
    "center": {
      "element": { "kind": "CenterKeystone", "keystone_kind": "Repetition", "rotation": 0, "reversed": false },
      "offset": [0, 0],
      "rotation": 0,
      "extent": { "major": 0.3, "minor": 0.3 },
      "coherence": { "stroke": 1.0, "closure": 1.0, "placement": 1.0, "symmetry": 1.0 }
    },
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
  "halves": [], "links": [], "toggles": []
}
```

Simulator at evaluation time: sees the center element is a Repetition keystone, checks metadata, sees `ReadStateHistory` + `WriteStateHistory` capabilities, wires up the StateHistory interface for `bread_loaf`, pins its state at activation time.

### Linked amplification (two identical pyreballs)

Two glyphs in the same spell with a link between them.

```json
{
  "target": null,
  "glyphs": [
    { "id": "g1", "position": [0, 0], "...": "same as pyreball above" },
    { "id": "g2", "position": [3, 0], "...": "same as pyreball above" }
  ],
  "halves": [], "toggles": [],
  "links": [
    { "endpoints": ["g1", "g2"], "kind": "Amplify" }
  ]
}
```

Simulator runs link resolution first, then evaluates the pair as amplified.

### Toggle spell (two halves, contact activation)

```json
{
  "target": null,
  "glyphs": [],
  "halves": [
    {
      "id": "h_top",
      "object_ref": { "kind": "ObjectRef", "ref": "stone_surface" },
      "glyph_fragment": { "...": "Glyph with intentional closure gap" }
    },
    {
      "id": "h_bottom",
      "object_ref": { "kind": "ObjectRef", "ref": "foot" },
      "glyph_fragment": { "...": "complementary fragment" }
    }
  ],
  "links": [],
  "toggles": [
    { "halves": ["h_top", "h_bottom"], "condition": { "kind": "Pressure", "threshold": 10.0 } }
  ]
}
```

---

## Validation rules

A WHDL document is valid if and only if:

1. All `GlyphId`, `HalfId`, and `ObjectRef` references resolve to existing entities (or are `null` where permitted).
2. Every Glyph has exactly one center slot occupant.
3. A `CenterKeystone` has `kind` in the center-slot whitelist (per keystone metadata).
4. All `coherence` values are in `[0, 1]`.
5. All `extent.major` and `extent.minor` are positive, finite floats.
6. `Boundary.Circular.radius` is positive; `Boundary.Elliptical.major/minor` positive; `Boundary.Polygonal.vertices` has at least 3 entries.
7. Link endpoints reference distinct glyphs.
8. Toggle halves reference distinct halves.

Invalid documents are rejected at parse time. Structural validity is separate from activation; a structurally valid spell may still be inactive (ring open, halves not in contact).

---

## Implementation notes

### Frontend (TypeScript/React)

- Canvas interaction produces a mutable working model; serialize to WHDL JSON on save / on-backend-request.
- Canonical stamp palette is driven by the keystone metadata table. New keystones added to the table appear in the UI automatically.
- Handles on each stamped element: drag-position, rotation handle, two extent handles (major and minor axes).
- Coherence fields for v1 are always 1.0 — UI should not expose them. Their existence in the serialized JSON is for v2 forward compatibility.
- Ring-closure UX: user draws the glyph boundary; if the boundary is complete, `closure: 1.0`. A "toggle" mode lets the user deliberately leave a gap for Half-style spells.

### Backend (C++ → WASM)

- Parse JSON to IR structs. Keep IR types plain data (no polymorphism beyond tagged unions); pattern-match on kind during evaluation.
- Two-phase evaluation per frame: (1) link resolution (amplify/cancel) to group evaluable units; (2) per-unit simulation producing vector output.
- Keystone metadata table compiled in (v1). Exposed read-only to the frontend via a separate JSON file shipped with the build.
- State history: per-object ring buffer, fixed size (suggest 300 frames / 5 seconds at 60fps for v1).
- Output: `SimulationResult { forces: [(origin, direction, magnitude)], affected_region: Region, stability: float, diagnostics: [Warning] }`.

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
