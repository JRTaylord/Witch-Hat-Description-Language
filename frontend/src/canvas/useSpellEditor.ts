// Spell-editing state hook: holds the current Spell, current selection,
// and provides drag handlers that translate pointer motion into IR mutations.

import { useCallback, useRef, useState } from "react";
import type {
  Cartesian, Center, Coherence, Glyph, Keystone, KeystoneKind,
  Polar, SigilElement, Spell,
} from "../model/types.js";
import type { Selection } from "./SpellSvg.js";

interface DragSession {
  selection: Selection;
  // World-space WHDL coordinates of the pointer at drag start.
  startWhdl: Cartesian;
  // Snapshot of the element's position at drag start (cartesian for glyphs,
  // *cartesian-in-local-frame* for sigils/keystones — converted from polar).
  startLocal: Cartesian;
  // Snapshot of the parent glyph's rotation (for inverse-rotating world-space
  // delta into glyph-local frame). 0 for top-level glyphs.
  glyphRotation: number;
  pointerId: number;
}

export interface SpellEditor {
  spell: Spell;
  setSpell: (s: Spell) => void;
  selection: Selection;
  setSelection: (s: Selection) => void;
  svgRef: React.RefObject<SVGSVGElement | null>;
  onElementPointerDown: (sel: Selection, e: React.PointerEvent<SVGElement>) => void;
  // Element creation. addSigil/addKeystone act on the currently-selected
  // glyph (no-op if nothing is selected) and take the kind to stamp.
  addGlyph: () => void;
  addSigil: (element: SigilElement) => void;
  addKeystone: (kind: KeystoneKind) => void;
}

const polarToCartesian = ([r, theta]: Polar): Cartesian => [
  r * Math.cos(theta), r * Math.sin(theta),
];

const cartesianToPolar = ([x, y]: Cartesian): Polar => [
  Math.sqrt(x * x + y * y), Math.atan2(y, x),
];

const rotate = ([x, y]: Cartesian, theta: number): Cartesian => {
  const c = Math.cos(theta), s = Math.sin(theta);
  return [c * x - s * y, s * x + c * y];
};

// SVG client → WHDL world coordinates (+y up).
function screenToWhdl(svg: SVGSVGElement, e: { clientX: number; clientY: number }): Cartesian {
  const pt = svg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return [0, 0];
  const inWvb = pt.matrixTransform(ctm.inverse());
  // Inside viewBox, +y is down. Flip for WHDL convention.
  return [inWvb.x, -inWvb.y];
}

export function useSpellEditor(initial: Spell): SpellEditor {
  const [spell, setSpell] = useState<Spell>(initial);
  const [selection, setSelection] = useState<Selection>({ kind: "none" });
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragSession | null>(null);

  const findGlyph = (sp: Spell, id: string) => {
    const stack = [...sp.glyphs];
    while (stack.length) {
      const g = stack.pop()!;
      if (g.id === id) return g;
      stack.push(...g.children);
    }
    return null;
  };

  const startDrag = useCallback((sel: Selection, e: React.PointerEvent<SVGElement>) => {
    if (sel.kind === "none" || !svgRef.current) return;

    const startWhdl = screenToWhdl(svgRef.current, e);
    let startLocal: Cartesian = [0, 0];
    let glyphRotation = 0;

    if (sel.kind === "glyph") {
      const g = findGlyph(spell, sel.glyphId);
      if (!g) return;
      startLocal = g.position;
    } else {
      const g = findGlyph(spell, sel.glyphId);
      if (!g) return;
      glyphRotation = g.rotation;
      const polar = sel.kind === "sigil"
        ? g.sigils[sel.index]?.offset
        : g.perimeter[sel.index]?.position;
      if (!polar) return;
      startLocal = polarToCartesian(polar);
    }

    dragRef.current = {
      selection: sel,
      startWhdl,
      startLocal,
      glyphRotation,
      pointerId: e.pointerId,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelection(sel);
  }, [spell]);

  const handleMove = useCallback((e: React.PointerEvent<SVGElement>) => {
    const drag = dragRef.current;
    if (!drag || !svgRef.current || drag.pointerId !== e.pointerId) return;

    const currentWhdl = screenToWhdl(svgRef.current, e);
    const deltaWorld: Cartesian = [
      currentWhdl[0] - drag.startWhdl[0],
      currentWhdl[1] - drag.startWhdl[1],
    ];

    // For sigils/keystones, world delta becomes a local-frame delta by
    // inverse-rotating with the parent glyph's rotation.
    const localDelta = drag.selection.kind === "glyph"
      ? deltaWorld
      : rotate(deltaWorld, -drag.glyphRotation);

    const newLocal: Cartesian = [
      drag.startLocal[0] + localDelta[0],
      drag.startLocal[1] + localDelta[1],
    ];

    setSpell(applyPositionUpdate(spell, drag.selection, newLocal));
  }, [spell]);

  const endDrag = useCallback((e: React.PointerEvent<SVGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragRef.current = null;
  }, []);

  // ─── Element creation ──────────────────────────────────────────────────

  const addGlyph = useCallback(() => {
    const id = freshGlyphId(spell);
    setSpell({ ...spell, glyphs: [...spell.glyphs, makeGlyph(id)] });
    setSelection({ kind: "glyph", glyphId: id });
  }, [spell]);

  const addSigil = useCallback((element: SigilElement) => {
    if (selection.kind === "none") return;
    const glyphId = selection.glyphId;
    const g = findGlyph(spell, glyphId);
    if (!g) return;
    const index = g.sigils.length; // new sigil lands at the end
    setSpell({
      ...spell,
      glyphs: updateGlyphById(spell.glyphs, glyphId, (gg) => ({
        ...gg, sigils: [...gg.sigils, makeSigil(element)],
      })),
    });
    setSelection({ kind: "sigil", glyphId, index });
  }, [spell, selection]);

  const addKeystone = useCallback((kind: KeystoneKind) => {
    if (selection.kind === "none") return;
    const glyphId = selection.glyphId;
    const g = findGlyph(spell, glyphId);
    if (!g) return;
    const index = g.perimeter.length;
    setSpell({
      ...spell,
      glyphs: updateGlyphById(spell.glyphs, glyphId, (gg) => ({
        ...gg, perimeter: [...gg.perimeter, makeKeystone(kind)],
      })),
    });
    setSelection({ kind: "keystone", glyphId, index });
  }, [spell, selection]);

  // We attach move/up listeners to the element that captured the pointer.
  // The SVG-level pointerdown handler delegates by calling startDrag.
  const onElementPointerDown = useCallback((sel: Selection, e: React.PointerEvent<SVGElement>) => {
    e.stopPropagation();
    // Capture the DOM element now: React nulls out `currentTarget` on the
    // synthetic event once this handler returns, so the window listeners below
    // (which fire later) must close over the element itself, not `e`.
    const target = e.currentTarget;
    startDrag(sel, e);
    // Attach move/up via window listeners so drag continues outside the element.
    const moveListener = (ev: PointerEvent) => {
      // Synthesize a React-like wrapper for shared logic.
      handleMove({
        clientX: ev.clientX,
        clientY: ev.clientY,
        pointerId: ev.pointerId,
        currentTarget: target,
      } as unknown as React.PointerEvent<SVGElement>);
    };
    const upListener = (ev: PointerEvent) => {
      endDrag({
        pointerId: ev.pointerId,
        currentTarget: target,
      } as unknown as React.PointerEvent<SVGElement>);
      window.removeEventListener("pointermove", moveListener);
      window.removeEventListener("pointerup", upListener);
      window.removeEventListener("pointercancel", upListener);
    };
    window.addEventListener("pointermove", moveListener);
    window.addEventListener("pointerup", upListener);
    window.addEventListener("pointercancel", upListener);
  }, [startDrag, handleMove, endDrag]);

  return {
    spell, setSpell,
    selection, setSelection,
    svgRef,
    onElementPointerDown,
    addGlyph, addSigil, addKeystone,
  };
}

// ─── Element factories ─────────────────────────────────────────────────
//
// Defaults are chosen to satisfy validate.ts out of the box: coherence in
// [0, 1], positive extents, a positive boundary radius, and — crucially — a
// new glyph ships with one sigil, since the validator rejects empty glyphs.

const DEFAULT_COHERENCE: Coherence = {
  stroke: 1, closure: 1, placement: 1, symmetry: 1,
};

function makeSigil(element: SigilElement): Center {
  return {
    element,
    offset: [0, 0],
    rotation: 0,
    reversed: false,
    extent: { major: 0.5, minor: 0.5 },
    coherence: DEFAULT_COHERENCE,
  };
}

function makeKeystone(kind: KeystoneKind): Keystone {
  return {
    kind,
    position: [1, 0], // r=1, theta=0 → sits on the default glyph's perimeter
    rotation: 0,
    extent: { major: 0.4, minor: 0.2 },
    reversed: false,
    coherence: DEFAULT_COHERENCE,
  };
}

function makeGlyph(id: string): Glyph {
  return {
    id,
    position: [0, 0],
    boundary: { kind: "Circular", radius: 1 },
    rotation: 0,
    coherence: DEFAULT_COHERENCE,
    // Every glyph needs ≥1 sigil to be valid; default to a Fire rune.
    sigils: [makeSigil({ kind: "Rune", rune_kind: "Fire" })],
    perimeter: [],
    children: [],
  };
}

// Smallest unused "glyph-N" id, checking the whole tree (ids are global).
function freshGlyphId(spell: Spell): string {
  const used = new Set<string>();
  const walk = (glyphs: Glyph[]) => {
    for (const g of glyphs) {
      used.add(g.id);
      walk(g.children);
    }
  };
  walk(spell.glyphs);
  let n = 1;
  while (used.has(`glyph-${n}`)) n++;
  return `glyph-${n}`;
}

// Return a new glyph forest with `fn` applied to the glyph whose id matches,
// recursing into children. Like applyPositionUpdate, this never mutates.
function updateGlyphById(glyphs: Glyph[], id: string, fn: (g: Glyph) => Glyph): Glyph[] {
  return glyphs.map((g) =>
    g.id === id ? fn(g) : { ...g, children: updateGlyphById(g.children, id, fn) }
  );
}

// ─── Pure mutator ───────────────────────────────────────────────────────

function applyPositionUpdate(spell: Spell, sel: Selection, newLocal: Cartesian): Spell {
  if (sel.kind === "none") return spell;

  const updateGlyph = (g: Spell["glyphs"][number]): Spell["glyphs"][number] => {
    if (g.id !== sel.glyphId) {
      return { ...g, children: g.children.map(updateGlyph) };
    }
    if (sel.kind === "glyph") {
      return { ...g, position: newLocal };
    }
    if (sel.kind === "sigil") {
      const polar = cartesianToPolar(newLocal);
      return {
        ...g,
        sigils: g.sigils.map((s, i) => i === sel.index ? { ...s, offset: polar } : s),
      };
    }
    if (sel.kind === "keystone") {
      const polar = cartesianToPolar(newLocal);
      return {
        ...g,
        perimeter: g.perimeter.map((k, i) => i === sel.index ? { ...k, position: polar } : k),
      };
    }
    return g;
  };

  return { ...spell, glyphs: spell.glyphs.map(updateGlyph) };
}
