/* eslint-disable @typescript-eslint/no-explicit-any */
import { defaultAuth, type Auth, type GrantType, type KeyValue, type MultipartField, type RequestBody, type Variable } from "../types";
import { buildRequest, rawBody, toVariable, type ImportBundle, type ImportedRequest } from "./common";

const GRANTS: Record<string, GrantType> = {
  authorization_code: "authorization_code",
  authorization_code_with_pkce: "authorization_code",
  client_credentials: "client_credentials",
  password_credentials: "password",
  implicit: "implicit",
};

/** Auth settings are `[{ key, value }]` in v2.1 and a plain object in v2.0. */
function settings(section: any): Record<string, any> {
  if (Array.isArray(section)) return Object.fromEntries(section.map((e) => [e.key, e.value]));
  return section ?? {};
}

const str = (v: unknown) => (v == null ? "" : String(v));

function toAuth(auth: any, requestName: string, warnings: string[]): Partial<Auth> {
  switch (auth?.type) {
    case "basic": {
      const s = settings(auth.basic);
      return { type: "basic", basic: { username: str(s.username), password: str(s.password) } };
    }
    case "bearer":
      return { type: "bearer", bearer: { token: str(settings(auth.bearer).token) } };
    case "apikey": {
      const s = settings(auth.apikey);
      return { type: "apikey", apikey: { key: str(s.key), value: str(s.value), placement: s.in === "query" ? "query" : "header" } };
    }
    case "oauth2": {
      const s = settings(auth.oauth2);
      const base = defaultAuth().oauth2;
      return {
        type: "oauth2",
        oauth2: {
          ...base,
          grantType: GRANTS[s.grant_type] ?? base.grantType,
          authorizationUrl: str(s.authUrl),
          accessTokenUrl: str(s.accessTokenUrl),
          callbackUrl: str(s.redirect_uri) || base.callbackUrl,
          clientId: str(s.clientId),
          clientSecret: str(s.clientSecret),
          scope: str(s.scope),
          state: str(s.state),
          usePkce: s.grant_type === "authorization_code_with_pkce" || base.usePkce,
          username: str(s.username),
          password: str(s.password),
        },
      };
    }
    case undefined:
    case null:
    case "noauth":
      return { type: "none" };
    default:
      warnings.push(`"${requestName}": ${auth.type} authentication is not supported.`);
      return { type: "none" };
  }
}

const row = (r: any): KeyValue => ({ key: str(r.key), value: str(r.value), enabled: !r.disabled });

function toUrl(url: any): { url: string; disabledParams: KeyValue[]; vars: Variable[] } {
  if (url == null || typeof url === "string") return { url: url ?? "", disabledParams: [], vars: [] };
  const built = () => {
    const host = Array.isArray(url.host) ? url.host.join(".") : str(url.host);
    const path = Array.isArray(url.path) ? url.path.map((p: any) => (typeof p === "string" ? p : p.value)).join("/") : str(url.path);
    const port = url.port ? `:${url.port}` : "";
    const scheme = url.protocol ? `${url.protocol}://` : "";
    const query = (url.query ?? []).filter((q: any) => !q.disabled).map((q: any) => `${q.key}=${q.value ?? ""}`).join("&");
    return `${scheme}${host}${port}${path ? `/${path}` : ""}${query ? `?${query}` : ""}`;
  };
  let raw: string = url.raw ?? built();
  const vars: Variable[] = [];
  // Path variables: /users/:id becomes /users/{{id}}, with its value as a request variable
  for (const v of url.variable ?? []) {
    if (!v.key) continue;
    raw = raw.replace(new RegExp(`:${v.key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[/?#]|$)`), `{{${v.key}}}`);
    vars.push({ key: v.key, value: str(v.value), enabled: v.value != null && v.value !== "" });
  }
  const disabledParams = (url.query ?? []).filter((q: any) => q.disabled).map(row);
  return { url: raw, disabledParams, vars };
}

function toBody(body: any, requestName: string, contentType: string, warnings: string[]): Partial<RequestBody> {
  switch (body?.mode) {
    case "raw":
      if (!body.raw) return {};
      return rawBody(body.raw, contentType || languageType(body.options?.raw?.language));
    case "urlencoded":
      return { mode: "form", form: [...(body.urlencoded ?? []).map(row), { key: "", value: "", enabled: true }] };
    case "formdata": {
      const fields: MultipartField[] = (body.formdata ?? []).map((f: any) => {
        const isFile = f.type === "file";
        const src = Array.isArray(f.src) ? f.src[0] : f.src;
        return { key: str(f.key), value: isFile ? str(src) : str(f.value), enabled: !f.disabled, isFile };
      });
      return { mode: "multipart", multipart: [...fields, { key: "", value: "", enabled: true, isFile: false }] };
    }
    case "graphql": {
      const { query, variables } = body.graphql ?? {};
      let parsed: unknown;
      try {
        parsed = typeof variables === "string" && variables.trim() ? JSON.parse(variables) : (variables ?? undefined);
      } catch {
        parsed = undefined;
      }
      return { mode: "json", json: JSON.stringify({ query, ...(parsed ? { variables: parsed } : {}) }, null, 2) };
    }
    case "file":
      warnings.push(`"${requestName}": the file body was not imported.`);
      return {};
    default:
      return {};
  }
}

const languageType = (language?: string) =>
  language === "json" ? "application/json" : language === "xml" || language === "html" ? "application/xml" : language ? "text/plain" : "";

const hasScript = (item: any) => (item.event ?? []).some((e: any) => (Array.isArray(e.script?.exec) ? e.script.exec.join("") : str(e.script?.exec)).trim());

export const isPostmanCollection = (doc: any) =>
  Array.isArray(doc?.item) && (str(doc?.info?.schema).includes("getpostman.com") || !!doc?.info?._postman_id);

export const isPostmanEnvironment = (doc: any) => Array.isArray(doc?.values) && !!doc?._postman_variable_scope;

export function parsePostmanCollection(doc: any): ImportBundle {
  const warnings: string[] = [];
  const requests: ImportedRequest[] = [];
  let scripts = hasScript(doc) ? 1 : 0;

  const walk = (items: any[], folder: string[], inherited: any) => {
    for (const item of items ?? []) {
      if (hasScript(item)) scripts++;
      if (Array.isArray(item.item)) {
        walk(item.item, [...folder, str(item.name) || "Folder"], item.auth ?? inherited);
        continue;
      }
      if (!item.request) continue;
      const name = str(item.name) || "Request";
      const req = typeof item.request === "string" ? { url: item.request, method: "GET" } : item.request;
      const headers: KeyValue[] = (Array.isArray(req.header) ? req.header : []).map(row);
      const contentType = headers.find((h) => /^content-type$/i.test(h.key))?.value ?? "";
      const { url, disabledParams, vars } = toUrl(req.url);
      requests.push({
        folder,
        request: buildRequest(
          {
            name,
            method: req.method,
            url,
            disabledParams,
            vars,
            headers,
            body: toBody(req.body, name, contentType, warnings),
            auth: toAuth(req.auth ?? inherited, name, warnings),
          },
          warnings,
        ),
      });
    }
  };
  walk(doc.item, [], doc.auth);
  if (scripts) warnings.push(`${scripts} pre-request or test script(s) were not imported: Burno does not run scripts yet.`);

  const variables = (doc.variable ?? [])
    .filter((v: any) => v.key)
    .map((v: any) => toVariable(v.key, v.value, { enabled: !v.disabled, secret: v.type === "secret" }));
  return { format: "Postman collection", name: str(doc.info?.name) || "Postman", requests, variables, environments: [], warnings };
}

export function parsePostmanEnvironment(doc: any): ImportBundle {
  const name = str(doc.name) || "Environment";
  const variables = doc.values
    .filter((v: any) => v.key)
    .map((v: any) => toVariable(v.key, v.value, { enabled: v.enabled !== false, secret: v.type === "secret" }));
  return { format: "Postman environment", name, requests: [], variables: [], environments: [{ name, variables }], warnings: [] };
}
