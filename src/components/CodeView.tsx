import { useMemo, type ReactNode } from "react";

/** Above this size, skip highlighting to keep the UI responsive. */
const MAX_HIGHLIGHT = 300_000;

const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

function prettify(text: string): { text: string; json: boolean } {
  try {
    return { text: JSON.stringify(JSON.parse(text), null, 2), json: true };
  } catch {
    return { text, json: false };
  }
}

function highlightJson(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const index = m.index ?? 0;
    if (index > last) out.push(text.slice(last, index));
    const [match, str, colon] = m;
    const cls = str ? (colon ? "tok-key" : "tok-string") : /^[tfn]/.test(match) ? "tok-literal" : "tok-number";
    out.push(<span key={index} className={cls}>{str ?? match}</span>);
    if (colon) out.push(colon);
    last = index + match.length;
  }
  out.push(text.slice(last));
  return out;
}

/** Read-only code block; JSON gets pretty-printed and highlighted. */
export function CodeView({ text }: { text: string }) {
  const content = useMemo(() => {
    const pretty = prettify(text);
    return pretty.json && pretty.text.length < MAX_HIGHLIGHT ? highlightJson(pretty.text) : pretty.text;
  }, [text]);
  return <pre className="code-view">{content}</pre>;
}
