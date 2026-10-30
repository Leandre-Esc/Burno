import { openAuthWindow, sendHttp } from "./api";
import { basicAuthHeader } from "./prepare";
import type { OAuth2Config, OAuth2Token, RequestSettings } from "./types";

type Interpolate = (s: string) => string;

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const randomString = (size = 32) => base64Url(crypto.getRandomValues(new Uint8Array(size)));

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

function parseToken(data: Record<string, unknown>): OAuth2Token {
  const accessToken = data.access_token;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new Error(`No access_token in response: ${JSON.stringify(data)}`);
  }
  const expiresIn = Number(data.expires_in);
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  return {
    accessToken,
    tokenType: str(data.token_type),
    refreshToken: str(data.refresh_token),
    scope: str(data.scope),
    expiresAt: expiresIn > 0 ? Date.now() + expiresIn * 1000 : undefined,
    raw: data,
  };
}

/** POSTs to the token endpoint with the given grant params. */
async function requestToken(
  cfg: OAuth2Config,
  i: Interpolate,
  settings: RequestSettings,
  params: Record<string, string>,
): Promise<OAuth2Token> {
  const url = i(cfg.accessTokenUrl);
  if (!url) throw new Error("Access Token URL is required");

  const form = new URLSearchParams(params);
  const headers: [string, string][] = [
    ["Content-Type", "application/x-www-form-urlencoded"],
    ["Accept", "application/json"],
  ];
  const clientId = i(cfg.clientId);
  const clientSecret = i(cfg.clientSecret);
  if (cfg.credentialsPlacement === "basic_header" && clientSecret) {
    headers.push(["Authorization", basicAuthHeader(clientId, clientSecret)]);
  } else {
    if (clientId) form.set("client_id", clientId);
    if (clientSecret) form.set("client_secret", clientSecret);
  }

  const res = await sendHttp({ method: "POST", url, headers, body: { type: "raw", content: form.toString() } }, settings);
  if (res.status >= 400) throw new Error(`Token request failed (${res.status}): ${res.body}`);
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(res.body);
  } catch {
    // Some providers (e.g. GitHub without Accept) answer form-encoded
    data = Object.fromEntries(new URLSearchParams(res.body));
  }
  return parseToken(data);
}

/** Runs the browser part of the flow and returns the callback params (query + fragment). */
async function authorize(
  cfg: OAuth2Config,
  i: Interpolate,
  responseType: "code" | "token",
  extra: Record<string, string> = {},
): Promise<URLSearchParams> {
  const callbackUrl = i(cfg.callbackUrl);
  if (!i(cfg.authorizationUrl)) throw new Error("Authorization URL is required");
  const url = new URL(i(cfg.authorizationUrl));
  const state = i(cfg.state) || randomString(16);
  const scope = i(cfg.scope);

  url.searchParams.set("response_type", responseType);
  url.searchParams.set("client_id", i(cfg.clientId));
  url.searchParams.set("redirect_uri", callbackUrl);
  url.searchParams.set("state", state);
  if (scope) url.searchParams.set("scope", scope);
  Object.entries(extra).forEach(([k, v]) => url.searchParams.set(k, v));

  const result = new URL(await openAuthWindow(url.toString(), callbackUrl));
  const params = new URLSearchParams(result.search);
  new URLSearchParams(result.hash.slice(1)).forEach((v, k) => params.set(k, v));

  const error = params.get("error");
  if (error) {
    const description = params.get("error_description");
    throw new Error(`Authorization failed: ${error}${description ? ` — ${description}` : ""}`);
  }
  if (params.has("state") && params.get("state") !== state) {
    throw new Error("State mismatch in authorization response");
  }
  return params;
}

export async function fetchToken(cfg: OAuth2Config, i: Interpolate, settings: RequestSettings): Promise<OAuth2Token> {
  const scope = i(cfg.scope);
  const withScope = (params: Record<string, string>) => (scope ? { ...params, scope } : params);

  switch (cfg.grantType) {
    case "client_credentials":
      return requestToken(cfg, i, settings, withScope({ grant_type: "client_credentials" }));
    case "password":
      return requestToken(
        cfg,
        i,
        settings,
        withScope({ grant_type: "password", username: i(cfg.username), password: i(cfg.password) }),
      );
    case "implicit":
      return parseToken(Object.fromEntries(await authorize(cfg, i, "token")));
    case "authorization_code": {
      const verifier = randomString(48);
      const pkce = cfg.usePkce
        ? { code_challenge: await pkceChallenge(verifier), code_challenge_method: "S256" }
        : undefined;
      const params = await authorize(cfg, i, "code", pkce);
      const code = params.get("code");
      if (!code) throw new Error("No authorization code in the callback URL");
      return requestToken(cfg, i, settings, {
        grant_type: "authorization_code",
        code,
        redirect_uri: i(cfg.callbackUrl),
        ...(pkce ? { code_verifier: verifier } : {}),
      });
    }
  }
}

export async function refreshToken(cfg: OAuth2Config, i: Interpolate, settings: RequestSettings): Promise<OAuth2Token> {
  const refresh = cfg.token?.refreshToken;
  if (!refresh) throw new Error("No refresh token available");
  const token = await requestToken(cfg, i, settings, { grant_type: "refresh_token", refresh_token: refresh });
  // Providers that don't rotate refresh tokens omit it from the response
  return { ...token, refreshToken: token.refreshToken ?? refresh };
}

export const isExpired = (token: OAuth2Token) =>
  token.expiresAt !== undefined && token.expiresAt < Date.now() + 10_000;

/** Returns a usable token before a request, refreshing or fetching one when allowed. */
export async function ensureToken(
  cfg: OAuth2Config,
  i: Interpolate,
  settings: RequestSettings,
): Promise<OAuth2Token | null> {
  const { token } = cfg;
  if (token && !isExpired(token)) return token;
  if (token?.refreshToken && cfg.autoRefresh) {
    try {
      return await refreshToken(cfg, i, settings);
    } catch {
      // refresh token rejected: fall back to a full fetch below
    }
  }
  if (cfg.autoFetch) return fetchToken(cfg, i, settings);
  return token;
}
