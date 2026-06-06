import type { JSX } from "react";
import type {
  Boundary, Cartesian, Center, Glyph, Keystone, Polar, Spell,
} from "../model/types.js";
import { RUNE_INFO } from "../model/lore.js";

// ─── Coordinate system ──────────────────────────────────────────────────
//
// WHDL: +x right, +y up, abstract units.
// SVG: +x right, +y down, pixel units.
// We render inside a <g transform="scale(1,-1)"> so internal math uses
// WHDL's +y-up convention. Text would be flipped — we render none in v1.

export type Selection =
  | { kind: "none" }
  | { kind: "glyph"; glyphId: string }
  | { kind: "sigil"; glyphId: string; index: number }
  | { kind: "keystone"; glyphId: string; index: number };

export const selectionEquals = (a: Selection, b: Selection): boolean => {
  if (a.kind !== b.kind) return false;
  if (a.kind === "none" || b.kind === "none") return a.kind === b.kind;
  if (a.kind === "glyph" && b.kind === "glyph") return a.glyphId === b.glyphId;
  if ((a.kind === "sigil" || a.kind === "keystone") &&
      (b.kind === "sigil" || b.kind === "keystone")) {
    return a.glyphId === b.glyphId && a.index === b.index;
  }
  return false;
};

const polarToCartesian = ([r, theta]: Polar): Cartesian => [
  r * Math.cos(theta),
  r * Math.sin(theta),
];

// ─── Element renderers ──────────────────────────────────────────────────

interface RenderProps {
  spell: Spell;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onPointerDown?: (s: Selection, e: React.PointerEvent<SVGElement>) => void;
  svgRef?: React.Ref<SVGSVGElement>;
}

export function SpellSvg({ spell, selection, onSelect, onPointerDown, svgRef }: RenderProps): JSX.Element {
  return (
    <svg
      ref={svgRef}
      viewBox="-5 -5 10 10"
      width="600"
      height="600"
      style={{ background: "#1a1a1a", border: "1px solid #333" }}
      onPointerDown={(e) => {
        // Click on empty SVG area clears selection.
        if (e.target === e.currentTarget) onSelect({ kind: "none" });
      }}
    >
      {/* Flip y so WHDL's +y-up convention applies inside this group. */}
      <g transform="scale(1, -1)">
        <Grid />
        {spell.glyphs.map((g) => (
          <GlyphSvg
            key={g.id}
            glyph={g}
            selection={selection}
            onSelect={onSelect}
            onPointerDown={onPointerDown}
          />
        ))}
      </g>
    </svg>
  );
}

function Grid(): JSX.Element {
  const lines: JSX.Element[] = [];
  for (let i = -5; i <= 5; i++) {
    lines.push(
      <line key={`h${i}`} x1={-5} y1={i} x2={5} y2={i}
        stroke="#2a2a2a" strokeWidth={i === 0 ? 0.02 : 0.01} />,
      <line key={`v${i}`} x1={i} y1={-5} x2={i} y2={5}
        stroke="#2a2a2a" strokeWidth={i === 0 ? 0.02 : 0.01} />,
    );
  }
  return <>{lines}</>;
}

interface GlyphRenderProps {
  glyph: Glyph;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onPointerDown?: (s: Selection, e: React.PointerEvent<SVGElement>) => void;
}

function GlyphSvg({ glyph, selection, onSelect, onPointerDown }: GlyphRenderProps): JSX.Element {
  const [px, py] = glyph.position;
  const isSelected = selection.kind === "glyph" && selection.glyphId === glyph.id;
  return (
    <g transform={`translate(${px}, ${py}) rotate(${(glyph.rotation * 180) / Math.PI})`}>
      <BoundarySvg
        boundary={glyph.boundary}
        selected={isSelected}
        onPointerDown={(e) => onPointerDown?.({ kind: "glyph", glyphId: glyph.id }, e)}
      />
      {glyph.sigils.map((s, i) => (
        <SigilSvg
          key={i}
          sigil={s}
          selected={selection.kind === "sigil" && selection.glyphId === glyph.id && selection.index === i}
          onPointerDown={(e) => onPointerDown?.({ kind: "sigil", glyphId: glyph.id, index: i }, e)}
        />
      ))}
      {glyph.perimeter.map((k, i) => (
        <KeystoneSvg
          key={i}
          keystone={k}
          selected={selection.kind === "keystone" && selection.glyphId === glyph.id && selection.index === i}
          onPointerDown={(e) => onPointerDown?.({ kind: "keystone", glyphId: glyph.id, index: i }, e)}
        />
      ))}
      {glyph.children.map((child) => (
        <GlyphSvg
          key={child.id}
          glyph={child}
          selection={selection}
          onSelect={onSelect}
          onPointerDown={onPointerDown}
        />
      ))}
    </g>
  );
}

function BoundarySvg({
  boundary, selected, onPointerDown,
}: {
  boundary: Boundary;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent<SVGElement>) => void;
}): JSX.Element {
  const stroke = selected ? "#fff" : "#888";
  const strokeWidth = selected ? 0.04 : 0.025;
  const common = {
    fill: "none",
    stroke,
    strokeWidth,
    style: { cursor: "grab" },
    onPointerDown,
  };
  switch (boundary.kind) {
    case "Circular":
      return <circle cx={0} cy={0} r={boundary.radius} {...common} />;
    case "Elliptical":
      return <ellipse cx={0} cy={0} rx={boundary.major} ry={boundary.minor} {...common} />;
    case "Polygonal": {
      const pts = boundary.vertices.map(([x, y]) => `${x},${y}`).join(" ");
      return <polygon points={pts} {...common} />;
    }
  }
}

function SigilSvg({
  sigil, selected, onPointerDown,
}: {
  sigil: Center;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent<SVGElement>) => void;
}): JSX.Element {
  const [cx, cy] = polarToCartesian(sigil.offset);
  const color = sigilColor(sigil);
  const stroke = selected ? "#fff" : "rgba(255,255,255,0.4)";
  const r = Math.max(sigil.extent.major, sigil.extent.minor) * 0.5;
  return (
    <g transform={`translate(${cx}, ${cy}) rotate(${(sigil.rotation * 180) / Math.PI})`}>
      <ellipse
        cx={0} cy={0}
        rx={sigil.extent.major * 0.5}
        ry={sigil.extent.minor * 0.5}
        fill={color}
        stroke={stroke}
        strokeWidth={selected ? 0.04 : 0.02}
        style={{ cursor: "grab" }}
        onPointerDown={onPointerDown}
      />
      {/* Tiny inner dot so very small sigils stay visible */}
      <circle cx={0} cy={0} r={r * 0.15} fill="rgba(255,255,255,0.7)" pointerEvents="none" />
    </g>
  );
}

function sigilColor(sigil: Center): string {
  // Colours live in the rune metadata table (single source of truth).
  return sigil.element.kind === "Rune"
    ? RUNE_INFO[sigil.element.rune_kind].color
    : "#aaaaaa"; // CenterKeystone
}

function KeystoneSvg({
  keystone, selected, onPointerDown,
}: {
  keystone: Keystone;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent<SVGElement>) => void;
}): JSX.Element {
  const [cx, cy] = polarToCartesian(keystone.position);
  const stroke = selected ? "#fff" : "rgba(255,255,255,0.5)";
  return (
    <g transform={`translate(${cx}, ${cy}) rotate(${(keystone.rotation * 180) / Math.PI})`}>
      <rect
        x={-keystone.extent.major / 2}
        y={-keystone.extent.minor / 2}
        width={keystone.extent.major}
        height={keystone.extent.minor}
        fill={keystone.reversed ? "rgba(220,120,80,0.6)" : "rgba(180,180,220,0.6)"}
        stroke={stroke}
        strokeWidth={selected ? 0.04 : 0.02}
        style={{ cursor: "grab" }}
        onPointerDown={onPointerDown}
      />
    </g>
  );
}
