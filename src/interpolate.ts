import type { Variable } from "./types";

/** Final name → value map used to resolve `{{name}}` */
export type Vars = Record<string, string>;

export type VarSource = "global" | "collection" | "environment" | "request" | "dotenv";

export const SOURCE_LABELS: Record<VarSource, string> = {
  global: "Global environment",
  collection: "Collection variable",
  environment: "Collection environment",
  request: "Request variable",
  dotenv: ".env file",
};

export interface ResolvedVar {
  name: string;
  /** Value as written, may reference other variables */
  raw: string;
  /** Value with nested `{{…}}` references resolved */
  value: string;
  source: VarSource;
  secret: boolean;
  /** Lower-precedence definitions hidden by this one */
  overrides: VarSource[];
}

export type Scope = Record<string, ResolvedVar>;

export interface Layer {
  source: VarSource;
  variables: Variable[];
}

const VAR_RE = /\{\{\s*([\w.$-]+)\s*\}\}/g;
const MAX_DEPTH = 10;

const pick = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)];
const FIRST_NAMES = ["Alex", "Sam", "Charlie", "Robin", "Camille", "Jordan", "Lou", "Noa"];
const LAST_NAMES = ["Martin", "Bernard", "Dubois", "Smith", "Garcia", "Lee", "Moreau"];

/** Built-in `{{$name}}` variables, generated fresh on every use */
export const DYNAMIC: Record<string, { description: string; generate: () => string }> = {
  $guid: { description: "Random UUID v4", generate: () => crypto.randomUUID() },
  $randomUUID: { description: "Random UUID v4", generate: () => crypto.randomUUID() },
  $timestamp: { description: "Unix time in seconds", generate: () => String(Math.floor(Date.now() / 1000)) },
  $timestampMs: { description: "Unix time in milliseconds", generate: () => String(Date.now()) },
  $isoTimestamp: { description: "ISO 8601 date", generate: () => new Date().toISOString() },
  $randomInt: { description: "Integer from 0 to 1000", generate: () => String(Math.floor(Math.random() * 1001)) },
  $randomBoolean: { description: "true or false", generate: () => String(Math.random() < 0.5) },
  $randomFirstName: { description: "First name", generate: () => pick(FIRST_NAMES) },
  $randomLastName: { description: "Last name", generate: () => pick(LAST_NAMES) },
  $randomEmail: {
    description: "Email address",
    generate: () => `${pick(FIRST_NAMES).toLowerCase()}.${Math.floor(Math.random() * 1e4)}@example.com`,
  },
  $randomHexColor: {
    description: "Color like #a1b2c3",
    generate: () => `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0")}`,
  },
};

/**
 * Merges the layers (later ones win) and resolves references between variables,
 * e.g. `baseUrl = {{host}}/api/{{version}}`. Cycles are left unresolved.
 */
export function buildScope(layers: Layer[], dotenv: Record<string, string> = {}): Scope {
  const defs: Record<string, Omit<ResolvedVar, "value">> = {};
  const define = (name: string, raw: string, source: VarSource, secret: boolean) => {
    const previous = defs[name];
    defs[name] = { name, raw, source, secret, overrides: previous ? [...previous.overrides, previous.source] : [] };
  };
  Object.entries(dotenv).forEach(([key, value]) => define(`process.env.${key}`, value, "dotenv", true));
  for (const layer of layers) {
    for (const v of layer.variables) {
      if (v.enabled && v.key.trim()) define(v.key.trim(), v.value, layer.source, !!v.secret);
    }
  }

  const resolved: Record<string, string> = {};
  const resolve = (name: string, stack: string[]): string | undefined => {
    if (name in resolved) return resolved[name];
    const def = defs[name];
    if (!def || stack.includes(name) || stack.length > MAX_DEPTH) return undefined;
    const value = def.raw.replace(VAR_RE, (match, ref: string) => resolve(ref, [...stack, name]) ?? match);
    resolved[name] = value;
    return value;
  };

  return Object.fromEntries(
    Object.values(defs).map((def) => [def.name, { ...def, value: resolve(def.name, []) ?? def.raw }]),
  );
}

export const scopeVars = (scope: Scope): Vars =>
  Object.fromEntries(Object.values(scope).map((v) => [v.name, v.value]));

export const isKnown = (name: string, vars: Vars) => name in vars || name in DYNAMIC;

/** Replaces `{{name}}` with its value; unknown variables are left as-is. */
export function interpolate(text: string, vars: Vars): string {
  const replace = (s: string, depth: number): string =>
    s.replace(VAR_RE, (match, name: string) => {
      if (name in vars) return depth < 2 ? replace(vars[name], depth + 1) : vars[name];
      if (name in DYNAMIC) return DYNAMIC[name].generate();
      return match;
    });
  return replace(text, 0);
}

/** Splits text into plain parts and `{{variable}}` parts, for highlighting. */
export function tokenize(text: string): { text: string; name?: string }[] {
  const parts: { text: string; name?: string }[] = [];
  let last = 0;
  for (const m of text.matchAll(VAR_RE)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    parts.push({ text: m[0], name: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** Undefined variables referenced in some text */
export const missingVars = (text: string, vars: Vars) =>
  [...text.matchAll(VAR_RE)].map((m) => m[1]).filter((name) => !isKnown(name, vars));
