import { newRequest, withEmptyRow, type Auth, type BodyMode, type Environment, type OAuth2Token, type RequestItem, type Variable } from "./types";
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
  authSecrets: "burno.authSecrets",
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

// Credentials typed in a request's Auth tab stay on this machine, keyed by request uid
type AuthValues = Record<string, string>;

const AUTH_SLOTS: { key: string; get: (a: Auth) => string | undefined; set: (a: Auth, v: string) => Auth }[] = [
  { key: "basicPassword", get: (a) => a.basic?.password, set: (a, v) => ({ ...a, basic: { ...a.basic, password: v } }) },
  { key: "bearerToken", get: (a) => a.bearer?.token, set: (a, v) => ({ ...a, bearer: { ...a.bearer, token: v } }) },
  { key: "apikeyValue", get: (a) => a.apikey?.value, set: (a, v) => ({ ...a, apikey: { ...a.apikey, value: v } }) },
  {
    key: "oauthClientSecret",
    get: (a) => a.oauth2?.clientSecret,
    set: (a, v) => ({ ...a, oauth2: { ...a.oauth2, clientSecret: v } }),
  },
  {
    key: "oauthPassword",
    get: (a) => a.oauth2?.password,
    set: (a, v) => ({ ...a, oauth2: { ...a.oauth2, password: v } }),
  },
];

/** `{{token}}` holds no secret and is worth sharing; anything else typed in these fields is a credential. */
const isOnlyVariables = (value: string) => /^(\s*\{\{[^{}]+\}\}\s*)+$/.test(value);

const loadAllAuthValues = () => load<Record<string, AuthValues>>(KEYS.authSecrets, {});

/** The credentials of an Auth that must not reach a file. */
export function authSecretsOf(auth: Auth): AuthValues {
  const values: AuthValues = {};
  for (const slot of AUTH_SLOTS) {
    const value = slot.get(auth);
    if (value && !isOnlyVariables(value)) values[slot.key] = value;
  }
  return values;
}

/** What goes in a file: credentials blanked out, variable references kept. */
export function stripAuthSecrets(auth: Auth): Auth {
  const secrets = authSecretsOf(auth);
  return AUTH_SLOTS.reduce((a, slot) => (secrets[slot.key] ? slot.set(a, "") : a), auth);
}

/** Fills the fields left empty in a file with the values of this machine. A value in the file wins. */
export function withAuthSecrets(auth: Auth, uid: string): Auth {
  const values = loadAllAuthValues()[uid] ?? {};
  return AUTH_SLOTS.reduce((a, slot) => (!slot.get(a) && values[slot.key] ? slot.set(a, values[slot.key]) : a), auth);
}

/** Returns false if the values could not be stored, so callers never blank a file's only copy. */
export function saveAuthSecrets(uid: string, auth: Auth): boolean {
  const all = loadAllAuthValues();
  const values = authSecretsOf(auth);
  if (Object.keys(values).length) all[uid] = values;
  else delete all[uid];
  save(KEYS.authSecrets, all);
  return JSON.stringify(loadAllAuthValues()[uid] ?? {}) === JSON.stringify(values);
}

/** Forgets the credentials and token of a request deleted from the app. */
export function forgetRequestSecrets(uid: string) {
  const all = loadAllAuthValues();
  delete all[uid];
  save(KEYS.authSecrets, all);
  saveToken(uid, null);
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
