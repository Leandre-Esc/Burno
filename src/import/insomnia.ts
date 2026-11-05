/* eslint-disable @typescript-eslint/no-explicit-any */
import { defaultAuth, type Auth, type GrantType, type KeyValue, type MultipartField, type RequestBody, type Variable } from "../types";
import { urlFromParams, paramsFromUrl } from "../url";
import { buildRequest, rawBody, toVariable, type ImportBundle, type ImportedEnvironment, type ImportedRequest } from "./common";

interface Node {
  name: string;
  children?: Node[];
  raw?: any;
}

const str = (v: unknown) => (v == null ? "" : String(v));

/** `{{ _.host }}` and `{{ host }}` become `{{host}}`, in the whole document. */
function convertTemplates(value: any, count: { tags: number }): any {
  if (typeof value === "string") {
    if (value.includes("{%")) count.tags++;
    return value.replace(/\{\{\s*(?:_\.)?([\w.$-]+)\s*\}\}/g, "{{$1}}");
  }
  if (Array.isArray(value)) return value.map((v) => convertTemplates(v, count));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, convertTemplates(v, count)]));
  }
  return value;
}

function flatten(data: any, prefix = ""): [string, unknown][] {
  return Object.entries(data ?? {}).flatMap(([key, value]): [string, unknown][] =>
    value && typeof value === "object" && !Array.isArray(value)
      ? flatten(value, `${prefix}${key}.`)
      : [[`${prefix}${key}`, value]],
  );
}

const envVariables = (data: any): Variable[] => flatten(data).map(([k, v]) => toVariable(k, v));

const row = (r: any): KeyValue => ({ key: str(r.name), value: str(r.value), enabled: !r.disabled });

const GRANTS: Record<string, GrantType> = {
  authorization_code: "authorization_code",
  client_credentials: "client_credentials",
  password: "password",
  implicit: "implicit",
};

function toAuth(a: any, requestName: string, warnings: string[]): Partial<Auth> {
  if (!a || !a.type || a.type === "none" || a.disabled) return { type: "none" };
  switch (a.type) {
    case "basic":
      return { type: "basic", basic: { username: str(a.username), password: str(a.password) } };
    case "bearer":
      return { type: "bearer", bearer: { token: str(a.token) } };
    case "apikey":
      return { type: "apikey", apikey: { key: str(a.key), value: str(a.value), placement: a.addTo === "queryParams" ? "query" : "header" } };
    case "oauth2": {
      const base = defaultAuth().oauth2;
      return {
        type: "oauth2",
        oauth2: {
          ...base,
          grantType: GRANTS[a.grantType] ?? base.grantType,
          authorizationUrl: str(a.authorizationUrl),
          accessTokenUrl: str(a.accessTokenUrl),
          callbackUrl: str(a.redirectUrl) || base.callbackUrl,
          clientId: str(a.clientId),
          clientSecret: str(a.clientSecret),
          scope: str(a.scope),
          state: str(a.state),
          usePkce: a.usePkce ?? base.usePkce,
          username: str(a.username),
          password: str(a.password),
        },
      };
    }
    default:
      warnings.push(`"${requestName}": ${a.type} authentication is not supported.`);
      return { type: "none" };
  }
}

function toBody(body: any, requestName: string, warnings: string[]): Partial<RequestBody> {
  const mime = str(body?.mimeType);
  if (/x-www-form-urlencoded/.test(mime)) {
    return { mode: "form", form: [...(body.params ?? []).map(row), { key: "", value: "", enabled: true }] };
  }
  if (/multipart/.test(mime)) {
    const fields: MultipartField[] = (body.params ?? []).map((p: any) => {
      const isFile = p.type === "file";
      return { key: str(p.name), value: isFile ? str(p.fileName) : str(p.value), enabled: !p.disabled, isFile };
    });
    return { mode: "multipart", multipart: [...fields, { key: "", value: "", enabled: true, isFile: false }] };
  }
  if (body?.fileName) warnings.push(`"${requestName}": the file body was not imported.`);
  if (!body?.text) return {};
  return rawBody(body.text, /graphql/.test(mime) ? "application/json" : mime);
}

function toRequests(nodes: Node[], folder: string[], out: ImportedRequest[], warnings: string[]) {
  for (const node of nodes) {
    if (node.children) {
      toRequests(node.children, [...folder, node.name], out, warnings);
      continue;
    }
    const r = node.raw;
    const params: KeyValue[] = (r.parameters ?? []).map(row);
    const url = str(r.url);
    const enabled = [...paramsFromUrl(url, []).filter((p) => p.key), ...params.filter((p) => p.enabled)];
    out.push({
      folder,
      request: buildRequest(
        {
          name: node.name,
          method: r.method,
          url: params.length ? urlFromParams(url, enabled) : url,
          disabledParams: params.filter((p) => !p.enabled),
          headers: (r.headers ?? []).map(row),
          body: toBody(r.body, node.name, warnings),
          auth: toAuth(r.authentication, node.name, warnings),
        },
        warnings,
      ),
    });
  }
}

export const isInsomniaV4 = (doc: any) => doc?._type === "export" && Array.isArray(doc?.resources);
export const isInsomniaV5 = (doc: any) => str(doc?.type).startsWith("collection.insomnia.rest/");

export function parseInsomniaV4(source: any): ImportBundle {
  const count = { tags: 0 };
  const doc = convertTemplates(source, count);
  const warnings: string[] = [];
  const resources: any[] = doc.resources;
  const workspace = resources.find((r) => r._type === "workspace");
  const kids = (parent: string): Node[] =>
    resources
      .filter((r) => r.parentId === parent && (r._type === "request_group" || r._type === "request"))
      .sort((a, b) => (a.metaSortKey ?? 0) - (b.metaSortKey ?? 0))
      .map((r) =>
        r._type === "request"
          ? { name: str(r.name) || "Request", raw: r }
          : { name: str(r.name) || "Folder", children: kids(r._id) },
      );
  const groups = new Set(resources.filter((r) => r._type === "request_group").map((r) => r._id));
  // Without a workspace, requests hang from anything that isn't a folder
  const top: Node[] = workspace
    ? kids(workspace._id)
    : [...new Set(resources.filter((r) => /^(request|request_group)$/.test(r._type) && !groups.has(r.parentId)).map((r) => r.parentId))].flatMap(kids);
  const requests: ImportedRequest[] = [];
  toRequests(top, [], requests, warnings);

  const others = resources.filter((r) => /_request$/.test(r._type)).length;
  if (others) warnings.push(`${others} gRPC or WebSocket request(s) were not imported.`);

  const envs = resources.filter((r) => r._type === "environment");
  const envIds = new Set(envs.map((e) => e._id));
  const base = envs.find((e) => !envIds.has(e.parentId));
  const environments: ImportedEnvironment[] = envs
    .filter((e) => e !== base)
    .map((e) => ({ name: str(e.name) || "Environment", variables: envVariables(e.data) }));
  if (count.tags) warnings.push(`${count.tags} value(s) use Insomnia template tags ({% %}), which Burno can't run: they were kept as text.`);
  return { format: "Insomnia", name: str(workspace?.name) || "Insomnia", requests, variables: envVariables(base?.data), environments, warnings };
}

export function parseInsomniaV5(source: any): ImportBundle {
  const count = { tags: 0 };
  const doc = convertTemplates(source, count);
  const warnings: string[] = [];
  const toNode = (item: any): Node =>
    Array.isArray(item.children)
      ? { name: str(item.name) || "Folder", children: item.children.map(toNode) }
      : { name: str(item.name) || "Request", raw: item };
  const requests: ImportedRequest[] = [];
  toRequests((doc.collection ?? []).map(toNode), [], requests, warnings);
  const environments = (doc.environments?.subEnvironments ?? []).map((e: any) => ({
    name: str(e.name) || "Environment",
    variables: envVariables(e.data),
  }));
  if (count.tags) warnings.push(`${count.tags} value(s) use Insomnia template tags ({% %}), which Burno can't run: they were kept as text.`);
  return { format: "Insomnia", name: str(doc.name) || "Insomnia", requests, variables: envVariables(doc.environments?.data), environments, warnings };
}
