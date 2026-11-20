import type { KeyValue } from "./types";

/**
 * Helpers for raw request bodies. Bodies may contain `{{variables}}` anywhere, including
 * where JSON expects a value (`"id": {{userId}}`), so JSON.parse can't be used as-is.
 */

export interface BodyIssue {
  message: string;
  from: number;
  to: number;
}

type TokenType = "punct" | "string" | "number" | "literal" | "var";
interface Token {
  type: TokenType;
  text: string;
  from: number;
  to: number;
}

class JsonError extends Error {
  constructor(message: string, readonly from: number, readonly to: number) {
    super(message);
  }
}

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const LITERAL = /true|false|null/y;
const VAR = /\{\{\s*[\w.$-]+\s*\}\}/y;
const WORD = /[^\s{}[\]:,"]+/y;

function stick(re: RegExp, text: string, at: number) {
  re.lastIndex = at;
  return re.exec(text)?.[0];
}

function tokenizeJson(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    const at = i;
    const push = (type: TokenType, len: number) => {
      tokens.push({ type, text: text.slice(at, at + len), from: at, to: at + len });
      i = at + len;
    };
    let m: string | undefined;
    if (c === "{" && (m = stick(VAR, text, i))) push("var", m.length);
    else if ("{}[]:,".includes(c)) push("punct", 1);
    else if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') {
        if (text[j] === "\n") throw new JsonError("Unterminated string", at, j);
        j += text[j] === "\\" ? 2 : 1;
      }
      if (j >= text.length) throw new JsonError("Unterminated string", at, text.length);
      push("string", j + 1 - at);
    } else if ((m = stick(NUMBER, text, i)) && !stick(WORD, text, i + m.length)) push("number", m.length);
    else if ((m = stick(LITERAL, text, i)) && !stick(WORD, text, i + m.length)) push("literal", m.length);
    else {
      const word = stick(WORD, text, i) ?? c;
      const hint = c === "'" ? " (use double quotes)" : /^[A-Za-z_$]/.test(word) ? ` (keys and strings need "quotes")` : "";
      throw new JsonError(`Unexpected ${JSON.stringify(word)}${hint}`, at, at + word.length);
    }
  }
  return tokens;
}

function parseTokens(tokens: Token[], textLength: number) {
  let pos = 0;
  const end = () => new JsonError("Unexpected end of JSON", textLength, textLength);
  const peek = () => tokens[pos];
  const expect = (what: string) => {
    const t = tokens[pos];
    if (!t) throw end();
    if (t.text !== what) throw new JsonError(`Expected '${what}' but found ${t.text}`, t.from, t.to);
    pos++;
  };

  const value = (): void => {
    const t = tokens[pos];
    if (!t) throw end();
    if (t.type !== "punct") {
      pos++;
      return;
    }
    if (t.text === "{") {
      pos++;
      if (peek()?.text === "}") return void pos++;
      for (;;) {
        const key = tokens[pos];
        if (!key) throw end();
        if (key.type !== "string" && key.type !== "var") {
          throw new JsonError(key.text === "}" ? "Trailing comma" : `Expected a "key" but found ${key.text}`, key.from, key.to);
        }
        pos++;
        expect(":");
        value();
        const next = tokens[pos];
        if (!next) throw end();
        if (next.text === "}") return void pos++;
        if (next.text !== ",") throw new JsonError(`Expected ',' or '}' but found ${next.text}`, next.from, next.to);
        pos++;
      }
    }
    if (t.text === "[") {
      pos++;
      if (peek()?.text === "]") return void pos++;
      for (;;) {
        if (peek()?.text === "]") throw new JsonError("Trailing comma", peek().from, peek().to);
        value();
        const next = tokens[pos];
        if (!next) throw end();
        if (next.text === "]") return void pos++;
        if (next.text !== ",") throw new JsonError(`Expected ',' or ']' but found ${next.text}`, next.from, next.to);
        pos++;
      }
    }
    throw new JsonError(`Unexpected ${t.text}`, t.from, t.to);
  };

  value();
  const extra = tokens[pos];
  if (extra) throw new JsonError(`Unexpected ${extra.text} after the end of the JSON`, extra.from, extra.to);
}

function analyze(text: string): { tokens: Token[] } | { issue: BodyIssue } {
  try {
    const tokens = tokenizeJson(text);
    parseTokens(tokens, text.length);
    return { tokens };
  } catch (e) {
    if (e instanceof JsonError) return { issue: { message: e.message, from: e.from, to: Math.max(e.to, e.from) } };
    throw e;
  }
}

/** Returns the first syntax error of a JSON body, `{{variables}}` allowed as values. Empty bodies are fine. */
export function checkJson(text: string): BodyIssue | null {
  if (!text.trim()) return null;
  const result = analyze(text);
  return "issue" in result ? result.issue : null;
}

/** Pretty-prints (indent > 0) or minifies (indent = 0) a JSON body; null when it isn't valid. */
export function formatJson(text: string, indent = 2): string | null {
  if (!text.trim()) return text;
  const result = analyze(text);
  if ("issue" in result) return null;
  const { tokens } = result;
  const pad = (depth: number) => (indent ? `\n${" ".repeat(indent * depth)}` : "");
  let out = "";
  let depth = 0;
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    const next = tokens[k + 1];
    if (t.text === "{" || t.text === "[") {
      if (t.type === "punct" && (next?.text === "}" || next?.text === "]")) {
        out += t.text + next.text;
        k++;
      } else {
        out += t.text + pad(++depth);
      }
    } else if (t.type === "punct" && (t.text === "}" || t.text === "]")) {
      out += pad(--depth) + t.text;
    } else if (t.type === "punct" && t.text === ",") {
      out += "," + pad(depth);
    } else if (t.type === "punct" && t.text === ":") {
      out += indent ? ": " : ":";
    } else {
      out += t.text;
    }
  }
  return out;
}

// ───────────── XML ─────────────

const XML_TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!(?:"[^"]*"|'[^']*'|\[[\s\S]*?\]|[^'">[])*>|<(?:"[^"]*"|'[^']*'|[^'">])*>|[^<]+|</g;

/** Re-indents an XML body: one element per line, short text kept inline (`<a>text</a>`). */
export function formatXml(text: string, indent = 2): string {
  const parts = text.match(XML_TOKEN) ?? [];
  const lines: string[] = [];
  let depth = 0;
  const line = (s: string) => lines.push(" ".repeat(indent * Math.max(depth, 0)) + s);
  for (let k = 0; k < parts.length; k++) {
    const p = parts[k];
    if (!p.startsWith("<") || p === "<") {
      const t = p.trim();
      if (t) line(t);
    } else if (p.startsWith("</")) {
      depth--;
      line(p);
    } else if (p.startsWith("<!") || p.startsWith("<?") || p.endsWith("/>")) {
      line(p);
    } else {
      // <a>text</a> stays on one line
      const inner = parts[k + 1];
      const close = parts[k + 2];
      if (inner && !inner.startsWith("<") && close?.startsWith("</")) {
        line(p + inner.trim() + close);
        k += 2;
      } else if (inner?.startsWith("</")) {
        line(p + inner);
        k++;
      } else {
        line(p);
        depth++;
      }
    }
  }
  return lines.join("\n");
}

/** WebKit/Blink/Gecko parser messages mention "line N … column M". */
export function locateXmlError(text: string, message: string): BodyIssue {
  const m = /line\s+(\d+)\D+?(\d+)/i.exec(message);
  const detail = /column\s*\d+\s*:\s*([^\n]+)/i.exec(message)?.[1] ?? message.replace(/^[\s\S]*?errors?:\s*/i, "");
  const clean = detail.split("\n")[0].replace(/Below is a rendering.*$/, "").trim() || "Invalid XML";
  if (!m) return { message: clean, from: 0, to: 0 };
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") lineStarts.push(i + 1);
  const lineNo = Math.min(Number(m[1]), lineStarts.length) - 1;
  const lineEnd = lineStarts[lineNo + 1] !== undefined ? lineStarts[lineNo + 1] - 1 : text.length;
  const from = Math.min(lineStarts[lineNo] + Math.max(Number(m[2]) - 1, 0), lineEnd);
  return { message: clean, from: Math.max(from - 1, lineStarts[lineNo]), to: from };
}

// ───────────── Bulk edit (key: value lines) ─────────────

export interface BulkRow extends KeyValue {
  isFile?: boolean;
}

/** `key: value` per line, `// ` for disabled rows, `@path` for files (like curl -F). */
export function toBulk(rows: BulkRow[], files = false): string {
  return rows
    .filter((r) => r.key || r.value)
    .map((r) => `${r.enabled ? "" : "// "}${r.key}: ${files && r.isFile ? "@" : ""}${r.value}`)
    .join("\n");
}

export function fromBulk(text: string, files = false): BulkRow[] {
  const rows: BulkRow[] = [];
  for (const raw of text.split("\n")) {
    let lineText = raw.trim();
    if (!lineText) continue;
    const disabled = lineText.startsWith("//");
    if (disabled) lineText = lineText.slice(2).trim();
    const colon = lineText.indexOf(":");
    const key = (colon === -1 ? lineText : lineText.slice(0, colon)).trim();
    let value = colon === -1 ? "" : lineText.slice(colon + 1).trim();
    const isFile = files && value.startsWith("@");
    if (isFile) value = value.slice(1);
    rows.push({ key, value, enabled: !disabled, ...(files ? { isFile } : {}) });
  }
  return rows;
}
