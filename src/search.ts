/** Something the command palette can find. */
export interface SearchItem {
  key: string;
  kind: "request" | "environment" | "action";
  label: string;
  /** Second line: where it is, what it does */
  detail?: string;
  method?: string;
  /** Also searched, not shown */
  keywords?: string;
}

const MAX_RESULTS = 50;

/**
 * Every word of the query must appear somewhere, in any order.
 * Credentials are never part of an item, so they can't be found or shown here.
 */
export function search<T extends SearchItem>(items: T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items.slice(0, MAX_RESULTS);
  const scored: { item: T; score: number; index: number }[] = [];
  items.forEach((item, index) => {
    const label = item.label.toLowerCase();
    const haystack = `${label} ${item.detail ?? ""} ${item.method ?? ""} ${item.keywords ?? ""}`.toLowerCase();
    if (!words.every((w) => haystack.includes(w))) return;
    const whole = words.join(" ");
    const score = label === whole ? 0 : label.startsWith(whole) ? 1 : label.includes(whole) ? 2 : words.every((w) => label.includes(w)) ? 3 : 4;
    scored.push({ item, score, index });
  });
  return scored
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, MAX_RESULTS)
    .map((s) => s.item);
}
