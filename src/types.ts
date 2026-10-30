export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
export type Method = (typeof METHODS)[number];

export interface KeyValue {
  key: string;
  value: string;
  enabled: boolean;
}

export interface RequestItem {
  id: string;
  name: string;
  method: Method;
  url: string;
  headers: KeyValue[];
  body: string;
}

export interface HttpResponse {
  status: number;
  status_text: string;
  headers: [string, string][];
  body: string;
  time_ms: number;
  size_bytes: number;
}

export function newRequest(): RequestItem {
  return {
    id: crypto.randomUUID(),
    name: "New Request",
    method: "GET",
    url: "https://jsonplaceholder.typicode.com/todos/1",
    headers: [{ key: "", value: "", enabled: true }],
    body: "",
  };
}
