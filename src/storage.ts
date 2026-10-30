import { newRequest, withEmptyRow, type BodyMode, type Environment, type OAuth2Token, type RequestItem, type Variable } from "./types";
import { paramsFromUrl } from "./url";

const KEYS = {
  /** Requests saved by Burno before collections existed */
  legacyRequests: "burno.requests",
  environments: "burno.environments",
  activeEnvironment: "burno.activeEnvironment",
  collections: "burno.collections",
  expanded: "burno.expanded",
  activeRequest: "burno.activeRequest",
  tokens: "burno.tokens",
  activeCollectionEnvs: "burno.activeCollectionEnvs",
  secrets: "burno.secrets",
};

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage errors
  }
}

/** Fills in fields missing from requests saved by older versions of Burno. */
export function normalizeRequest(raw: any): RequestItem {
  const base = newRequest();
  const body =
    typeof raw.body === "string"
      ? { ...base.body, mode: (raw.body ? "json" : "none") as BodyMode, json: raw.body }
      : { ...base.body, ...raw.body };
  return {
    ...base,
    ...raw,
    params: raw.params ?? paramsFromUrl(raw.url ?? "", []),
    body,
    auth: { ...base.auth, ...raw.auth, oauth2: { ...base.auth.oauth2, ...raw.auth?.oauth2 } },
    settings: { ...base.settings, ...raw.settings },
    vars: withEmptyRow(raw.vars),
  };
}

export const loadLegacyRequests = () => load<unknown[]>(KEYS.legacyRequests, []).map(normalizeRequest);
export const clearLegacyRequests = () => {
  try {
    localStorage.removeItem(KEYS.legacyRequests);
  } catch {
    // ignore storage errors
  }
};

export const loadEnvironments = () => load<Environment[]>(KEYS.environments, []);
export const saveEnvironments = (envs: Environment[]) => save(KEYS.environments, envs);

export const loadActiveEnvironment = () => load<string | null>(KEYS.activeEnvironment, null);
export const saveActiveEnvironment = (id: string | null) => save(KEYS.activeEnvironment, id);

/** Active environment file of each collection, by collection root */
export const loadActiveCollectionEnvs = () => load<Record<string, string>>(KEYS.activeCollectionEnvs, {});
export const saveActiveCollectionEnvs = (map: Record<string, string>) => save(KEYS.activeCollectionEnvs, map);

// Secret values of collection variables stay on this machine, keyed by "<root>::<file>"
type Secrets = Record<string, Record<string, string>>;
const loadSecrets = () => load<Secrets>(KEYS.secrets, {});

/** Puts the locally stored secret values back into variables read from disk. */
export function withSecrets(owner: string, vars: Variable[]): Variable[] {
  const values = loadSecrets()[owner] ?? {};
  return vars.map((v) => (v.secret ? { ...v, value: values[v.key] ?? "" } : v));
}

export function saveSecrets(owner: string, vars: Variable[]) {
  const secrets = loadSecrets();
  const values = Object.fromEntries(vars.filter((v) => v.secret && v.key).map((v) => [v.key, v.value]));
  if (Object.keys(values).length) secrets[owner] = values;
  else delete secrets[owner];
  save(KEYS.secrets, secrets);
}

export function moveSecrets(from: string, to: string) {
  const secrets = loadSecrets();
  if (!secrets[from]) return;
  secrets[to] = secrets[from];
  delete secrets[from];
  save(KEYS.secrets, secrets);
}

/** What goes in a file: secret values blanked out. */
export const stripSecrets = (vars: Variable[]) => vars.map((v) => (v.secret ? { ...v, value: "" } : v));

export const loadCollectionRoots = () => load<string[]>(KEYS.collections, []);
export const saveCollectionRoots = (roots: string[]) => save(KEYS.collections, roots);

export const loadExpanded = () => load<string[]>(KEYS.expanded, []);
export const saveExpanded = (keys: string[]) => save(KEYS.expanded, keys);

export const loadActiveRequest = () => load<string | null>(KEYS.activeRequest, null);
export const saveActiveRequest = (id: string | null) => save(KEYS.activeRequest, id);

// OAuth tokens stay on this machine instead of in collection files (which may be committed)
export const loadTokens = () => load<Record<string, OAuth2Token>>(KEYS.tokens, {});

export function saveToken(id: string, token: OAuth2Token | null) {
  const tokens = loadTokens();
  if (token) tokens[id] = token;
  else delete tokens[id];
  save(KEYS.tokens, tokens);
}

export function moveTokens(rename: (id: string) => string) {
  const tokens = loadTokens();
  save(KEYS.tokens, Object.fromEntries(Object.entries(tokens).map(([id, t]) => [rename(id), t])));
}

export type Theme = "dark" | "light";

export const loadTheme = (): Theme =>
  load<Theme | null>("burno.theme", null) ??
  (window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark");
export const saveTheme = (theme: Theme) => save("burno.theme", theme);

/** Sound played on send */
export const loadSounds = () => load<boolean>("burno.sounds", true);
export const saveSounds = (on: boolean) => save("burno.sounds", on);

/** Share of the width given to the request pane */
export const loadSplit = () => load<number>("burno.split", 0.5);
export const saveSplit = (ratio: number) => save("burno.split", ratio);
