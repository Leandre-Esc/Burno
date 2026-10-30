import { useState } from "react";
import { interpolate, type Vars } from "../interpolate";
import { fetchToken, isExpired, refreshToken } from "../oauth2";
import type { GrantType, OAuth2Config, RequestSettings } from "../types";
import { Checkbox, Field, Select, TextInput } from "./fields";

const GRANT_TYPES: [GrantType, string, string][] = [
  ["authorization_code", "Authorization Code", "User logs in through the browser"],
  ["client_credentials", "Client Credentials", "Machine to machine, no user"],
  ["password", "Password Credentials", "Username and password sent directly"],
  ["implicit", "Implicit", "Legacy browser flow, token in the redirect"],
];

interface Props {
  config: OAuth2Config;
  vars: Vars;
  settings: RequestSettings;
  onChange: (config: OAuth2Config) => void;
}

export function OAuth2Editor({ config, vars, settings, onChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<OAuth2Config>) => onChange({ ...config, ...patch });

  const grant = config.grantType;
  const usesBrowser = grant === "authorization_code" || grant === "implicit";
  const usesTokenEndpoint = grant !== "implicit";
  const { token } = config;

  const run = async (action: typeof fetchToken) => {
    setBusy(true);
    setError(null);
    try {
      set({ token: await action(config, (s) => interpolate(s, vars), settings) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Field label="Grant Type">
        <Select value={grant} options={GRANT_TYPES} onChange={(grantType) => set({ grantType })} />
      </Field>

      {usesBrowser && (
        <>
          <Field label="Callback URL">
            <TextInput value={config.callbackUrl} onChange={(callbackUrl) => set({ callbackUrl })} />
          </Field>
          <Field label="Authorization URL">
            <TextInput
              value={config.authorizationUrl}
              placeholder="https://provider.com/oauth/authorize"
              onChange={(authorizationUrl) => set({ authorizationUrl })}
            />
          </Field>
        </>
      )}
      {usesTokenEndpoint && (
        <Field label="Access Token URL">
          <TextInput
            value={config.accessTokenUrl}
            placeholder="https://provider.com/oauth/token"
            onChange={(accessTokenUrl) => set({ accessTokenUrl })}
          />
        </Field>
      )}

      <Field label="Client ID">
        <TextInput value={config.clientId} onChange={(clientId) => set({ clientId })} />
      </Field>
      {usesTokenEndpoint && (
        <Field label="Client Secret">
          <TextInput secret value={config.clientSecret} onChange={(clientSecret) => set({ clientSecret })} />
        </Field>
      )}

      {grant === "password" && (
        <>
          <Field label="Username">
            <TextInput value={config.username} onChange={(username) => set({ username })} />
          </Field>
          <Field label="Password">
            <TextInput secret value={config.password} onChange={(password) => set({ password })} />
          </Field>
        </>
      )}

      <Field label="Scope">
        <TextInput value={config.scope} placeholder="read write" onChange={(scope) => set({ scope })} />
      </Field>
      {usesBrowser && (
        <Field label="State">
          <TextInput value={config.state} placeholder="Auto-generated" onChange={(state) => set({ state })} />
        </Field>
      )}
      {grant === "authorization_code" && (
        <Field label="PKCE">
          <Checkbox label="Use PKCE (S256)" checked={config.usePkce} onChange={(usePkce) => set({ usePkce })} />
        </Field>
      )}
      {usesTokenEndpoint && (
        <Field label="Client Credentials">
          <Select
            value={config.credentialsPlacement}
            options={[
              ["basic_header", "Send as Basic Auth header"],
              ["body", "Send in request body"],
            ]}
            onChange={(credentialsPlacement) => set({ credentialsPlacement })}
          />
        </Field>
      )}

      <Field label="Add Token to">
        <Select
          value={config.tokenPlacement}
          options={[
            ["header", "Header"],
            ["query", "Query Params"],
          ]}
          onChange={(tokenPlacement) => set({ tokenPlacement })}
        />
      </Field>
      {config.tokenPlacement === "header" ? (
        <Field label="Header Prefix">
          <TextInput value={config.tokenHeaderPrefix} onChange={(tokenHeaderPrefix) => set({ tokenHeaderPrefix })} />
        </Field>
      ) : (
        <Field label="Query Param Key">
          <TextInput value={config.tokenQueryKey} onChange={(tokenQueryKey) => set({ tokenQueryKey })} />
        </Field>
      )}

      <Field label="Automation">
        <div className="checkbox-group">
          <Checkbox label="Auto-fetch token if missing" checked={config.autoFetch} onChange={(autoFetch) => set({ autoFetch })} />
          <Checkbox label="Auto-refresh expired token" checked={config.autoRefresh} onChange={(autoRefresh) => set({ autoRefresh })} />
        </div>
      </Field>

      <div className="form-actions">
        <button className="btn-primary" disabled={busy} onClick={() => run(fetchToken)}>
          {busy ? "Waiting…" : "Get Access Token"}
        </button>
        {token?.refreshToken && (
          <button className="btn" disabled={busy} onClick={() => run(refreshToken)}>Refresh</button>
        )}
        {token && (
          <button className="btn" disabled={busy} onClick={() => set({ token: null })}>Clear</button>
        )}
      </div>

      {error && <div className="error-box">{error}</div>}

      {token && (
        <div className="token-box">
          <div className="token-row">
            <span>Access Token</span>
            <code>{token.accessToken}</code>
          </div>
          {token.tokenType && (
            <div className="token-row">
              <span>Type</span>
              <code>{token.tokenType}</code>
            </div>
          )}
          <div className="token-row">
            <span>Expires</span>
            <code className={isExpired(token) ? "expired" : ""}>
              {token.expiresAt ? new Date(token.expiresAt).toLocaleString() : "Never"}
              {isExpired(token) && " (expired)"}
            </code>
          </div>
          {token.refreshToken && (
            <div className="token-row">
              <span>Refresh Token</span>
              <code>{token.refreshToken}</code>
            </div>
          )}
          {token.scope && (
            <div className="token-row">
              <span>Scope</span>
              <code>{token.scope}</code>
            </div>
          )}
          <details>
            <summary>Raw response</summary>
            <pre>{JSON.stringify(token.raw, null, 2)}</pre>
          </details>
        </div>
      )}
    </>
  );
}
