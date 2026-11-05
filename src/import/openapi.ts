/* eslint-disable @typescript-eslint/no-explicit-any */
import { defaultAuth, type Auth, type GrantType, type KeyValue, type MultipartField, type RequestBody, type Variable } from "../types";
import { urlFromParams } from "../url";
import { buildRequest, rawBody, toVariable, type ImportBundle, type ImportedEnvironment, type ImportedRequest } from "./common";

const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch"];
const MAX_DEPTH = 8;
const str = (v: unknown) => (v == null ? "" : String(v));

export const isOpenApi = (doc: any) => (typeof doc?.openapi === "string" || str(doc?.swagger).startsWith("2")) && !!doc?.paths;

/** Follows local `$ref`s; an external or missing one resolves to an empty object. */
function deref(doc: any, node: any, seen: Set<string> = new Set()): any {
  if (!node || typeof node !== "object" || typeof node.$ref !== "string") return node ?? {};
  const ref: string = node.$ref;
  if (!ref.startsWith("#/") || seen.has(ref)) return {};
  seen.add(ref);
  const target = ref
    .slice(2)
    .split("/")
    .reduce((cur, part) => cur?.[part.replace(/~1/g, "/").replace(/~0/g, "~")], doc);
  return deref(doc, target, seen);
}

/** A plausible value for a schema, preferring what the document provides. */
function sample(doc: any, schemaNode: any, stack: string[] = []): unknown {
  const ref = schemaNode?.$ref;
  if (typeof ref === "string" && stack.includes(ref)) return undefined; // recursive schema
  const nextStack = typeof ref === "string" ? [...stack, ref] : stack;
  if (nextStack.length > MAX_DEPTH) return undefined;
  const schema = deref(doc, schemaNode);
  if (schema.example !== undefined) return schema.example;
  if (Array.isArray(schema.examples) && schema.examples.length) return schema.examples[0];
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.allOf)) {
    return schema.allOf.reduce((all: any, part: any) => {
      const value = sample(doc, part, nextStack);
      return value && typeof value === "object" && !Array.isArray(value) ? { ...all, ...value } : all;
    }, {});
  }
  const variant = schema.oneOf?.[0] ?? schema.anyOf?.[0];
  if (variant) return sample(doc, variant, nextStack);
  const type = Array.isArray(schema.type) ? schema.type.find((t: string) => t !== "null") : schema.type;
  if (type === "object" || schema.properties) {
    const entries = Object.entries(schema.properties ?? {}).map(([k, v]) => [k, sample(doc, v, nextStack)]);
    return Object.fromEntries(entries.filter(([, v]) => v !== undefined));
  }
  if (type === "array") {
    const item = sample(doc, schema.items, nextStack);
    return item === undefined ? [] : [item];
  }
  if (type === "integer" || type === "number") return 0;
  if (type === "boolean") return true;
  if (type === "string") return schema.format === "date-time" ? "2026-01-01T00:00:00Z" : schema.format === "date" ? "2026-01-01" : "string";
  return undefined;
}

const scalar = (v: unknown) => (v == null ? "" : typeof v === "string" ? v : JSON.stringify(v));

/** Example given for a parameter, if any: never made up, so nobody sends a fake id by accident. */
function paramExample(doc: any, param: any): string {
  if (param.example !== undefined) return scalar(param.example);
  const first = param.examples && (Object.values(param.examples)[0] as any);
  if (first) return scalar(deref(doc, first).value);
  const schema = deref(doc, param.schema ?? param);
  if (schema.example !== undefined) return scalar(schema.example);
  if (schema.default !== undefined) return scalar(schema.default);
  if (schema.enum?.length) return scalar(schema.enum[0]);
  return "";
}

function formRows(doc: any, schemaNode: any): { name: string; value: string; binary: boolean }[] {
  const schema = deref(doc, schemaNode);
  const merged = Array.isArray(schema.allOf) ? Object.assign({}, ...schema.allOf.map((s: any) => deref(doc, s).properties)) : schema.properties;
  return Object.entries(merged ?? {}).map(([name, prop]) => {
    const p = deref(doc, prop);
    return { name, value: scalar(sample(doc, prop)), binary: p.format === "binary" || p.format === "byte" || p.type === "file" };
  });
}

function bodyFromContent(doc: any, content: any): { body: Partial<RequestBody>; contentType: string } {
  const types = Object.keys(content ?? {});
  const pick = (re: RegExp) => types.find((t) => re.test(t));
  const type = pick(/json/) ?? pick(/x-www-form-urlencoded/) ?? pick(/multipart/) ?? pick(/xml/) ?? pick(/^text\//) ?? types[0];
  if (!type) return { body: {}, contentType: "" };
  const media = deref(doc, content[type]);
  const exampleEntry = media.examples && (Object.values(media.examples)[0] as any);
  const example = media.example ?? (exampleEntry ? deref(doc, exampleEntry).value : undefined);

  if (/x-www-form-urlencoded/.test(type)) {
    const rows = formRows(doc, media.schema).map((r): KeyValue => ({ key: r.name, value: r.value, enabled: true }));
    return { body: { mode: "form", form: [...rows, { key: "", value: "", enabled: true }] }, contentType: type };
  }
  if (/multipart/.test(type)) {
    const rows = formRows(doc, media.schema).map((r): MultipartField => ({ key: r.name, value: r.binary ? "" : r.value, enabled: true, isFile: r.binary }));
    return { body: { mode: "multipart", multipart: [...rows, { key: "", value: "", enabled: true, isFile: false }] }, contentType: type };
  }
  const value = example ?? sample(doc, media.schema);
  if (value === undefined) return { body: {}, contentType: type };
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { body: rawBody(text, /json/.test(type) ? "application/json" : type), contentType: type };
}

function serverUrls(doc: any): { url: string; name: string }[] {
  if (doc.swagger) {
    const scheme = doc.schemes?.includes("https") ? "https" : (doc.schemes?.[0] ?? "https");
    return doc.host ? [{ url: `${scheme}://${doc.host}${doc.basePath ?? ""}`, name: doc.host }] : [{ url: str(doc.basePath), name: "Default" }];
  }
  return (doc.servers ?? []).map((s: any) => {
    const url = str(s.url).replace(/\{([^}]+)\}/g, (match: string, name: string) => str(s.variables?.[name]?.default) || match);
    return { url, name: str(s.description) || url };
  });
}

const FLOWS: [string, GrantType][] = [
  ["authorizationCode", "authorization_code"],
  ["accessCode", "authorization_code"],
  ["clientCredentials", "client_credentials"],
  ["application", "client_credentials"],
  ["password", "password"],
  ["implicit", "implicit"],
];

/** Auth of an operation, always through variables: a spec describes credentials, it doesn't hold them. */
function securityAuth(doc: any, op: any, addVar: (name: string) => void, warnings: string[], name: string): Partial<Auth> {
  const requirements = op.security ?? doc.security ?? [];
  const requirement = requirements.find((r: any) => Object.keys(r).length) ?? null;
  if (!requirement) return { type: "none" };
  const schemeName = Object.keys(requirement)[0];
  const scheme = deref(doc, (doc.components?.securitySchemes ?? doc.securityDefinitions)?.[schemeName]);
  const type = str(scheme.type).toLowerCase();
  if ((type === "http" && str(scheme.scheme).toLowerCase() === "bearer")) {
    addVar("token");
    return { type: "bearer", bearer: { token: "{{token}}" } };
  }
  if (type === "basic" || (type === "http" && str(scheme.scheme).toLowerCase() === "basic")) {
    addVar("username");
    addVar("password");
    return { type: "basic", basic: { username: "{{username}}", password: "{{password}}" } };
  }
  if (type === "apikey" && scheme.in !== "cookie") {
    addVar("apiKey");
    return { type: "apikey", apikey: { key: str(scheme.name), value: "{{apiKey}}", placement: scheme.in === "query" ? "query" : "header" } };
  }
  if (type === "oauth2") {
    const base = defaultAuth().oauth2;
    const flows = scheme.flows ?? (scheme.flow ? { [scheme.flow]: scheme } : {});
    const found = FLOWS.find(([key]) => flows[key]);
    if (found) {
      const flow = flows[found[0]];
      addVar("clientId");
      if (found[1] !== "implicit") addVar("clientSecret");
      return {
        type: "oauth2",
        oauth2: {
          ...base,
          grantType: found[1],
          authorizationUrl: str(flow.authorizationUrl),
          accessTokenUrl: str(flow.tokenUrl),
          clientId: "{{clientId}}",
          clientSecret: found[1] === "implicit" ? "" : "{{clientSecret}}",
          scope: requirement[schemeName]?.join(" ") ?? "",
        },
      };
    }
  }
  warnings.push(`"${name}": the ${schemeName} security scheme is not supported, the request has no auth.`);
  return { type: "none" };
}

export function parseOpenApi(doc: any): ImportBundle {
  const warnings: string[] = [];
  const requests: ImportedRequest[] = [];
  const auto = new Map<string, Variable>();
  const addVar = (name: string) => auto.set(name, toVariable(name, "", { secret: /token|password|apiKey|clientSecret/.test(name) }));

  for (const [path, itemNode] of Object.entries<any>(doc.paths ?? {})) {
    const item = deref(doc, itemNode);
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!op) continue;
      const name = str(op.summary).split("\n")[0].trim() || str(op.operationId) || `${method.toUpperCase()} ${path}`;
      const params = [...(item.parameters ?? []), ...(op.parameters ?? [])].map((p) => deref(doc, p));
      const uniqueParams = [...new Map(params.map((p) => [`${p.in}:${p.name}`, p])).values()];

      const vars: Variable[] = uniqueParams
        .filter((p) => p.in === "path")
        .map((p) => {
          const value = paramExample(doc, p);
          return { key: p.name, value, enabled: value !== "" };
        });
      const query = uniqueParams
        .filter((p) => p.in === "query")
        .map((p): KeyValue => ({ key: p.name, value: paramExample(doc, p), enabled: !!p.required }));
      const headers = uniqueParams
        // A spec describes these through its content and security sections
        .filter((p) => p.in === "header" && !/^(accept|content-type|authorization)$/i.test(p.name))
        .map((p): KeyValue => ({ key: p.name, value: paramExample(doc, p), enabled: !!p.required }));

      const pathWithVars = path.replace(/\{([^}]+)\}/g, "{{$1}}");
      const base = `{{baseUrl}}${pathWithVars}`;

      let body: Partial<RequestBody> = {};
      let contentType = "";
      if (op.requestBody) {
        ({ body, contentType } = bodyFromContent(doc, deref(doc, op.requestBody).content));
      } else {
        // Swagger 2
        const bodyParam = uniqueParams.find((p) => p.in === "body");
        const formParams = uniqueParams.filter((p) => p.in === "formData");
        if (bodyParam) {
          const value = sample(doc, bodyParam.schema);
          if (value !== undefined) body = rawBody(typeof value === "string" ? value : JSON.stringify(value, null, 2), "application/json");
        } else if (formParams.length) {
          const isMultipart = formParams.some((p) => p.type === "file") || (op.consumes ?? doc.consumes ?? []).some((c: string) => /multipart/.test(c));
          if (isMultipart) {
            const rows: MultipartField[] = formParams.map((p) => ({ key: p.name, value: p.type === "file" ? "" : paramExample(doc, p), enabled: true, isFile: p.type === "file" }));
            body = { mode: "multipart", multipart: [...rows, { key: "", value: "", enabled: true, isFile: false }] };
          } else {
            const rows: KeyValue[] = formParams.map((p) => ({ key: p.name, value: paramExample(doc, p), enabled: true }));
            body = { mode: "form", form: [...rows, { key: "", value: "", enabled: true }] };
          }
        }
      }
      // Burno picks a default for JSON, XML, text and form bodies; anything else must be said
      if (contentType && !/json|xml$|x-www-form-urlencoded|multipart|^text\/plain/.test(contentType)) {
        headers.unshift({ key: "Content-Type", value: contentType, enabled: true });
      }

      const tag = op.tags?.[0];
      requests.push({
        folder: tag ? [str(tag)] : [],
        request: buildRequest(
          {
            name,
            method,
            url: query.some((q) => q.enabled) ? urlFromParams(base, query) : base,
            disabledParams: query.filter((q) => !q.enabled),
            headers,
            body,
            auth: securityAuth(doc, op, addVar, warnings, name),
            vars,
          },
          warnings,
        ),
      });
    }
  }

  const servers = serverUrls(doc);
  if (!servers.length) warnings.push("The document names no server: set the baseUrl variable.");
  const variables = [{ key: "baseUrl", value: servers[0]?.url ?? "", enabled: true }, ...auto.values()];
  // One server is the base URL; several are environments to switch between
  const environments: ImportedEnvironment[] =
    servers.length > 1 ? servers.map((s) => ({ name: s.name, variables: [{ key: "baseUrl", value: s.url, enabled: true }] })) : [];
  const version = doc.swagger ? `Swagger ${doc.swagger}` : `OpenAPI ${doc.openapi}`;
  return { format: version, name: str(doc.info?.title) || "API", requests, variables, environments, warnings };
}
