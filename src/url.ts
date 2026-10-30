import { emptyRow, type KeyValue } from "./types";

function splitUrl(url: string): [string, string] {
  const i = url.indexOf("?");
  return i === -1 ? [url, ""] : [url.slice(0, i), url.slice(i + 1)];
}

function parseQuery(query: string): KeyValue[] {
  return query
    .split("&")
    .filter(Boolean)
    .map((part) => {
      const i = part.indexOf("=");
      return i === -1
        ? { key: part, value: "", enabled: true }
        : { key: part.slice(0, i), value: part.slice(i + 1), enabled: true };
    });
}

/** URL was edited: rebuild the params table, keeping the disabled params. */
export function paramsFromUrl(url: string, current: KeyValue[]): KeyValue[] {
  const disabled = current.filter((p) => !p.enabled && (p.key || p.value));
  return [...parseQuery(splitUrl(url)[1]), ...disabled, emptyRow()];
}

/** Params table was edited: rebuild the URL query string. */
export function urlFromParams(url: string, params: KeyValue[]): string {
  const base = splitUrl(url)[0];
  const query = params
    .filter((p) => p.enabled && (p.key || p.value))
    .map((p) => (p.value ? `${p.key}=${p.value}` : p.key))
    .join("&");
  return query ? `${base}?${query}` : base;
}

export function appendQuery(url: string, key: string, value: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}
