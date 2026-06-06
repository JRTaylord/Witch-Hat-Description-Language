import type { JSX } from "react";
import { useMemo, useState } from "react";
import type { Spell } from "../model/types.js";
import { parse } from "../serialize/parse.js";
import { validate } from "../serialize/validate.js";
import { SpellSvg } from "./SpellSvg.js";
import { useSpellEditor } from "./useSpellEditor.js";

import pyreball from "../../test/fixtures/pyreball.json" with { type: "json" };
import dadaMountains from "../../test/fixtures/dada-mountains.json" with { type: "json" };
import preserveFood from "../../test/fixtures/preserve-food.json" with { type: "json" };
import mixedSpell from "../../test/fixtures/mixed-spell.json" with { type: "json" };
import linkedAmplification from "../../test/fixtures/linked-amplification.json" with { type: "json" };

const FIXTURES = {
  pyreball,
  "dada-mountains": dadaMountains,
  "preserve-food": preserveFood,
  "mixed-spell": mixedSpell,
  "linked-amplification": linkedAmplification,
} satisfies Record<string, unknown>;

type FixtureName = keyof typeof FIXTURES;

export function App(): JSX.Element {
  const [fixtureName, setFixtureName] = useState<FixtureName>("pyreball");
  // Parse the chosen fixture once per name change. Throws are caught by an
  // error display rather than crashing the page.
  const initialSpell = useMemo<Spell | { error: string }>(() => {
    try {
      return parse(FIXTURES[fixtureName]);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [fixtureName]);

  if ("error" in initialSpell) {
    return <div style={{ color: "tomato", padding: 24 }}>Fixture parse failed: {initialSpell.error}</div>;
  }

  return <Editor key={fixtureName} initial={initialSpell} fixtureName={fixtureName} setFixtureName={setFixtureName} />;
}

function Editor({
  initial, fixtureName, setFixtureName,
}: {
  initial: Spell;
  fixtureName: FixtureName;
  setFixtureName: (n: FixtureName) => void;
}): JSX.Element {
  const editor = useSpellEditor(initial);
  const validation = useMemo(() => validate(editor.spell), [editor.spell]);
  const json = useMemo(() => JSON.stringify(editor.spell, null, 2), [editor.spell]);

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <h1 style={styles.title}>WHDL Canvas</h1>
        <label style={styles.label}>
          Fixture:&nbsp;
          <select
            value={fixtureName}
            onChange={(e) => setFixtureName(e.target.value as FixtureName)}
            style={styles.select}
          >
            {Object.keys(FIXTURES).map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
        <ValidationBadge ok={validation.ok} count={validation.errors.length} />
      </header>

      <div style={styles.body}>
        <div style={styles.canvasWrap}>
          <div style={styles.toolbar}>
            <button style={styles.btn} onClick={editor.addGlyph}>
              + Glyph
            </button>
            <button
              style={styles.btn}
              onClick={editor.addSigil}
              disabled={editor.selection.kind === "none"}
            >
              + Sigil
            </button>
            <button
              style={styles.btn}
              onClick={editor.addKeystone}
              disabled={editor.selection.kind === "none"}
            >
              + Keystone
            </button>
          </div>
          <SpellSvg
            spell={editor.spell}
            selection={editor.selection}
            onSelect={editor.setSelection}
            onPointerDown={editor.onElementPointerDown}
            svgRef={editor.svgRef}
          />
          <SelectionInfo editor={editor} />
        </div>

        <aside style={styles.sidebar}>
          <h2 style={styles.h2}>JSON</h2>
          <pre style={styles.pre}>{json}</pre>
          {!validation.ok && (
            <>
              <h2 style={styles.h2}>Validation errors</h2>
              <ul style={styles.errors}>
                {validation.errors.map((err, i) => (
                  <li key={i} style={styles.errorItem}>
                    <code style={styles.code}>{err.code}</code>
                    <div style={styles.errPath}>{err.path}</div>
                    <div>{err.message}</div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function ValidationBadge({ ok, count }: { ok: boolean; count: number }): JSX.Element {
  return (
    <span style={{
      marginLeft: "auto",
      padding: "4px 10px",
      borderRadius: 4,
      background: ok ? "#1d4d1d" : "#5a1f1f",
      color: ok ? "#9be79b" : "#ff9b9b",
      fontFamily: "monospace",
      fontSize: 13,
    }}>
      {ok ? "valid" : `${count} error${count === 1 ? "" : "s"}`}
    </span>
  );
}

function SelectionInfo({ editor }: { editor: ReturnType<typeof useSpellEditor> }): JSX.Element {
  const sel = editor.selection;
  if (sel.kind === "none") {
    return <div style={styles.selInfo}>Click an element to select; drag to reposition.</div>;
  }
  return (
    <div style={styles.selInfo}>
      Selected: <code style={styles.code}>{sel.kind}</code>
      {" in "}
      <code style={styles.code}>{sel.glyphId}</code>
      {sel.kind !== "glyph" && <> [{sel.index}]</>}
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  app: {
    fontFamily: "system-ui, sans-serif",
    color: "#e0e0e0",
    background: "#0d0d0d",
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    padding: "12px 20px",
    borderBottom: "1px solid #2a2a2a",
  },
  title: { margin: 0, fontSize: 18, fontWeight: 500 },
  label: { fontSize: 14 },
  select: {
    background: "#1a1a1a", color: "#e0e0e0",
    border: "1px solid #444", padding: "4px 8px", borderRadius: 3, fontSize: 14,
  },
  body: { display: "flex", flex: 1, overflow: "hidden" },
  canvasWrap: { padding: 20, display: "flex", flexDirection: "column", gap: 12 },
  toolbar: { display: "flex", gap: 8 },
  btn: {
    background: "#1a1a1a", color: "#e0e0e0",
    border: "1px solid #444", padding: "6px 12px", borderRadius: 3,
    fontSize: 14, cursor: "pointer",
  },
  sidebar: {
    flex: 1,
    padding: 20,
    borderLeft: "1px solid #2a2a2a",
    overflow: "auto",
    minWidth: 360,
  },
  h2: { fontSize: 13, fontWeight: 600, margin: "8px 0", color: "#999", textTransform: "uppercase" },
  pre: {
    fontFamily: "ui-monospace, Menlo, monospace",
    fontSize: 12,
    background: "#0a0a0a",
    border: "1px solid #2a2a2a",
    padding: 12,
    borderRadius: 4,
    overflow: "auto",
    margin: 0,
    lineHeight: 1.5,
  },
  errors: { listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 },
  errorItem: { padding: 10, background: "#2a1515", borderRadius: 4, fontSize: 13 },
  errPath: { fontFamily: "monospace", fontSize: 11, color: "#aaa", margin: "4px 0" },
  code: { fontFamily: "monospace", background: "#222", padding: "2px 6px", borderRadius: 3, fontSize: 12 },
  selInfo: { fontSize: 13, color: "#aaa" },
};
