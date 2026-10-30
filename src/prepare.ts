import type { WireBody, WireRequest } from "./api";
import { interpolate, type Vars } from "./interpolate";
import type { Auth, KeyValue, RequestItem } from "./types";
import { appendQuery } from "./url";

type Headers = [string, string][];

const CONTENT_TYPES = { json: "application/json", xml: "application/xml", text: "text/plain" };

const isActive = (row: KeyValue) => row.enabled && row.key.trim() !== "";

function findHeader(headers: Headers, name: string) {
  return headers.findIndex(([k]) => k.toLowerCase() === name.toLowerCase());
}

function setHeader(headers: Headers, name: string, value: string) {
  const i = findHeader(headers, name);
  if (i === -1) headers.push([name, value]);
  else headers[i] = [name, value];
}

export function basicAuthHeader(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  return `Basic ${btoa(String.fromCharCode(...bytes))}`;
}

/** Adds the auth header (or query param) and returns the possibly updated URL. */
function applyAuth(auth: Auth, url: string, headers: Headers, i: (s: string) => string): string {
  switch (auth.type) {
    case "basic":
      setHeader(headers, "Authorization", basicAuthHeader(i(auth.basic.username), i(auth.basic.password)));
      break;
    case "bearer":
      setHeader(headers, "Authorization", `Bearer ${i(auth.bearer.token)}`);
      break;
    case "apikey": {
      const key = i(auth.apikey.key);
      if (!key) break;
      if (auth.apikey.placement === "query") return appendQuery(url, key, i(auth.apikey.value));
      setHeader(headers, key, i(auth.apikey.value));
      break;
    }
    case "oauth2": {
      const { token, tokenPlacement, tokenHeaderPrefix, tokenQueryKey } = auth.oauth2;
      if (!token) break;
      if (tokenPlacement === "query") return appendQuery(url, tokenQueryKey || "access_token", token.accessToken);
      setHeader(headers, "Authorization", `${tokenHeaderPrefix} ${token.accessToken}`.trim());
      break;
    }
  }
  return url;
}

/** Resolves variables, body and auth into the request actually sent over the wire. */
export function prepareRequest(req: RequestItem, vars: Vars): WireRequest {
  const i = (s: string) => interpolate(s, vars);
  const headers: Headers = req.headers.filter(isActive).map((h) => [i(h.key.trim()), i(h.value)]);
  const setDefaultContentType = (value: string) => {
    if (findHeader(headers, "Content-Type") === -1) headers.push(["Content-Type", value]);
  };

  let body: WireBody = { type: "none" };
  const { mode } = req.body;
  if (mode === "json" || mode === "xml" || mode === "text") {
    body = { type: "raw", content: i(req.body[mode]) };
    setDefaultContentType(CONTENT_TYPES[mode]);
  } else if (mode === "form") {
    const form = new URLSearchParams();
    req.body.form.filter(isActive).forEach((f) => form.append(i(f.key), i(f.value)));
    body = { type: "raw", content: form.toString() };
    setDefaultContentType("application/x-www-form-urlencoded");
  } else if (mode === "multipart") {
    body = {
      type: "multipart",
      fields: req.body.multipart.filter(isActive).map((f) => ({
        key: i(f.key),
        value: f.isFile ? f.value : i(f.value),
        is_file: f.isFile,
      })),
    };
  }

  const url = applyAuth(req.auth, i(req.url.trim()), headers, i);
  return { method: req.method, url, headers, body };
}
