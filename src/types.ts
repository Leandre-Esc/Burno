export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
export type Method = (typeof METHODS)[number];

export interface KeyValue {
  key: string;
  value: string;
  enabled: boolean;
}

export interface Variable extends KeyValue {
  /** Secret values are masked in the UI and never written to collection files */
  secret?: boolean;
}

export interface MultipartField extends KeyValue {
  /** When true, `value` is a path to a local file */
  isFile: boolean;
}

export type BodyMode = "none" | "json" | "xml" | "text" | "form" | "multipart";

export interface RequestBody {
  mode: BodyMode;
  json: string;
  xml: string;
  text: string;
  form: KeyValue[];
  multipart: MultipartField[];
}

export type AuthType = "none" | "basic" | "bearer" | "apikey" | "oauth2";
export type GrantType = "authorization_code" | "client_credentials" | "password" | "implicit";

export interface OAuth2Token {
  accessToken: string;
  tokenType?: string;
  refreshToken?: string;
  scope?: string;
  /** Epoch ms */
  expiresAt?: number;
  raw: Record<string, unknown>;
}

export interface OAuth2Config {
  grantType: GrantType;
  authorizationUrl: string;
  accessTokenUrl: string;
  callbackUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  state: string;
  usePkce: boolean;
  username: string;
  password: string;
  credentialsPlacement: "basic_header" | "body";
  tokenPlacement: "header" | "query";
  tokenHeaderPrefix: string;
  tokenQueryKey: string;
  autoFetch: boolean;
  autoRefresh: boolean;
  token: OAuth2Token | null;
}

export interface Auth {
  type: AuthType;
  basic: { username: string; password: string };
  bearer: { token: string };
  apikey: { key: string; value: string; placement: "header" | "query" };
  oauth2: OAuth2Config;
}

export interface RequestSettings {
  /** 0 means no timeout */
  timeoutMs: number;
  followRedirects: boolean;
  verifySsl: boolean;
}

export interface RequestItem {
  id: string;
  name: string;
  method: Method;
  url: string;
  params: KeyValue[];
  headers: KeyValue[];
  body: RequestBody;
  auth: Auth;
  settings: RequestSettings;
  /** Request-level variables, the highest precedence */
  vars: Variable[];
}

/** Global environments use a uuid as id; collection environments their file name. */
export interface Environment {
  id: string;
  name: string;
  variables: Variable[];
}

export interface HttpResponse {
  status: number;
  status_text: string;
  url: string;
  headers: [string, string][];
  body: string;
  time_ms: number;
  size_bytes: number;
}

export const emptyRow = (): KeyValue => ({ key: "", value: "", enabled: true });
/** Rows as edited in a table: always one empty row at the end for quick typing */
export function withEmptyRow<T extends KeyValue>(rows: unknown, row: () => T = emptyRow as () => T): T[] {
  const list = Array.isArray(rows) ? (rows as T[]) : [];
  const last = list[list.length - 1];
  return !last || last.key || last.value ? [...list, row()] : list;
}

export const emptyMultipartRow = (): MultipartField => ({ ...emptyRow(), isFile: false });

export function defaultAuth(): Auth {
  return {
    type: "none",
    basic: { username: "", password: "" },
    bearer: { token: "" },
    apikey: { key: "", value: "", placement: "header" },
    oauth2: {
      grantType: "authorization_code",
      authorizationUrl: "",
      accessTokenUrl: "",
      callbackUrl: "http://localhost:8080/callback",
      clientId: "",
      clientSecret: "",
      scope: "",
      state: "",
      usePkce: true,
      username: "",
      password: "",
      credentialsPlacement: "basic_header",
      tokenPlacement: "header",
      tokenHeaderPrefix: "Bearer",
      tokenQueryKey: "access_token",
      autoFetch: true,
      autoRefresh: true,
      token: null,
    },
  };
}

export function newRequest(): RequestItem {
  return {
    id: crypto.randomUUID(),
    name: "New Request",
    method: "GET",
    url: "https://jsonplaceholder.typicode.com/todos/1",
    params: [emptyRow()],
    headers: [emptyRow()],
    body: {
      mode: "none",
      json: "",
      xml: "",
      text: "",
      form: [emptyRow()],
      multipart: [emptyMultipartRow()],
    },
    auth: defaultAuth(),
    settings: { timeoutMs: 30000, followRedirects: true, verifySsl: true },
    vars: [emptyRow()],
  };
}

export function newEnvironment(name: string): Environment {
  return { id: crypto.randomUUID(), name, variables: [emptyRow()] };
}
