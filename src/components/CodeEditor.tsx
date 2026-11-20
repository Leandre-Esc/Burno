import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, acceptCompletion, completionStatus, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentLess, indentMore } from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { xml } from "@codemirror/lang-xml";
import { bracketMatching, foldGutter, foldKeymap, HighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { linter, lintKeymap, type Diagnostic } from "@codemirror/lint";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorSelection, EditorState, Facet, type Extension, type StateCommand } from "@codemirror/state";
import {
  Decoration,
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  hoverTooltip,
  keymap,
  lineNumbers,
  MatchDecorator,
  placeholder as placeholderExt,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { useContext, useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { createRoot } from "react-dom/client";
import type { BodyIssue } from "../bodyFormat";
import { DYNAMIC, SOURCE_LABELS, type Scope } from "../interpolate";
import { ScopeContext, VarInfo } from "./VarInput";

export type CodeLanguage = "json" | "xml" | "text";

export interface CursorInfo {
  line: number;
  col: number;
  selected: number;
}

export interface CodeEditorHandle {
  /** Focuses the editor and selects the range */
  reveal: (from: number, to?: number) => void;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  language: CodeLanguage;
  placeholder?: string;
  wrap?: boolean;
  /** Syntax check shown as an underline in the text */
  validate?: (text: string) => BodyIssue | null;
  onCursor?: (cursor: CursorInfo) => void;
  ref?: Ref<CodeEditorHandle>;
}

const INDENT = 2;
const VAR_RE = /\{\{\s*([\w.$-]+)\s*\}\}/g;

// ───────────── Variables: highlight, hover, completion ─────────────

const scopeFacet = Facet.define<Scope, Scope>({ combine: (values) => values[values.length - 1] ?? {} });

const known = (scope: Scope, name: string) => name in scope || name in DYNAMIC;

function varDecorator(scope: Scope) {
  return new MatchDecorator({
    regexp: VAR_RE,
    decoration: (m) => Decoration.mark({ class: known(scope, m[1]) ? "cm-var cm-var-ok" : "cm-var cm-var-missing" }),
  });
}

const varHighlight = ViewPlugin.fromClass(
  class {
    decorator: MatchDecorator;
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorator = varDecorator(view.state.facet(scopeFacet));
      this.decorations = this.decorator.createDeco(view);
    }
    update(u: ViewUpdate) {
      const scope = u.state.facet(scopeFacet);
      if (scope !== u.startState.facet(scopeFacet)) {
        this.decorator = varDecorator(scope);
        this.decorations = this.decorator.createDeco(u.view);
      } else {
        this.decorations = this.decorator.updateDeco(u, this.decorations);
      }
    }
  },
  { decorations: (p) => p.decorations },
);

const varHover = hoverTooltip((view, pos) => {
  const line = view.state.doc.lineAt(pos);
  for (const m of line.text.matchAll(VAR_RE)) {
    const from = line.from + m.index;
    const to = from + m[0].length;
    if (pos < from || pos > to) continue;
    return {
      pos: from,
      end: to,
      above: false,
      create: () => {
        const dom = document.createElement("div");
        dom.className = "cm-var-tooltip";
        const root = createRoot(dom);
        root.render(<VarInfo name={m[1]} scope={view.state.facet(scopeFacet)} />);
        return { dom, destroy: () => setTimeout(() => root.unmount()) };
      },
    };
  }
  return null;
});

/** After `{{`, suggests variables; the label is the bare name so filtering matches what is typed after `{{`. */
function completeVars(context: CompletionContext): CompletionResult | null {
  const before = context.matchBefore(/\{\{\s*[\w.$-]*$/);
  if (!before) return null;
  const query = /[\w.$-]*$/.exec(before.text)![0];
  const scope = context.state.facet(scopeFacet);
  // Swallow an existing `name}}` after the cursor so `{{|}}` and edits inside a variable stay clean
  const after = /^[\w.$-]*\s*\}\}/.exec(context.state.sliceDoc(context.pos, context.pos + 200));
  const to = context.pos + (after?.[0].length ?? 0);
  const option = (name: string, detail: string, boost: number) => ({
    label: name,
    detail,
    boost,
    apply: (view: EditorView) => {
      const insert = `{{${name}}}`;
      view.dispatch({ changes: { from: before.from, to, insert }, selection: { anchor: before.from + insert.length }, userEvent: "input.complete" });
    },
  });
  const own = Object.keys(scope).filter((n) => scope[n].source !== "dotenv");
  const dotenv = Object.keys(scope).filter((n) => scope[n].source === "dotenv");
  return {
    from: context.pos - query.length,
    options: [
      ...own.map((n) => option(n, SOURCE_LABELS[scope[n].source], 2)),
      ...dotenv.map((n) => option(n, ".env file", 1)),
      ...Object.entries(DYNAMIC).map(([n, d]) => option(n, d.description, 0)),
    ],
  };
}

// ───────────── Keys ─────────────

/** Tab: with a selection indent the lines, otherwise insert spaces up to the next tab stop. */
const tabForward: StateCommand = ({ state, dispatch }) => {
  if (state.selection.ranges.some((r) => !r.empty)) return indentMore({ state, dispatch });
  dispatch(
    state.update(
      state.changeByRange((range) => {
        const line = state.doc.lineAt(range.head);
        const col = range.head - line.from;
        const spaces = " ".repeat(INDENT - (col % INDENT));
        return { changes: { from: range.head, insert: spaces }, range: EditorSelection.cursor(range.head + spaces.length) };
      }),
      { scrollIntoView: true, userEvent: "input.indent" },
    ),
  );
  return true;
};

/** ⌘↵ sends the request (handled by the app), so the editor must not take it */
const appKeys = new Set(["Mod-Enter", "Mod-k"]);
const editorKeys = [...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, ...lintKeymap].filter(
  (b) => !b.key || !appKeys.has(b.key),
);

// ───────────── Look ─────────────

const highlight = HighlightStyle.define([
  { tag: t.propertyName, color: "var(--tok-key)" },
  { tag: [t.string, t.special(t.string)], color: "var(--tok-string)" },
  { tag: t.number, color: "var(--tok-number)" },
  { tag: [t.bool, t.null, t.keyword], color: "var(--tok-literal)", fontWeight: "600" },
  { tag: [t.tagName, t.angleBracket], color: "var(--tok-key)" },
  { tag: t.attributeName, color: "var(--purple)" },
  { tag: t.attributeValue, color: "var(--tok-string)" },
  { tag: [t.comment, t.processingInstruction, t.documentMeta], color: "var(--muted)", fontStyle: "italic" },
  { tag: [t.brace, t.squareBracket, t.separator, t.punctuation], color: "var(--text-2)" },
  { tag: t.character, color: "var(--tok-number)" },
  { tag: t.invalid, color: "var(--red)" },
]);

const theme = EditorView.theme({
  "&": { height: "100%", color: "var(--text)", backgroundColor: "transparent", fontSize: "12.5px" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--mono)", lineHeight: "1.6", overflow: "auto" },
  ".cm-content": { padding: "10px 0", caretColor: "var(--text)" },
  ".cm-line": { padding: "0 14px 0 6px" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--accent-ring) !important",
  },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--text) 3.5%, transparent)" },
  ".cm-gutters": { backgroundColor: "transparent", color: "var(--muted)", border: "none", paddingLeft: "4px" },
  ".cm-lineNumbers .cm-gutterElement": { minWidth: "26px", padding: "0 6px 0 4px", opacity: "0.65" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text-2)" },
  ".cm-activeLineGutter.cm-gutterElement": { opacity: "1" },
  ".cm-foldGutter .cm-gutterElement": { width: "14px", color: "var(--muted)", cursor: "pointer", transition: "color 0.12s" },
  ".cm-foldGutter .cm-gutterElement:hover": { color: "var(--text)" },
  ".cm-foldPlaceholder": { backgroundColor: "var(--surface-3)", border: "none", color: "var(--text-2)", padding: "0 6px", borderRadius: "4px" },
  "&.cm-focused .cm-matchingBracket": { backgroundColor: "var(--accent-soft)", outline: "1px solid var(--accent-ring)", borderRadius: "2px" },
  "&.cm-focused .cm-nonmatchingBracket": { backgroundColor: "color-mix(in srgb, var(--red) 20%, transparent)" },
  ".cm-selectionMatch": { backgroundColor: "color-mix(in srgb, var(--blue) 16%, transparent)" },
  ".cm-searchMatch": { backgroundColor: "color-mix(in srgb, var(--yellow) 22%, transparent)", outline: "1px solid color-mix(in srgb, var(--yellow) 45%, transparent)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "color-mix(in srgb, var(--yellow) 45%, transparent)" },
  ".cm-placeholder": { color: "var(--muted)", opacity: "0.7" },
  ".cm-tooltip": { backgroundColor: "var(--surface)", border: "1px solid var(--border-strong)", borderRadius: "10px", boxShadow: "var(--shadow)", overflow: "hidden" },
  ".cm-tooltip-autocomplete > ul": { fontFamily: "var(--mono)", fontSize: "12px", maxHeight: "260px", padding: "4px" },
  ".cm-tooltip-autocomplete > ul > li": { padding: "4px 9px !important", borderRadius: "6px", display: "flex", alignItems: "center", gap: "10px" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--accent-soft)", color: "var(--text)" },
  ".cm-completionIcon": { display: "none" },
  ".cm-completionLabel": { flex: "1" },
  ".cm-completionMatchedText": { textDecoration: "none", color: "var(--accent)", fontWeight: "650" },
  ".cm-completionDetail": { fontFamily: "Inter, sans-serif", fontStyle: "normal", fontSize: "10.5px", color: "var(--muted)", marginLeft: "auto" },
  ".cm-tooltip-lint": { padding: "2px" },
  ".cm-diagnostic": { fontSize: "12px", padding: "6px 10px", borderLeft: "none" },
  ".cm-diagnostic-error": { color: "var(--red)" },
  ".cm-lintRange-error": {
    backgroundImage: "none",
    textDecoration: "underline wavy var(--red)",
    textUnderlineOffset: "3px",
    textDecorationSkipInk: "none",
  },
  ".cm-panels": { backgroundColor: "var(--surface-2)", color: "var(--text)" },
  ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--border)" },
  ".cm-search": { fontSize: "12px", padding: "6px 10px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 6px" },
  ".cm-search br": { display: "none" },
  ".cm-search label": { display: "inline-flex", alignItems: "center", gap: "4px", color: "var(--text-2)" },
  ".cm-textfield": {
    height: "26px", padding: "0 8px", borderRadius: "6px", border: "1px solid var(--border-strong)", backgroundColor: "var(--surface)",
    color: "var(--text)", fontFamily: "var(--mono)", fontSize: "12px", outline: "none", margin: "0",
  },
  ".cm-textfield:focus": { borderColor: "var(--accent)" },
  ".cm-button": {
    height: "26px", padding: "0 10px", borderRadius: "6px", border: "1px solid var(--border)", backgroundImage: "none",
    backgroundColor: "var(--surface)", color: "var(--text-2)", fontSize: "12px", margin: "0",
  },
  ".cm-button:hover": { color: "var(--text)", borderColor: "var(--border-strong)" },
  ".cm-search [name=close]": { color: "var(--muted)", fontSize: "18px", cursor: "pointer", right: "8px", top: "6px" },
});

function languageExtension(language: CodeLanguage): Extension {
  if (language === "json") return json();
  if (language === "xml") return xml();
  return [];
}

// ───────────── Component ─────────────

/** Code editor for request bodies: indentation, highlighting, folding, search and `{{variables}}`. */
export function CodeEditor({ value, onChange, language, placeholder = "", wrap = false, validate, onCursor, ref }: Props) {
  const scope = useContext(ScopeContext);
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const compartments = useRef({ scope: new Compartment(), wrap: new Compartment(), lint: new Compartment() });
  // Latest callbacks without rebuilding the editor
  const callbacks = useRef({ onChange, onCursor, validate });
  callbacks.current = { onChange, onCursor, validate };

  useImperativeHandle(ref, () => ({
    reveal: (from, to = from) => {
      const v = view.current;
      if (!v) return;
      const len = v.state.doc.length;
      v.dispatch({ selection: { anchor: Math.min(from, len), head: Math.min(to, len) }, scrollIntoView: true });
      v.focus();
    },
  }));

  useEffect(() => {
    const c = compartments.current;
    const reportCursor = (state: EditorState) => {
      const head = state.selection.main.head;
      const line = state.doc.lineAt(head);
      const selected = state.selection.ranges.reduce((n, r) => n + r.to - r.from, 0);
      callbacks.current.onCursor?.({ line: line.number, col: head - line.from + 1, selected });
    };
    const lint = linter(
      (v): Diagnostic[] => {
        const issue = callbacks.current.validate?.(v.state.doc.toString());
        if (!issue) return [];
        const len = v.state.doc.length;
        const from = Math.min(issue.from, len);
        return [{ from, to: Math.min(Math.max(issue.to, from), len), severity: "error", message: issue.message }];
      },
      { delay: 300 },
    );
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        foldGutter({ openText: "▾", closedText: "▸" }),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        indentUnit.of(" ".repeat(INDENT)),
        EditorState.tabSize.of(INDENT),
        syntaxHighlighting(highlight),
        bracketMatching(),
        closeBrackets(),
        autocompletion({ override: [completeVars], icons: false, activateOnTyping: true }),
        highlightActiveLine(),
        highlightSelectionMatches(),
        search({ top: false }),
        placeholderExt(placeholder),
        keymap.of([
          { key: "Tab", run: (v) => (completionStatus(v.state) === "active" ? acceptCompletion(v) : tabForward(v)), shift: indentLess },
          ...editorKeys,
        ]),
        languageExtension(language),
        c.scope.of(scopeFacet.of(scope)),
        c.wrap.of(wrap ? EditorView.lineWrapping : []),
        c.lint.of(lint),
        varHighlight,
        varHover,
        theme,
        EditorView.contentAttributes.of({ spellcheck: "false", autocorrect: "off", autocapitalize: "off", "aria-label": "Request body" }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) callbacks.current.onChange(u.state.doc.toString());
          if (u.docChanged || u.selectionSet) reportCursor(u.state);
        }),
      ],
    });
    const v = new EditorView({ state, parent: host.current! });
    view.current = v;
    reportCursor(state);
    return () => {
      v.destroy();
      view.current = null;
    };
    // Language and placeholder are fixed for an editor instance (the parent remounts it with a key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Outside changes (formatting, file reloaded from disk…) replace the text, keeping it undoable
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const current = v.state.doc.toString();
    if (value === current) return;
    // Only touch the part that changed so the cursor and scroll stay put
    let start = 0;
    while (start < value.length && start < current.length && value[start] === current[start]) start++;
    let endA = current.length;
    let endB = value.length;
    while (endA > start && endB > start && current[endA - 1] === value[endB - 1]) {
      endA--;
      endB--;
    }
    v.dispatch({ changes: { from: start, to: endA, insert: value.slice(start, endB) } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: compartments.current.scope.reconfigure(scopeFacet.of(scope)) });
  }, [scope]);

  useEffect(() => {
    view.current?.dispatch({ effects: compartments.current.wrap.reconfigure(wrap ? EditorView.lineWrapping : []) });
  }, [wrap]);

  return <div className="code-editor" ref={host} />;
}
