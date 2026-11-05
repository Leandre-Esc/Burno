import type { KeyValue, MultipartField } from "../types";
import { buildRequest, rawBody, type ImportBundle } from "./common";

/** Splits a command line like a shell would. */
export function tokenize(command: string): string[] {
  // Line continuations; a single-line field turns "\<newline>" into "\ "
  const text = command.replace(/[\\^]\r?\n/g, " ");
  const tokens: string[] = [];
  let current = "";
  let started = false;
  let i = 0;
  const push = () => {
    if (started) tokens.push(current);
    current = "";
    started = false;
  };
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) {
      push();
      i++;
    } else if (c === "'" || (c === "$" && text[i + 1] === "'")) {
      const ansi = c === "$";
      i += ansi ? 2 : 1;
      started = true;
      while (i < text.length && text[i] !== "'") {
        if (ansi && text[i] === "\\" && i + 1 < text.length) {
          const next = text[i + 1];
          current += next === "n" ? "\n" : next === "t" ? "\t" : next === "r" ? "\r" : next;
          i += 2;
        } else {
          current += text[i++];
        }
      }
      i++;
    } else if (c === '"') {
      i++;
      started = true;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === "\\" && '"\\$`'.includes(text[i + 1] ?? "")) i++;
        current += text[i++];
      }
      i++;
    } else if (c === "\\") {
      // Before a space it's a line continuation flattened by a single-line field: the space separates
      if (i + 1 < text.length && !/\s/.test(text[i + 1])) {
        current += text[i + 1];
        started = true;
        i++;
      }
      i++;
    } else {
      current += c;
      started = true;
      i++;
    }
  }
  push();
  return tokens;
}

const DATA_FLAGS = new Set(["-d", "--data", "--data-raw", "--data-binary", "--data-ascii", "--json"]);
const SHORT_VALUE_FLAGS = new Set(["-X", "-H", "-d", "-F", "-u", "-A", "-b", "-e", "-m", "-o", "-x", "-w", "-T", "-c", "-E", "-K", "-r", "-t", "-y", "-Y", "-z", "-C", "-D", "-U", "-P", "-Q"]);
const LONG_VALUE_FLAGS = new Set([
  "--request", "--header", "--data", "--data-raw", "--data-binary", "--data-ascii", "--data-urlencode", "--json",
  "--form", "--form-string", "--user", "--user-agent", "--cookie", "--referer", "--url", "--max-time", "--output",
  "--connect-timeout", "--proxy", "--cacert", "--cert", "--key", "--write-out", "--retry", "--retry-delay",
  "--upload-file", "--cookie-jar", "--resolve", "--interface", "--limit-rate", "--dump-header", "--oauth2-bearer",
]);
const QUIET_FLAGS = new Set(["--compressed", "--location", "--silent", "--show-error", "--verbose", "--include", "--fail", "--location-trusted", "--http1.1", "--http2", "--no-buffer", "--globoff", "-s", "-S", "-L", "-v", "-i", "-f", "-g", "-N", "-#"]);

const decode = (text: string) => {
  try {
    return decodeURIComponent(text.replace(/\+/g, " "));
  } catch {
    return text;
  }
};

const splitPair = (text: string): [string, string] => {
  const i = text.indexOf("=");
  return i === -1 ? [text, ""] : [text.slice(0, i), text.slice(i + 1)];
};

/** Reads flags as [name, value]: `-XPOST`, `-sSL`, `--header=x` and `-H x` all come out the same. */
function readFlags(tokens: string[]): { flags: [string, string][]; positional: string[] } {
  const flags: [string, string][] = [];
  const positional: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      const name = eq === -1 ? token : token.slice(0, eq);
      if (eq !== -1) flags.push([name, token.slice(eq + 1)]);
      else if (LONG_VALUE_FLAGS.has(name)) flags.push([name, tokens[++i] ?? ""]);
      else flags.push([name, ""]);
    } else if (token.startsWith("-") && token.length > 1) {
      for (let j = 1; j < token.length; j++) {
        const name = `-${token[j]}`;
        if (SHORT_VALUE_FLAGS.has(name)) {
          flags.push([name, token.slice(j + 1) || (tokens[++i] ?? "")]);
          break;
        }
        flags.push([name, ""]);
      }
    } else {
      positional.push(token);
    }
  }
  return { flags, positional };
}

export const looksLikeCurl = (text: string) => /^\s*(\$\s*)?curl(\.exe)?\s/.test(text);

/** Parses a `curl` command, or returns null if it holds no URL. */
export function parseCurl(command: string): ImportBundle | null {
  const tokens = tokenize(command.trim().replace(/^\$\s*/, "")).slice(1);
  const { flags, positional } = readFlags(tokens);
  const warnings: string[] = [];
  const headers: KeyValue[] = [];
  const data: string[] = [];
  const form: KeyValue[] = [];
  const multipart: MultipartField[] = [];
  let url = positional[0] ?? "";
  let method = "";
  let toQuery = false;
  let basic: { username: string; password: string } | null = null;
  let bearer = "";
  let timeoutMs: number | undefined;
  let verifySsl: boolean | undefined;

  const addHeader = (name: string, value: string) => headers.push({ key: name, value, enabled: true });
  for (const [name, value] of flags) {
    if (name === "-X" || name === "--request") method = value;
    else if (name === "-H" || name === "--header") {
      const i = value.indexOf(":");
      if (i > 0) addHeader(value.slice(0, i).trim(), value.slice(i + 1).trim());
    } else if (DATA_FLAGS.has(name)) {
      if (name !== "--data-raw" && value.startsWith("@")) warnings.push(`The body read from the file ${value.slice(1)} was not imported.`);
      else data.push(value);
      if (name === "--json") {
        if (!headers.some((h) => /^content-type$/i.test(h.key))) addHeader("Content-Type", "application/json");
      }
    } else if (name === "--data-urlencode") {
      const [k, v] = value.includes("=") ? splitPair(value) : ["", value];
      form.push({ key: k, value: v, enabled: true });
    } else if (name === "-F" || name === "--form" || name === "--form-string") {
      const [k, v] = splitPair(value);
      const isFile = name !== "--form-string" && v.startsWith("@");
      multipart.push({ key: k, value: isFile ? v.slice(1).split(";")[0] : v, enabled: true, isFile });
    } else if (name === "-u" || name === "--user") {
      const i = value.indexOf(":");
      basic = i === -1 ? { username: value, password: "" } : { username: value.slice(0, i), password: value.slice(i + 1) };
    } else if (name === "--oauth2-bearer") bearer = value;
    else if (name === "-A" || name === "--user-agent") addHeader("User-Agent", value);
    else if (name === "-b" || name === "--cookie") addHeader("Cookie", value);
    else if (name === "-e" || name === "--referer") addHeader("Referer", value);
    else if (name === "--url") url = value;
    else if (name === "-I" || name === "--head") method = method || "HEAD";
    else if (name === "-G" || name === "--get") toQuery = true;
    else if (name === "-k" || name === "--insecure") verifySsl = false;
    else if (name === "-m" || name === "--max-time") timeoutMs = Math.round(Number(value) * 1000) || undefined;
    else if (name === "-T" || name === "--upload-file") warnings.push(`The upload of ${value} was not imported.`);
    else if (!QUIET_FLAGS.has(name) && !SHORT_VALUE_FLAGS.has(name) && !LONG_VALUE_FLAGS.has(name)) {
      warnings.push(`The option ${name} was ignored.`);
    }
  }
  if (!url) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !url.startsWith("{{")) url = `http://${url}`;

  const contentType = headers.find((h) => /^content-type$/i.test(h.key))?.value ?? "";
  const joined = data.join("&");
  const pairs = !contentType || /urlencoded/i.test(contentType);
  const isForm = joined !== "" && pairs && /^[^\s{[<"=&]+=[^\n]*$/.test(joined);
  const formRows = [...(isForm ? joined.split("&").map((p) => splitPair(p)).map(([key, v]) => ({ key, value: decode(v), enabled: true })) : []), ...form];

  if (toQuery) {
    const query = data.length ? joined : formRows.map((r) => `${r.key}=${encodeURIComponent(r.value)}`).join("&");
    if (query) url += (url.includes("?") ? "&" : "?") + query;
  }
  let body = {};
  if (!toQuery) {
    if (multipart.length) body = { mode: "multipart", multipart: [...multipart, { key: "", value: "", enabled: true, isFile: false }] };
    else if (formRows.length) body = { mode: "form", form: [...formRows, { key: "", value: "", enabled: true }] };
    else if (joined) body = rawBody(joined, contentType);
  }
  const hasBody = !toQuery && (multipart.length > 0 || formRows.length > 0 || joined !== "");

  const path = url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "").split("?")[0] || "/";
  const finalMethod = (method || (hasBody ? "POST" : "GET")).toUpperCase();
  const request = buildRequest(
    {
      name: `${finalMethod} ${path}`,
      method: finalMethod,
      url,
      headers,
      body,
      auth: basic ? { type: "basic", basic } : bearer ? { type: "bearer", bearer: { token: bearer } } : undefined,
      settings: { ...(timeoutMs ? { timeoutMs } : {}), ...(verifySsl === false ? { verifySsl } : {}) },
    },
    warnings,
  );
  return { format: "cURL", name: request.name, requests: [{ folder: [], request }], variables: [], environments: [], warnings };
}
