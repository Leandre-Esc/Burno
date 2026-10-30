import type { RequestItem } from "./types";

const KEY = "burno.requests";

export function loadRequests(): RequestItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as RequestItem[]) : [];
  } catch {
    return [];
  }
}

export function saveRequests(requests: RequestItem[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(requests));
  } catch {
    // ignore storage errors
  }
}
