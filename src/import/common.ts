import { isOnlyVariables } from "../storage";
import {
  defaultAuth,
  METHODS,
  newRequest,
  withEmptyRow,
  type Auth,
  type KeyValue,
  type Method,
  type RequestBody,
  type RequestItem,
  type RequestSettings,
  type Variable,
} from "../types";
import { paramsFromUrl } from "../url";

export interface ImportedRequest {
  /** Folder names leading to the request */
  folder: string[];
  request: RequestItem;
}

export interface ImportedEnvironment {
  name: string;
  variables: Variable[];
}

/** What a file or a pasted text brings into a collection */
export interface ImportBundle {
  format: string;
  name: string;
  requests: ImportedRequest[];
  /** Collection variables */
  variables: Variable[];
  environments: ImportedEnvironment[];
  /** What could not be brought over, or deserves a look */
  warnings: string[];
}

export interface RequestDraft {
  name: string;
  method?: string;
  url: string;
  /** Params not sent, which the URL can't hold */
  disabledParams?: KeyValue[];
  headers?: KeyValue[];
  body?: Partial<RequestBody>;
  auth?: Partial<Auth>;
  vars?: Variable[];
  settings?: Partial<RequestSettings>;
}

const SECRET_NAME = /passw|pwd|secret|token|api[-_]?key|private[-_]?key|credential|bearer|cookie|session/i;
const SECRET_HEADER = /^(authorization|proxy-authorization|cookie)$/i;
const API_KEY_HEADER = /^(x-api-key|api-key|apikey|x-auth-token|x-access-token)$/i;

/** A value that would be readable by everyone once in a shared file */
const isLiteral = (value: string) => value !== "" && !isOnlyVariables(value);

/** Variables that look like credentials are imported as secrets: their value stays on this machine. */
export function toVariable(key: string, value: unknown, options: { enabled?: boolean; secret?: boolean } = {}): Variable {
  const text = value == null ? "" : typeof value === "string" ? value : JSON.stringify(value);
  const secret = !!options.secret || (SECRET_NAME.test(key) && !isOnlyVariables(text));
  return { key, value: text, enabled: options.enabled ?? true, ...(secret ? { secret } : {}) };
}

/** Moves credentials found in headers to the Auth tab, which keeps them out of files. */
function liftAuthHeaders(headers: KeyValue[], auth: Auth): { headers: KeyValue[]; auth: Auth } {
  if (auth.type !== "none") return { headers, auth };
  const kept: KeyValue[] = [];
  let lifted = auth;
  for (const header of headers) {
    const name = header.key.trim();
    const bearer = /^bearer\s+(.+)$/i.exec(header.value);
    const basic = /^basic\s+(\S+)$/i.exec(header.value);
    const free = header.enabled && lifted.type === "none";
    if (free && /^authorization$/i.test(name) && bearer) {
      lifted = { ...lifted, type: "bearer", bearer: { token: bearer[1].trim() } };
    } else if (free && /^authorization$/i.test(name) && basic && decodeBasic(basic[1])) {
      lifted = { ...lifted, type: "basic", basic: decodeBasic(basic[1])! };
    } else if (free && API_KEY_HEADER.test(name)) {
      lifted = { ...lifted, type: "apikey", apikey: { key: name, value: header.value, placement: "header" } };
    } else {
      kept.push(header);
    }
  }
  return { headers: kept, auth: lifted };
}

function decodeBasic(encoded: string): { username: string; password: string } | null {
  try {
    const text = new TextDecoder().decode(Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)));
    const i = text.indexOf(":");
    return i === -1 ? null : { username: text.slice(0, i), password: text.slice(i + 1) };
  } catch {
    return null;
  }
}

function warnAboutLiterals(req: RequestItem, warnings: string[]) {
  for (const h of req.headers) {
    if ((SECRET_HEADER.test(h.key) || API_KEY_HEADER.test(h.key) || SECRET_NAME.test(h.key)) && isLiteral(h.value)) {
      warnings.push(`"${req.name}": the ${h.key} header holds a value that will be saved in the file. Use a {{variable}}.`);
    }
  }
  for (const p of req.params) {
    if (SECRET_NAME.test(p.key) && isLiteral(p.value)) {
      warnings.push(`"${req.name}": the ${p.key} query param holds a value that will be saved in the file. Use a {{variable}}.`);
    }
  }
}

export function buildRequest(draft: RequestDraft, warnings: string[]): RequestItem {
  const base = newRequest();
  const method = (draft.method ?? "GET").toUpperCase();
  if (!METHODS.includes(method as Method)) warnings.push(`"${draft.name}": method ${method} is not supported, GET was used.`);
  const startAuth: Auth = { ...defaultAuth(), ...draft.auth };
  const { headers, auth } = liftAuthHeaders(draft.headers ?? [], startAuth);
  const req: RequestItem = {
    ...base,
    name: draft.name,
    method: METHODS.includes(method as Method) ? (method as Method) : "GET",
    url: draft.url,
    params: paramsFromUrl(draft.url, draft.disabledParams ?? []),
    headers: withEmptyRow(headers),
    body: { ...base.body, ...draft.body },
    auth,
    settings: { ...base.settings, ...draft.settings },
    vars: withEmptyRow(draft.vars ?? []),
  };
  warnAboutLiterals(req, warnings);
  return req;
}

/** Chooses the body editor that fits a raw text. */
export function rawBody(text: string, contentType = ""): Partial<RequestBody> {
  const type = contentType.toLowerCase();
  const trimmed = text.trim();
  if (type.includes("json") || (!type && isJson(trimmed))) return { mode: "json", json: text };
  if (type.includes("xml") || (!type && trimmed.startsWith("<"))) return { mode: "xml", xml: text };
  return { mode: "text", text };
}

function isJson(text: string) {
  if (!/^[[{]/.test(text)) return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    // A JSON body with {{variables}} in it does not parse, but still is one
    return /^[[{]\s*["{[\]}]/.test(text);
  }
}

/** Name usable for a file or a folder, whatever the imported document holds. */
export function safeName(name: string): string {
  const clean = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/^[.\s]+/, "")
    .slice(0, 80)
    .replace(/[.\s]+$/, "");
  return clean || "Untitled";
}

export interface FilePlan {
  /** Folders to create, parents first */
  folders: string[];
  files: { path: string; request: RequestItem }[];
}

/** Names the collection reader would skip or mistake for something else */
const RESERVED_FOLDERS = new Set(["environments", "node_modules", "target"]);
const ROOT_META = "burno.json";

/** Decides where each imported request goes. `existing` lists the names already taken in `baseDir`. */
export function planFiles(requests: ImportedRequest[], baseDir: string, existing: string[]): FilePlan {
  const taken = new Map<string, Set<string>>([[baseDir, new Set(existing.map((n) => n.toLowerCase()))]]);
  const takenIn = (dir: string) => {
    if (!taken.has(dir)) taken.set(dir, new Set());
    return taken.get(dir)!;
  };
  const claim = (dir: string, base: string, ext: string) => {
    const names = takenIn(dir);
    for (let i = 1; ; i++) {
      const name = `${i === 1 ? base : `${base} ${i}`}${ext}`;
      const lower = name.toLowerCase();
      const reserved = ext ? dir === "" && lower === ROOT_META : RESERVED_FOLDERS.has(lower);
      if (!names.has(lower) && !reserved) {
        names.add(lower);
        return dir ? `${dir}/${name}` : name;
      }
    }
  };

  const folders: string[] = [];
  const resolved = new Map<string, string>();
  const plan: FilePlan = { folders, files: [] };
  for (const { folder, request } of requests) {
    let dir = baseDir;
    for (const part of folder) {
      const key = `${dir}\n${part}`;
      if (!resolved.has(key)) {
        const path = claim(dir, safeName(part), "");
        resolved.set(key, path);
        folders.push(path);
      }
      dir = resolved.get(key)!;
    }
    plan.files.push({ path: claim(dir, safeName(request.name), ".json"), request });
  }
  return plan;
}
