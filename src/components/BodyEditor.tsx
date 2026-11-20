import { open } from "@tauri-apps/plugin-dialog";
import { AlignLeft, CircleAlert, CircleCheck, Minimize2, Paperclip, Rows3, Sparkles, TextCursorInput, Type, WrapText } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { checkJson, formatJson, formatXml, fromBulk, locateXmlError, toBulk, type BodyIssue } from "../bodyFormat";
import { emptyMultipartRow, emptyRow, type BodyMode, type KeyValue, type MultipartField, type RequestBody } from "../types";
import { CodeEditor, type CodeEditorHandle, type CursorInfo } from "./CodeEditor";
import { Dropdown } from "./Dropdown";
import { KeyValueEditor } from "./KeyValueEditor";
import { VarInput } from "./VarInput";

const MODES: [BodyMode, string][] = [
  ["none", "None"],
  ["json", "JSON"],
  ["xml", "XML"],
  ["text", "Text"],
  ["form", "Form"],
  ["multipart", "Multipart"],
];

/** Same defaults as prepare.ts */
const CONTENT_TYPES: Record<Exclude<BodyMode, "none">, string> = {
  json: "application/json",
  xml: "application/xml",
  text: "text/plain",
  form: "application/x-www-form-urlencoded",
  multipart: "multipart/form-data",
};

const PLACEHOLDERS = {
  json: '{\n  "name": "{{name}}",\n  "id": {{userId}}\n}',
  xml: '<?xml version="1.0" encoding="UTF-8"?>\n<root>\n  <name>{{name}}</name>\n</root>',
  text: "Plain text, {{variables}} welcome",
};

const WRAP_KEY = "burno.body.wrap";

function readWrap() {
  try {
    return localStorage.getItem(WRAP_KEY) === "1";
  } catch {
    return false;
  }
}

function checkXml(text: string): BodyIssue | null {
  if (!text.trim()) return null;
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const error = doc.querySelector("parsererror");
  // WebKit/Blink wrap the message in a <div> between two headings
  return error ? locateXmlError(text, (error.querySelector("div") ?? error).textContent ?? "") : null;
}

const VALIDATORS = { json: checkJson, xml: checkXml };

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function lineOf(text: string, offset: number) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text[i] === "\n") line++;
  return line;
}

interface Props {
  body: RequestBody;
  /** Request headers, to tell whether Content-Type is set by hand */
  headers: KeyValue[];
  onChange: (body: RequestBody) => void;
}

export function BodyEditor({ body, headers, onChange }: Props) {
  const set = (patch: Partial<RequestBody>) => onChange({ ...body, ...patch });
  const { mode } = body;
  const editor = useRef<CodeEditorHandle>(null);
  const [cursor, setCursor] = useState<CursorInfo>({ line: 1, col: 1, selected: 0 });
  const [wrap, setWrap] = useState(readWrap);
  const [bulk, setBulk] = useState(false);
  const [bulkText, setBulkText] = useState("");

  const isCode = mode === "json" || mode === "xml" || mode === "text";
  const isTable = mode === "form" || mode === "multipart";
  const text = isCode ? body[mode] : "";
  const validate = mode === "json" || mode === "xml" ? VALIDATORS[mode] : undefined;
  const issue = useMemo(() => validate?.(text) ?? null, [validate, text]);
  const size = useMemo(() => new TextEncoder().encode(text).length, [text]);

  const customType = headers.find((h) => h.enabled && h.key.trim().toLowerCase() === "content-type");

  const toggleWrap = () => {
    setWrap(!wrap);
    try {
      localStorage.setItem(WRAP_KEY, wrap ? "0" : "1");
    } catch {
      // storage unavailable: the choice just won't be remembered
    }
  };

  const reveal = (i: BodyIssue) => editor.current?.reveal(i.from, i.to);

  const format = (indent: number) => {
    if (mode === "json") {
      const out = formatJson(text, indent);
      if (out === null) return issue && reveal(issue);
      set({ json: out });
    } else if (mode === "xml") {
      if (issue) return reveal(issue);
      set({ xml: formatXml(text) });
    }
  };

  const rows = mode === "form" ? body.form : body.multipart;
  const openBulk = () => {
    setBulkText(toBulk(rows, mode === "multipart"));
    setBulk(true);
  };
  const editBulk = (value: string) => {
    setBulkText(value);
    if (mode === "form") set({ form: [...fromBulk(value).map(({ isFile: _, ...r }) => r), emptyRow()] });
    else set({ multipart: [...fromBulk(value, true).map((r) => ({ ...r, isFile: !!r.isFile })), emptyMultipartRow()] });
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
          className={`file-btn ${row.value ? "" : "empty"}`}
          title={row.value || undefined}
          onClick={async () => {
            const path = await open({ multiple: false, directory: false });
            if (typeof path === "string") update({ value: path });
          }}
        >
          <Paperclip size={13} />
          <span>{row.value ? fileName(row.value) : "Choose file…"}</span>
        </button>
      ) : (
        <VarInput placeholder="Value" value={row.value} onChange={(value) => update({ value })} />
      )}
    </div>
  );

  const contentType =
    mode === "none" ? null : customType ? (
      <span className="body-ctype" title="Set in the Headers tab">
        Content-Type <code>{customType.value || "(empty)"}</code> from Headers
      </span>
    ) : (
      <span className="body-ctype" title="Added automatically unless you set a Content-Type header">
        Sent as <code>{CONTENT_TYPES[mode]}</code>
      </span>
    );

  return (
    <div className="body-editor">
      <div className="body-toolbar">
        <div className="segmented">
          {MODES.map(([m, label]) => (
            <button
              key={m}
              className={m === mode ? "active" : ""}
              onClick={() => {
                setBulk(false);
                set({ mode: m });
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="body-actions">
          {(mode === "json" || mode === "xml") && (
            <button className="btn small" onClick={() => format(2)} title={`Format ${mode.toUpperCase()} (⇧⌥F)`}>
              <Sparkles size={13} /> Format
            </button>
          )}
          {mode === "json" && (
            <button className="btn small" onClick={() => format(0)} title="Remove all whitespace">
              <Minimize2 size={13} /> Minify
            </button>
          )}
          {isCode && (
            <button className={`btn small icon-toggle ${wrap ? "on" : ""}`} onClick={toggleWrap} title="Wrap long lines">
              <WrapText size={13} />
            </button>
          )}
          {isTable && (
            <button className={`btn small ${bulk ? "on" : ""}`} onClick={() => (bulk ? setBulk(false) : openBulk())}>
              {bulk ? <Rows3 size={13} /> : <AlignLeft size={13} />} {bulk ? "Table" : "Bulk edit"}
            </button>
          )}
        </div>
      </div>

      {mode === "none" && (
        <div className="body-empty">
          <TextCursorInput size={20} />
          <p>This request has no body.</p>
          <div className="body-empty-picks">
            {(["json", "xml", "text", "form", "multipart"] as const).map((m) => (
              <button key={m} className="btn small" onClick={() => set({ mode: m })}>
                {MODES.find(([id]) => id === m)![1]}
              </button>
            ))}
          </div>
        </div>
      )}

      {isCode && (
        <div
          className="code-box"
          onKeyDown={(e) => {
            if (e.shiftKey && e.altKey && e.code === "KeyF") {
              e.preventDefault();
              format(2);
            }
          }}
        >
          <CodeEditor
            key={mode}
            ref={editor}
            language={mode}
            value={text}
            placeholder={PLACEHOLDERS[mode]}
            wrap={wrap}
            validate={validate}
            onChange={(value) => set({ [mode]: value })}
            onCursor={setCursor}
          />
          <div className="code-status">
            {validate && text.trim() !== "" && (
              issue ? (
                <button className="code-status-issue" onClick={() => reveal(issue)} title="Show the error">
                  <CircleAlert size={12} />
                  <span>{issue.message}</span>
                  <span className="code-status-at">Ln {lineOf(text, issue.from)}</span>
                </button>
              ) : (
                <span className="code-status-ok">
                  <CircleCheck size={12} /> Valid {mode.toUpperCase()}
                </span>
              )
            )}
            <span className="code-status-spacer" />
            <span>
              Ln {cursor.line}, Col {cursor.col}
              {cursor.selected > 0 && ` (${cursor.selected} selected)`}
            </span>
            <span>{formatSize(size)}</span>
            {contentType}
          </div>
        </div>
      )}

      {isTable && bulk && (
        <div className="code-box">
          <CodeEditor
            key={`bulk-${mode}`}
            language="text"
            value={bulkText}
            placeholder={mode === "multipart" ? "key: value\navatar: @/path/to/file.png\n// disabled: value" : "key: value\n// disabled: value"}
            onChange={editBulk}
            onCursor={setCursor}
          />
          <div className="code-status">
            <span>
              One <code>key: value</code> per line, <code>//</code> disables a line
              {mode === "multipart" && <>, <code>@path</code> sends a file</>}
            </span>
            <span className="code-status-spacer" />
            {contentType}
          </div>
        </div>
      )}

      {isTable && !bulk && (
        <>
          {mode === "form" ? (
            <KeyValueEditor rows={body.form} onChange={(form) => set({ form })} />
          ) : (
            <KeyValueEditor
              rows={body.multipart}
              newRow={emptyMultipartRow}
              renderValue={multipartValue}
              onChange={(multipart) => set({ multipart })}
            />
          )}
          <div className="body-footnote">{contentType}</div>
        </>
      )}
    </div>
  );
}
