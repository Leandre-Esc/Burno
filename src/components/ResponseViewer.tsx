import { AlertTriangle, Check, Clock, Copy, HardDrive } from "lucide-react";
import { useMemo, useState } from "react";
import type { WireRequest } from "../api";
import logo from "../assets/logo.png";
import { fun } from "../fun";
import { sendShortcut } from "../platform";
import type { HttpResponse } from "../types";
import { CodeView } from "./CodeView";

interface Props {
  response: HttpResponse | null;
  sent: WireRequest | null;
  error: string | null;
  loading: boolean;
}

type Tab = "body" | "headers" | "request";

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
function sentToText(sent: WireRequest): string {
  const lines = [`${sent.method} ${sent.url}`, ...sent.headers.map(([k, v]) => `${k}: ${v}`)];
  const { body } = sent;
  if (body.type === "raw" && body.content) lines.push("", body.content);
  if (body.type === "multipart") {
    lines.push("", ...body.fields.map((f) => `${f.key}: ${f.is_file ? `@${f.value}` : f.value}`));
  }
  return lines.join("\n");
}

function EmptyPane({ loading, message }: { loading?: boolean; message: string }) {
  return (
    <div className="empty-state">
      <div className={`empty-logo small ${loading ? "loading" : ""}`}>
        <img src={logo} alt="" />
      </div>
      <p>{message}</p>
      {!loading && (
        <span className="shortcut-hint">
          <kbd>{sendShortcut}</kbd> to send
        </span>
      )}
    </div>
  );
}

export function ResponseViewer({ response, sent, error, loading }: Props) {
  const [tab, setTab] = useState<Tab>("body");
  const [copied, setCopied] = useState(false);
  // New line per request/response, stable across re-renders
  const sendingLine = useMemo(fun.sending, [loading]);
  const idleLine = useMemo(fun.idle, [response, error]);
  const flavor = useMemo(() => (response ? fun.status(response.status) : ""), [response]);
  const errorLine = useMemo(fun.networkError, [error]);

  if (loading) return <EmptyPane loading message={sendingLine} />;

  if (error)
    return (
      <>
        <div className="response-header">
          <span className="status-pill err">Error</span>
          <span className="flavor">{errorLine}</span>
        </div>
        <div className="response-error">
          <div className="error-box">
            <AlertTriangle size={15} />
            <span>{error}</span>
          </div>
          {sent && (
            <>
              <span className="section-label">Request sent</span>
              <CodeView text={sentToText(sent)} />
            </>
          )}
        </div>
      </>
    );

  if (!response) return <EmptyPane message={idleLine} />;

  const copy = async () => {
    await navigator.clipboard.writeText(response.body);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <>
      <div className="response-header">
        <span className={`status-pill ${statusClass(response.status)}`}>
          {response.status} {response.status_text}
        </span>
        <span className="meta"><Clock size={13} /> {response.time_ms} ms</span>
        <span className="meta"><HardDrive size={13} /> {formatSize(response.size_bytes)}</span>
        <span className="flavor">{flavor}</span>
        <span className="response-actions">
          <button className="icon-btn" title="Copy body" onClick={copy}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>
        </span>
      </div>
      <div className="tabs">
        <button className={tab === "body" ? "active" : ""} onClick={() => setTab("body")}>Body</button>
        <button className={tab === "headers" ? "active" : ""} onClick={() => setTab("headers")}>
          Headers <span className="badge">{response.headers.length}</span>
        </button>
        <button className={tab === "request" ? "active" : ""} onClick={() => setTab("request")}>Request</button>
      </div>
      <div className="tab-content" key={tab}>
        {tab === "body" && <CodeView text={response.body} />}
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
        {tab === "request" && sent && <CodeView text={sentToText(sent)} />}
      </div>
    </>
  );
}
