import { useState } from "react";
import type { Vars } from "../interpolate";
import { METHODS, type KeyValue, type Method, type RequestItem } from "../types";
import { paramsFromUrl, urlFromParams } from "../url";
import { AuthEditor } from "./AuthEditor";
import { BodyEditor } from "./BodyEditor";
import { KeyValueEditor } from "./KeyValueEditor";
import { SettingsEditor } from "./SettingsEditor";

interface Props {
  request: RequestItem;
  /** Collection and folder names leading to the request */
  breadcrumb: string[];
  vars: Vars;
  loading: boolean;
  onChange: (req: RequestItem) => void;
  onSend: () => void;
}

type Tab = "params" | "body" | "headers" | "auth" | "settings";

const countActive = (rows: KeyValue[]) => rows.filter((r) => r.enabled && r.key).length;

export function RequestEditor({ request, breadcrumb, vars, loading, onChange, onSend }: Props) {
  const [tab, setTab] = useState<Tab>("params");
  const set = (patch: Partial<RequestItem>) => onChange({ ...request, ...patch });

  const tabs: [Tab, string, number | string | null][] = [
    ["params", "Params", countActive(request.params) || null],
    ["body", "Body", request.body.mode === "none" ? null : "•"],
    ["headers", "Headers", countActive(request.headers) || null],
    ["auth", "Auth", request.auth.type === "none" ? null : "•"],
    ["settings", "Settings", null],
  ];

  return (
    <section className="request-editor">
      <div className="breadcrumb">
        {breadcrumb.map((part, i) => (
          <span key={i} className="crumb">{part} /</span>
        ))}
        <span className="request-name">{request.name}</span>
      </div>
      <form
        className="url-bar"
        onSubmit={(e) => {
          e.preventDefault();
          onSend();
        }}
      >
        <select
          className={`method method-${request.method}`}
          value={request.method}
          onChange={(e) => set({ method: e.target.value as Method })}
        >
          {METHODS.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <input
          className="url-input"
          placeholder="{{baseUrl}}/resource"
          spellCheck={false}
          value={request.url}
          onChange={(e) => set({ url: e.target.value, params: paramsFromUrl(e.target.value, request.params) })}
        />
        <button className="send-btn" type="submit" disabled={loading || !request.url}>
          {loading ? "Sending…" : "Send"}
        </button>
      </form>

      <div className="tabs">
        {tabs.map(([id, label, badge]) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
            {label} {badge !== null && <span className="badge">{badge}</span>}
          </button>
        ))}
      </div>

      <div className="tab-content">
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
        {tab === "settings" && <SettingsEditor settings={request.settings} onChange={(settings) => set({ settings })} />}
      </div>
    </section>
  );
}
