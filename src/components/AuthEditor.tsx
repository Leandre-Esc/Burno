import type { Vars } from "../interpolate";
import type { Auth, AuthType, RequestSettings } from "../types";
import { Field, Select, TextInput } from "./fields";
import { OAuth2Editor } from "./OAuth2Editor";

const AUTH_TYPES: [AuthType, string, string][] = [
  ["none", "No Auth", "Send the request as is"],
  ["basic", "Basic Auth", "Username and password"],
  ["bearer", "Bearer Token", "Authorization: Bearer <token>"],
  ["apikey", "API Key", "A key in a header or the query"],
  ["oauth2", "OAuth 2.0", "Get and refresh tokens automatically"],
];

interface Props {
  auth: Auth;
  vars: Vars;
  settings: RequestSettings;
  onChange: (auth: Auth) => void;
}

export function AuthEditor({ auth, vars, settings, onChange }: Props) {
  const setBasic = (p: Partial<Auth["basic"]>) => onChange({ ...auth, basic: { ...auth.basic, ...p } });
  const setBearer = (p: Partial<Auth["bearer"]>) => onChange({ ...auth, bearer: { ...auth.bearer, ...p } });
  const setApiKey = (p: Partial<Auth["apikey"]>) => onChange({ ...auth, apikey: { ...auth.apikey, ...p } });

  return (
    <div className="form">
      <Field label="Type">
        <Select value={auth.type} options={AUTH_TYPES} onChange={(type) => onChange({ ...auth, type })} />
      </Field>

      {auth.type === "none" && <p className="hint">This request does not use any authorization.</p>}

      {auth.type === "basic" && (
        <>
          <Field label="Username">
            <TextInput value={auth.basic.username} onChange={(username) => setBasic({ username })} />
          </Field>
          <Field label="Password">
            <TextInput secret value={auth.basic.password} onChange={(password) => setBasic({ password })} />
          </Field>
        </>
      )}

      {auth.type === "bearer" && (
        <Field label="Token">
          <TextInput value={auth.bearer.token} placeholder="{{token}}" onChange={(token) => setBearer({ token })} />
        </Field>
      )}

      {auth.type === "apikey" && (
        <>
          <Field label="Key">
            <TextInput value={auth.apikey.key} placeholder="X-API-Key" onChange={(key) => setApiKey({ key })} />
          </Field>
          <Field label="Value">
            <TextInput secret value={auth.apikey.value} onChange={(value) => setApiKey({ value })} />
          </Field>
          <Field label="Add to">
            <Select
              value={auth.apikey.placement}
              options={[
                ["header", "Header", "Sent as a request header"],
                ["query", "Query Params", "Appended to the URL"],
              ]}
              onChange={(placement) => setApiKey({ placement })}
            />
          </Field>
        </>
      )}

      {auth.type === "oauth2" && (
        <OAuth2Editor
          config={auth.oauth2}
          vars={vars}
          settings={settings}
          onChange={(oauth2) => onChange({ ...auth, oauth2 })}
        />
      )}
    </div>
  );
}
