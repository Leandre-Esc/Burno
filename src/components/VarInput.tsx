import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { DYNAMIC, SOURCE_LABELS, tokenize, type Scope } from "../interpolate";

/** Variables visible where the input is rendered (request, environment editor…) */
export const ScopeContext = createContext<Scope>({});

const MAX_SUGGESTIONS = 8;
const OPEN_RE = /\{\{\s*([\w.$-]*)$/;

let canvas: HTMLCanvasElement | null = null;
function textWidth(text: string, font: string) {
  canvas ??= document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  ctx.font = font;
  return ctx.measureText(text).width;
}

interface Suggest {
  /** Index of the `{{` being completed */
  start: number;
  query: string;
  index: number;
  x: number;
  y: number;
}

interface Hover {
  name: string;
  x: number;
  y: number;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  /** Secret value: shown as dots until focused */
  masked?: boolean;
}

/** Text input that highlights `{{variables}}`, explains them on hover and completes them after `{{`. */
export function VarInput({ value, onChange, placeholder, className = "", inputClassName = "", masked = false }: Props) {
  const scope = useContext(ScopeContext);
  const input = useRef<HTMLInputElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [hover, setHover] = useState<Hover | null>(null);
  const [suggest, setSuggest] = useState<Suggest | null>(null);

  const hidden = masked && !focused;
  const highlight = !hidden && value.includes("{{");

  // The mirror draws the colored text under the transparent input text: same font and padding
  useLayoutEffect(() => {
    if (!highlight || !input.current || !mirror.current) return;
    const cs = getComputedStyle(input.current);
    const px = (a: string, b: string) => `${parseFloat(a) + parseFloat(b)}px`;
    Object.assign(mirror.current.style, {
      font: cs.font,
      letterSpacing: cs.letterSpacing,
      paddingLeft: px(cs.paddingLeft, cs.borderLeftWidth),
      paddingRight: px(cs.paddingRight, cs.borderRightWidth),
    });
    sync();
  });

  const sync = () => {
    if (inner.current && input.current) inner.current.style.transform = `translateX(${-input.current.scrollLeft}px)`;
  };

  const options = useMemo(() => {
    if (!suggest) return [];
    const q = suggest.query.toLowerCase();
    // Own variables first, then .env values, then built-in dynamic ones
    const own = Object.keys(scope).filter((n) => scope[n].source !== "dotenv");
    const dotenv = Object.keys(scope).filter((n) => scope[n].source === "dotenv");
    const names = [...own, ...dotenv, ...Object.keys(DYNAMIC)].filter((n) => n.toLowerCase().includes(q));
    names.sort((a, b) => Number(!a.toLowerCase().startsWith(q)) - Number(!b.toLowerCase().startsWith(q)));
    return names.slice(0, MAX_SUGGESTIONS);
  }, [suggest?.query, scope]);

  const detect = () => {
    const el = input.current;
    if (!el || el.selectionStart !== el.selectionEnd) return setSuggest(null);
    const caret = el.selectionStart ?? el.value.length;
    const m = OPEN_RE.exec(el.value.slice(0, caret));
    if (!m) return setSuggest(null);
    const start = caret - m[0].length;
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const x = rect.left + parseFloat(cs.paddingLeft) + textWidth(el.value.slice(0, start), cs.font) - el.scrollLeft;
    setSuggest((s) => ({ start, query: m[1], index: s?.query === m[1] ? s.index : 0, x: Math.min(x, rect.right - 220), y: rect.bottom + 4 }));
  };

  const accept = (name: string) => {
    const el = input.current;
    if (!el || !suggest) return;
    const caret = el.selectionStart ?? el.value.length;
    const rest = el.value.slice(caret).replace(/^[\w.$-]*\s*\}\}/, "");
    const before = `${el.value.slice(0, suggest.start)}{{${name}}}`;
    onChange(before + rest);
    setSuggest(null);
    requestAnimationFrame(() => el.setSelectionRange(before.length, before.length));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    setHover(null);
    if (!suggest || !options.length || e.metaKey || e.ctrlKey) return;
    const move = (d: number) => setSuggest({ ...suggest, index: (suggest.index + d + options.length) % options.length });
    if (e.key === "ArrowDown") move(1);
    else if (e.key === "ArrowUp") move(-1);
    else if (e.key === "Enter" || e.key === "Tab") accept(options[suggest.index]);
    else if (e.key === "Escape") setSuggest(null);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!highlight || !mirror.current) return setHover(null);
    for (const span of mirror.current.querySelectorAll<HTMLElement>("[data-var]")) {
      const r = span.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        return setHover({ name: span.dataset.var!, x: r.left, y: r.bottom + 6 });
      }
    }
    setHover(null);
  };

  return (
    <div className={`var-input ${className}`}>
      {highlight && (
        <div className="var-mirror" ref={mirror} aria-hidden>
          <span ref={inner}>
            {tokenize(value).map((part, i) =>
              part.name ? (
                <span key={i} data-var={part.name} className={part.name in scope || part.name in DYNAMIC ? "var-ok" : "var-missing"}>
                  {part.text}
                </span>
              ) : (
                part.text
              ),
            )}
          </span>
        </div>
      )}
      <input
        ref={input}
        type={hidden ? "password" : "text"}
        className={`${inputClassName} ${highlight ? "has-vars" : ""}`}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          requestAnimationFrame(detect);
        }}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => {
          if (e.key.startsWith("Arrow") && !suggest) detect();
          sync();
        }}
        onClick={detect}
        onScroll={sync}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setSuggest(null);
          setHover(null);
        }}
        onMouseMove={onMouseMove}
        onMouseLeave={() => setHover(null)}
      />
      {hover && !suggest && createPortal(<VarTooltip name={hover.name} scope={scope} x={hover.x} y={hover.y} />, document.body)}
      {suggest &&
        options.length > 0 &&
        createPortal(
          <ul className="var-suggest" style={{ left: suggest.x, top: suggest.y }}>
            {options.map((name, i) => (
              <li
                key={name}
                className={i === suggest.index ? "active" : ""}
                onMouseDown={(e) => {
                  e.preventDefault();
                  accept(name);
                }}
                onMouseEnter={() => setSuggest({ ...suggest, index: i })}
              >
                <span className="var-suggest-name">{name}</span>
                <span className="var-suggest-meta">{name in scope ? SOURCE_LABELS[scope[name].source] : "Dynamic"}</span>
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </div>
  );
}

const mask = (value: string) => "•".repeat(Math.min(Math.max(value.length, 6), 16));

function VarTooltip({ name, scope, x, y }: { name: string; scope: Scope; x: number; y: number }) {
  const v = scope[name];
  const dynamic = DYNAMIC[name];
  return (
    <div className="var-tooltip" style={{ left: Math.min(x, window.innerWidth - 340), top: y }}>
      <div className="var-tooltip-name">
        <code>{name}</code>
        <span className={`var-tag ${v ? v.source : dynamic ? "" : "missing"}`}>
          {v ? SOURCE_LABELS[v.source] : dynamic ? "Dynamic" : "Undefined"}
        </span>
      </div>
      {v ? (
        <>
          <div className="var-tooltip-value">{v.secret ? mask(v.value) : v.value || <em>empty</em>}</div>
          {v.raw !== v.value && !v.secret && <div className="var-tooltip-note">from <code>{v.raw}</code></div>}
          {v.overrides.length > 0 && (
            <div className="var-tooltip-note">Overrides {v.overrides.map((s) => SOURCE_LABELS[s]).join(", ")}</div>
          )}
        </>
      ) : dynamic ? (
        <div className="var-tooltip-note">{dynamic.description}, generated on each request</div>
      ) : (
        <div className="var-tooltip-note">Not defined in the request, the active environments or the collection.</div>
      )}
    </div>
  );
}
