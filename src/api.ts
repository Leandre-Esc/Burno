import { invoke } from "@tauri-apps/api/core";
import type { HttpResponse, RequestSettings } from "./types";

/** Body as understood by the Rust `send_request` command */
export type WireBody =
  | { type: "none" }
  | { type: "raw"; content: string }
  | { type: "multipart"; fields: { key: string; value: string; is_file: boolean }[] };

/** Fully resolved request (variables replaced, auth applied), ready to send */
export interface WireRequest {
  method: string;
  url: string;
  headers: [string, string][];
  body: WireBody;
}

export function sendHttp(req: WireRequest, settings: RequestSettings): Promise<HttpResponse> {
  return invoke<HttpResponse>("send_request", {
    request: {
      method: req.method,
      url: req.url,
      headers: req.headers.map(([key, value]) => ({ key, value })),
      body: req.body,
      settings: {
        timeout_ms: settings.timeoutMs,
        follow_redirects: settings.followRedirects,
        verify_ssl: settings.verifySsl,
      },
    },
  });
}

/** Opens the provider login page and resolves with the callback URL it redirected to. */
export function openAuthWindow(authorizeUrl: string, callbackUrl: string): Promise<string> {
  return invoke<string>("oauth2_authorize", { authorizeUrl, callbackUrl });
}

export type RawNode =
  | { kind: "folder"; name: string; path: string; children: RawNode[] }
  | { kind: "request"; path: string; data: unknown };

export interface RawCollection {
  root: string;
  name: string;
  variables: unknown;
  children: RawNode[];
}

export interface RawEnvironments {
  environments: { file: string; data: unknown }[];
  dotenv: Record<string, string>;
}

/** Collection files on disk; `path` is always relative to the collection `root`. */
export const collectionApi = {
  load: (root: string) => invoke<RawCollection>("collection_load", { root }),
  create: (parent: string, name: string) => invoke<string>("collection_create", { parent, name }),
  rename: (root: string, name: string) => invoke<void>("collection_rename", { root, name }),
  defaultRoot: () => invoke<string>("collection_default"),
  createRequest: (root: string, path: string, data: unknown) => invoke<void>("request_create", { root, path, data }),
  writeRequest: (root: string, path: string, data: unknown) => invoke<void>("request_write", { root, path, data }),
  createFolder: (root: string, path: string) => invoke<void>("folder_create", { root, path }),
  renameEntry: (root: string, from: string, to: string) => invoke<void>("entry_rename", { root, from, to }),
  deleteEntry: (root: string, path: string) => invoke<void>("entry_delete", { root, path }),
};

/** Collection environments (`environments/<file>`), `.env` and collection variables. */
export const envApi = {
  list: (root: string) => invoke<RawEnvironments>("env_list", { root }),
  write: (root: string, file: string, data: unknown, create = false) =>
    invoke<void>("env_write", { root, file, data, create }),
  rename: (root: string, from: string, to: string) => invoke<void>("env_rename", { root, from, to }),
  remove: (root: string, file: string) => invoke<void>("env_delete", { root, file }),
  setCollectionVariables: (root: string, variables: unknown) =>
    invoke<void>("collection_set_variables", { root, variables }),
};
