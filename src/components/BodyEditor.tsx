import { open } from "@tauri-apps/plugin-dialog";
import { Paperclip, Sparkles, Type } from "lucide-react";
import { emptyMultipartRow, type BodyMode, type MultipartField, type RequestBody } from "../types";
import { Dropdown } from "./Dropdown";
import { KeyValueEditor } from "./KeyValueEditor";

const MODES: [BodyMode, string][] = [
  ["none", "None"],
  ["json", "JSON"],
  ["xml", "XML"],
  ["text", "Text"],
  ["form", "Form"],
  ["multipart", "Multipart"],
];

const PLACEHOLDERS = { json: '{\n  "hello": "{{name}}"\n}', xml: "<root></root>", text: "" };

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

interface Props {
  body: RequestBody;
  onChange: (body: RequestBody) => void;
}

export function BodyEditor({ body, onChange }: Props) {
  const set = (patch: Partial<RequestBody>) => onChange({ ...body, ...patch });
  const { mode } = body;

  const formatJson = () => {
    try {
      set({ json: JSON.stringify(JSON.parse(body.json), null, 2) });
    } catch {
      // not valid JSON (e.g. unquoted {{vars}}): leave as-is
    }
  };

  const multipartValue = (row: MultipartField, update: (patch: Partial<MultipartField>) => void) => (
    <div className="multipart-value">
      <Dropdown
        variant="ghost"
        value={row.isFile ? "file" : "text"}
        options={[
          { value: "text", label: "Text", icon: <Type size={13} /> },
          { value: "file", label: "File", icon: <Paperclip size={13} /> },
        ]}
        onChange={(kind) => update({ isFile: kind === "file", value: "" })}
      />
      {row.isFile ? (
        <button
          className="file-btn"
          onClick={async () => {
            const path = await open({ multiple: false, directory: false });
            if (typeof path === "string") update({ value: path });
          }}
        >
          <Paperclip size={13} />
          {row.value ? fileName(row.value) : "Choose file…"}
        </button>
      ) : (
        <input placeholder="Value" value={row.value} spellCheck={false} onChange={(e) => update({ value: e.target.value })} />
      )}
    </div>
  );

  return (
    <div className="body-editor">
      <div className="body-toolbar">
        <div className="segmented">
          {MODES.map(([m, label]) => (
            <button key={m} className={m === mode ? "active" : ""} onClick={() => set({ mode: m })}>
              {label}
            </button>
          ))}
        </div>
        {mode === "json" && (
          <button className="btn small" onClick={formatJson}>
            <Sparkles size={13} /> Format
          </button>
        )}
      </div>
      {mode === "none" && <p className="hint">This request has no body.</p>}
      {(mode === "json" || mode === "xml" || mode === "text") && (
        <textarea
          className="code-input"
          placeholder={PLACEHOLDERS[mode]}
          spellCheck={false}
          value={body[mode]}
          onChange={(e) => set({ [mode]: e.target.value })}
        />
      )}
      {mode === "form" && <KeyValueEditor rows={body.form} onChange={(form) => set({ form })} />}
      {mode === "multipart" && (
        <KeyValueEditor
          rows={body.multipart}
          newRow={emptyMultipartRow}
          renderValue={multipartValue}
          onChange={(multipart) => set({ multipart })}
        />
      )}
    </div>
  );
}
