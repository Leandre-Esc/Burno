import { FileUp, Library, Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Collection } from "../collections";
import { parseImport, type ImportBundle } from "../import";
import { Dropdown } from "./Dropdown";

const NEW_COLLECTION = "\n";

interface Props {
  collections: Collection[];
  /** Collection of the open request */
  activeRoot: string | null;
  /** Resolves with whether something was imported */
  onImport: (bundle: ImportBundle, target: string | null) => Promise<boolean>;
  onClose: () => void;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function ImportModal({ collections, activeRoot, onImport, onClose }: Props) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const parsed = useMemo((): { bundle?: ImportBundle; error?: string } => {
    if (!text.trim()) return {};
    try {
      return { bundle: parseImport(text) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [text]);
  const { bundle, error } = parsed;

  // A whole API deserves its own collection; a single request or environment joins the current one
  const small = !!bundle && bundle.requests.length <= 1;
  const fallback = small && activeRoot ? activeRoot : NEW_COLLECTION;
  const destination = picked && (picked === NEW_COLLECTION || collections.some((c) => c.root === picked)) ? picked : fallback;

  const folders = useMemo(() => {
    const paths = new Set(bundle?.requests.filter((r) => r.folder.length).map((r) => r.folder.join("/")));
    return paths.size;
  }, [bundle]);

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setFileError(null);
    try {
      setText(await file.text());
      setFileName(file.name);
    } catch {
      setFileError(`Could not read ${file.name}.`);
    }
  };

  const clearFile = () => {
    setText("");
    setFileName(null);
    if (fileInput.current) fileInput.current.value = "";
  };

  const submit = async () => {
    if (!bundle || busy) return;
    setBusy(true);
    const done = await onImport(bundle, destination === NEW_COLLECTION ? null : destination);
    setBusy(false);
    if (done) onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal import-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">Import</div>
            <div className="modal-subtitle">cURL, Postman, Insomnia, OpenAPI or Swagger</div>
          </div>
          <button className="icon-btn" title="Close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="import-body">
          <input ref={fileInput} type="file" hidden accept=".json,.yaml,.yml" onChange={(e) => readFile(e.target.files?.[0])} />
          {fileName ? (
            <div className="import-file">
              <span className="import-file-name">{fileName}</span>
              <button className="btn small" onClick={clearFile}>Change</button>
            </div>
          ) : (
            <>
              <button className="btn" onClick={() => fileInput.current?.click()}><FileUp size={14} /> Choose a file…</button>
              <textarea
                className="import-text"
                autoFocus
                spellCheck={false}
                placeholder={"…or paste a cURL command or a document\n\ncurl https://api.example.com/users -H 'Accept: application/json'"}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </>
          )}
          {fileError && <p className="import-error">{fileError}</p>}
          {error && <p className="import-error">{error}</p>}
          {bundle && (
            <div className="import-summary">
              <div><b>{bundle.name}</b></div>
              <div className="import-counts">
                {bundle.format} · {plural(bundle.requests.length, "request")}
                {folders > 0 && ` · ${plural(folders, "folder")}`}
                {bundle.environments.length > 0 && ` · ${plural(bundle.environments.length, "environment")}`}
                {bundle.variables.length > 0 && ` · ${plural(bundle.variables.length, "variable")}`}
              </div>
              {bundle.warnings.length > 0 && (
                <ul className="import-warnings">
                  {bundle.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              )}
            </div>
          )}
          {bundle && (
            <Dropdown
              title="Import into"
              value={destination}
              options={[
                { value: NEW_COLLECTION, label: "New collection…", icon: <Plus size={14} /> },
                ...collections.map((c) => ({ value: c.root, label: c.name, icon: <Library size={14} /> })),
              ]}
              onChange={setPicked}
            />
          )}
          <p className="hint">Passwords, tokens and secrets found in the import stay on this machine, never in the files.</p>
        </div>
        <div className="import-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!bundle || busy} onClick={submit}>Import</button>
        </div>
      </div>
    </div>
  );
}
