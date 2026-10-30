import { useState } from "react";
import type { Vars } from "../interpolate";
import type { KeyValue, RequestItem } from "../types";
import { urlFromParams } from "../url";
import { AuthEditor } from "./AuthEditor";
import { BodyEditor } from "./BodyEditor";
import { KeyValueEditor } from "./KeyValueEditor";
import { SettingsEditor } from "./SettingsEditor";

interface Props {
  request: RequestItem;
  vars: Vars;
  onChange: (req: RequestItem) => void;
}

type Tab = "params" | "body" | "headers" | "auth" | "vars" | "settings";

const countActive = (rows: KeyValue[]) => rows.filter((r) => r.enabled && r.key).length;

export function RequestEditor({ request, vars, onChange }: Props) {
  const [tab, setTab] = useState<Tab>("params");
  const set = (patch: Partial<RequestItem>) => onChange({ ...request, ...patch });

  // badge: a count, true for a dot, or nothing
  const tabs: [Tab, string, number | boolean][] = [
    ["params", "Params", countActive(request.params)],
    ["body", "Body", request.body.mode !== "none"],
    ["headers", "Headers", countActive(request.headers)],
    ["auth", "Auth", request.auth.type !== "none"],
    ["vars", "Vars", countActive(request.vars)],
    ["settings", "Settings", false],
  ];

  return (
    <>
      <div className="tabs">
        {tabs.map(([id, label, badge]) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
            {label}
            {typeof badge === "number" ? badge > 0 && <span className="badge">{badge}</span> : badge && <span className="dot" />}
          </button>
        ))}
      </div>

      <div className="tab-content" key={tab}>
        {tab === "params" && (
          <KeyValueEditor
            rows={request.params}
            onChange={(params) => set({ params, url: urlFromParams(request.url, params) })}
          />
        )}
        {tab === "body" && <BodyEditor body={request.body} onChange={(body) => set({ body })} />}
        {tab === "headers" && <KeyValueEditor rows={request.headers} onChange={(headers) => set({ headers })} />}
        {tab === "auth" && (
          <AuthEditor auth={request.auth} vars={vars} settings={request.settings} onChange={(auth) => set({ auth })} />
        )}
        {tab === "vars" && (
          <>
            <p className="hint">
              Request variables override every environment. They can reference other variables, e.g.{" "}
              <code>{"{{baseUrl}}/v2"}</code>.
            </p>
            <KeyValueEditor rows={request.vars} keyPlaceholder="Variable" onChange={(vars) => set({ vars })} />
          </>
        )}
        {tab === "settings" && <SettingsEditor settings={request.settings} onChange={(settings) => set({ settings })} />}
      </div>
    </>
  );
}
