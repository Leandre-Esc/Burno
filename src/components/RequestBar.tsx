import { ChevronRight, Loader2, Send, ShieldAlert } from "lucide-react";
import { looksLikeCurl, parseCurl } from "../import";
import { sendShortcut } from "../platform";
import { METHODS, type Method, type RequestItem } from "../types";
import { paramsFromUrl } from "../url";
import { Dropdown } from "./Dropdown";
import { VarInput } from "./VarInput";

interface Props {
  request: RequestItem;
  /** Collection and folder names leading to the request */
  breadcrumb: string[];
  loading: boolean;
  /** Name of the active protected environment */
  protectedEnv: string | null;
  /** What a pasted cURL command could not bring over */
  onNotice: (message: string) => void;
  onChange: (req: RequestItem) => void;
  onSend: () => void;
}

export function RequestBar({ request, breadcrumb, loading, protectedEnv, onNotice, onChange, onSend }: Props) {
  /** A cURL command pasted in the URL field fills in the whole request */
  const pasteCurl = (e: React.ClipboardEvent) => {
    if (!(e.target instanceof HTMLInputElement) || !e.target.closest(".url-input")) return;
    const text = e.clipboardData.getData("text");
    const bundle = looksLikeCurl(text) ? parseCurl(text) : null;
    if (!bundle) return;
    e.preventDefault();
    onChange({ ...bundle.requests[0].request, id: request.id, uid: request.uid, name: request.name });
    if (bundle.warnings.length) onNotice(bundle.warnings.join(" "));
  };

  return (
    <header className={`request-bar ${protectedEnv ? "guarded" : ""}`} data-tauri-drag-region>
      <div className="breadcrumb" data-tauri-drag-region>
        {breadcrumb.map((part, i) => (
          <span key={i} className="crumb">
            {part}
            <ChevronRight size={12} />
          </span>
        ))}
        <span className="request-name">{request.name}</span>
        {protectedEnv && (
          <span className="env-guard" title="Protected environment: Burno asks before sending anything but GET, HEAD and OPTIONS">
            <ShieldAlert size={12} /> {protectedEnv}
          </span>
        )}
      </div>
      <form
        className="url-bar"
        onPasteCapture={pasteCurl}
        onSubmit={(e) => {
          e.preventDefault();
          onSend();
        }}
      >
        <Dropdown
          className="method-select"
          variant="ghost"
          title="Method"
          menuWidth={150}
          value={request.method}
          options={METHODS.map((m) => ({ value: m, label: m, className: `method-${m}` }))}
          onChange={(method: Method) => onChange({ ...request, method })}
        />
        <VarInput
          className="url-input"
          placeholder="{{baseUrl}}/resource"
          value={request.url}
          onChange={(url) => onChange({ ...request, url, params: paramsFromUrl(url, request.params) })}
        />
        <button className="send-btn" type="submit" disabled={loading || !request.url} title={`Send (${sendShortcut})`}>
          {loading ? <Loader2 size={15} className="spin" /> : <Send size={14} />}
          Send
          <kbd>{sendShortcut}</kbd>
        </button>
      </form>
    </header>
  );
}
