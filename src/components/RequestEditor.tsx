import { useState } from "react";
import { METHODS, type Method, type RequestItem } from "../types";
import { KeyValueEditor } from "./KeyValueEditor";

interface Props {
  request: RequestItem;
  loading: boolean;
  onChange: (req: RequestItem) => void;
  onSend: () => void;
}

type Tab = "body" | "headers";

export function RequestEditor({ request, loading, onChange, onSend }: Props) {
  const [tab, setTab] = useState<Tab>("body");
  const set = (patch: Partial<RequestItem>) => onChange({ ...request, ...patch });
  const headerCount = request.headers.filter((h) => h.enabled && h.key).length;

  return (
    <section className="request-editor">
      <input
        className="request-name"
        value={request.name}
        onChange={(e) => set({ name: e.target.value })}
      />
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
          placeholder="https://api.example.com/resource"
          value={request.url}
          onChange={(e) => set({ url: e.target.value })}
        />
        <button className="send-btn" type="submit" disabled={loading || !request.url}>
          {loading ? "Sending…" : "Send"}
        </button>
      </form>

      <div className="tabs">
        <button className={tab === "body" ? "active" : ""} onClick={() => setTab("body")}>
          Body
        </button>
        <button className={tab === "headers" ? "active" : ""} onClick={() => setTab("headers")}>
          Headers {headerCount > 0 && <span className="badge">{headerCount}</span>}
        </button>
      </div>

      <div className="tab-content">
        {tab === "body" ? (
          <textarea
            className="code"
            placeholder='{ "hello": "world" }'
            spellCheck={false}
            value={request.body}
            onChange={(e) => set({ body: e.target.value })}
          />
        ) : (
          <KeyValueEditor rows={request.headers} onChange={(headers) => set({ headers })} />
        )}
      </div>
    </section>
  );
}
