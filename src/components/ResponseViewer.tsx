import { useState } from "react";
import type { HttpResponse } from "../types";

interface Props {
  response: HttpResponse | null;
  error: string | null;
  loading: boolean;
}

type Tab = "body" | "headers";

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

export function ResponseViewer({ response, error, loading }: Props) {
  const [tab, setTab] = useState<Tab>("body");

  if (loading) return <section className="response empty">Sending request…</section>;
  if (error)
    return (
      <section className="response">
        <div className="error-box">{error}</div>
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
      </div>
      <div className="tabs">
        <button className={tab === "body" ? "active" : ""} onClick={() => setTab("body")}>
          Body
        </button>
        <button className={tab === "headers" ? "active" : ""} onClick={() => setTab("headers")}>
          Headers <span className="badge">{response.headers.length}</span>
        </button>
      </div>
      <div className="tab-content">
        {tab === "body" ? (
          <pre className="code">{prettify(response.body)}</pre>
        ) : (
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
      </div>
    </section>
  );
}
