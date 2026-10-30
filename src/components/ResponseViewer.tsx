import { useState } from "react";
import type { WireRequest } from "../api";
import type { HttpResponse } from "../types";

interface Props {
  response: HttpResponse | null;
  sent: WireRequest | null;
  error: string | null;
  loading: boolean;
}

type Tab = "body" | "headers" | "request";

function prettify(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function statusClass(status: number): string {
  if (status < 300) return "ok";
  if (status < 400) return "redirect";
  return "err";
}

/** Raw view of what was actually sent (after variables and auth). */
function SentRequest({ sent }: { sent: WireRequest }) {
  const lines = [`${sent.method} ${sent.url}`, ...sent.headers.map(([k, v]) => `${k}: ${v}`)];
  const { body } = sent;
  if (body.type === "raw" && body.content) lines.push("", body.content);
  if (body.type === "multipart") {
    lines.push("", ...body.fields.map((f) => `${f.key}: ${f.is_file ? `@${f.value}` : f.value}`));
  }
  return <pre className="code">{lines.join("\n")}</pre>;
}

export function ResponseViewer({ response, sent, error, loading }: Props) {
  const [tab, setTab] = useState<Tab>("body");

  if (loading) return <section className="response empty">Sending request…</section>;
  if (error)
    return (
      <section className="response">
        <div className="error-box">{error}</div>
        {sent && <SentRequest sent={sent} />}
      </section>
    );
  if (!response)
    return <section className="response empty">Hit Send to see the response here.</section>;

  return (
    <section className="response">
      <div className="response-meta">
        <span className={`status ${statusClass(response.status)}`}>
          {response.status} {response.status_text}
        </span>
        <span>{response.time_ms} ms</span>
        <span>{formatSize(response.size_bytes)}</span>
        <button className="btn copy-btn" onClick={() => navigator.clipboard.writeText(response.body)}>
          Copy body
        </button>
      </div>
      <div className="tabs">
        <button className={tab === "body" ? "active" : ""} onClick={() => setTab("body")}>
          Body
        </button>
        <button className={tab === "headers" ? "active" : ""} onClick={() => setTab("headers")}>
          Headers <span className="badge">{response.headers.length}</span>
        </button>
        <button className={tab === "request" ? "active" : ""} onClick={() => setTab("request")}>
          Request
        </button>
      </div>
      <div className="tab-content">
        {tab === "body" && <pre className="code">{prettify(response.body)}</pre>}
        {tab === "headers" && (
          <table className="headers-table">
            <tbody>
              {response.headers.map(([k, v], i) => (
                <tr key={i}>
                  <td>{k}</td>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === "request" && sent && <SentRequest sent={sent} />}
      </div>
    </section>
  );
}
