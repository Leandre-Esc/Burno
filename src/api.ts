import { invoke } from "@tauri-apps/api/core";
import type { HttpResponse, RequestItem } from "./types";

export function sendRequest(req: RequestItem): Promise<HttpResponse> {
  const methodHasBody = !["GET", "HEAD"].includes(req.method);
  return invoke<HttpResponse>("send_request", {
    request: {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: methodHasBody ? req.body : null,
    },
  });
}
