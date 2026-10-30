import { ChevronRight, Loader2, Send } from "lucide-react";
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
  onChange: (req: RequestItem) => void;
  onSend: () => void;
}

export function RequestBar({ request, breadcrumb, loading, onChange, onSend }: Props) {
  return (
    <header className="request-bar" data-tauri-drag-region>
      <div className="breadcrumb" data-tauri-drag-region>
        {breadcrumb.map((part, i) => (
          <span key={i} className="crumb">
            {part}
            <ChevronRight size={12} />
          </span>
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
