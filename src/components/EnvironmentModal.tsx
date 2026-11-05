import { Check, Copy, FileKey2, Globe, Layers, Library, ListTree, Lock, Plus, RefreshCw, ShieldAlert, Trash2, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { Collection } from "../collections";
import type { EnvironmentsState } from "../environments";
import { DYNAMIC, SOURCE_LABELS, type Scope } from "../interpolate";
import { isProtected, type Environment, type Variable } from "../types";
import { Dropdown } from "./Dropdown";
import { KeyValueEditor } from "./KeyValueEditor";
import { ScopeContext } from "./VarInput";

export type EnvTab = "collection" | "global";

type Selection = { kind: "vars" } | { kind: "env"; id: string } | { kind: "dotenv" } | { kind: "resolved" };

interface Props {
  envs: EnvironmentsState;
  collections: Collection[];
  onCollectionVariables: (root: string, variables: Variable[]) => void;
  initialRoot: string | null;
  initialTab: EnvTab;
  onClose: () => void;
}

const mask = (value: string) => "•".repeat(Math.min(Math.max(value.length, 6), 16));

/** Name field that commits on blur / Enter (renaming a collection environment renames its file) */
function NameInput({ value, onCommit }: { value: string; onCommit: (name: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      className="input env-name"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => (draft.trim() ? draft !== value && onCommit(draft) : setDraft(value))}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(value);
          e.stopPropagation();
        }
      }}
    />
  );
}

function EnvActions({ env, active, onToggle, onProtect, onClone, onDelete }: { env: Environment; active: boolean; onToggle: () => void; onProtect: (on: boolean) => void; onClone: () => void; onDelete: () => void }) {
  const guarded = isProtected(env);
  return (
    <>
      <button
        className={`btn ${guarded ? "btn-guarded" : ""}`}
        onClick={() => onProtect(!guarded)}
        title={guarded ? "Asks before sending anything but GET, HEAD and OPTIONS. Click to stop asking." : "Ask before sending anything but GET, HEAD and OPTIONS"}
      >
        <ShieldAlert size={14} /> {guarded ? "Protected" : "Protect"}
      </button>
      <button className={`btn ${active ? "btn-active" : ""}`} onClick={onToggle} title={active ? "Deactivate" : "Use this environment"}>
        <Check size={14} /> {active ? "Active" : "Activate"}
      </button>
      <button className="btn" title="Clone" onClick={onClone}><Copy size={14} /></button>
      <button className="btn danger" title="Delete" onClick={onDelete}><Trash2 size={14} /></button>
    </>
  );
}

function Item({ icon, active, current, onClick, children }: { icon: ReactNode; active: boolean; current?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <li className={active ? "active" : ""} onClick={onClick}>
      {icon}
      <span className="env-item-name">{children}</span>
      {current && <span className="env-current" title="Active" />}
    </li>
  );
}

export function EnvironmentModal({ envs, collections, onCollectionVariables, initialRoot, initialTab, onClose }: Props) {
  const [tab, setTab] = useState<EnvTab>(initialTab);
  const [root, setRoot] = useState(initialRoot ?? collections[0]?.root ?? null);
  const colEnvs = root ? envs.byRoot[root] : undefined;
  const activeFile = root ? envs.activeByRoot[root] : undefined;
  const [selection, setSelection] = useState<Selection>(() =>
    activeFile ? { kind: "env", id: activeFile } : { kind: "vars" },
  );
  const [globalId, setGlobalId] = useState<string | null>(envs.activeGlobal?.id ?? envs.globals[0]?.id ?? null);

  const collection = collections.find((c) => c.root === root);
  const scope = envs.scopeFor(root, null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const switchRoot = (r: string) => {
    setRoot(r);
    setSelection(envs.activeByRoot[r] ? { kind: "env", id: envs.activeByRoot[r] } : { kind: "vars" });
  };

  const newCollectionEnv = async () => {
    if (!root) return;
    const id = await envs.collection.create(root);
    if (id) setSelection({ kind: "env", id });
  };

  const newGlobal = () => setGlobalId(envs.global.create());

  const selectedEnv = selection.kind === "env" ? colEnvs?.environments.find((e) => e.id === selection.id) : undefined;
  const selectedGlobal = envs.globals.find((e) => e.id === globalId);

  const collectionEditor = () => {
    if (!root || !collection) return <div className="empty-state"><p>Open a collection to give it environments.</p></div>;
    if (selection.kind === "vars") {
      return (
        <>
          <div className="env-editor-title">
            <Layers size={16} /> Collection variables
          </div>
          <p className="hint">
            Shared by every environment of <b>{collection.name}</b>, stored in <code>burno.json</code>. The active
            collection environment overrides them.
          </p>
          <KeyValueEditor
            rows={collection.variables}
            keyPlaceholder="Variable"
            secrets
            onChange={(variables) => onCollectionVariables(root, variables)}
          />
        </>
      );
    }
    if (selection.kind === "dotenv") {
      const entries = Object.entries(colEnvs?.dotenv ?? {});
      return (
        <>
          <div className="env-editor-title">
            <FileKey2 size={16} /> .env file
            <button className="btn small" onClick={() => envs.collection.reload(root)}><RefreshCw size={13} /> Reload</button>
          </div>
          <p className="hint">
            Read from the <code>.env</code> file at the root of the collection folder (keep it out of git). Use{" "}
            <code>{"{{process.env.KEY}}"}</code>.
          </p>
          {entries.length ? (
            <table className="resolved-table">
              <tbody>
                {entries.map(([key, value]) => (
                  <tr key={key}>
                    <td><code>process.env.{key}</code></td>
                    <td className="mono muted">{mask(value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="hint">No <code>.env</code> file in this collection.</p>
          )}
        </>
      );
    }
    if (selection.kind === "resolved") return <Resolved scope={scope} />;
    if (!selectedEnv) return <div className="empty-state"><p>This environment no longer exists.</p></div>;
    const active = activeFile === selectedEnv.id;
    return (
      <>
        <div className="env-editor-header">
          <NameInput
            key={selectedEnv.id}
            value={selectedEnv.name}
            onCommit={async (name) => setSelection({ kind: "env", id: await envs.collection.rename(root, selectedEnv, name) })}
          />
          <EnvActions
            env={selectedEnv}
            active={active}
            onProtect={(on) => envs.collection.update(root, { ...selectedEnv, protected: on })}
            onToggle={() => envs.collection.setActive(root, active ? null : selectedEnv.id)}
            onClone={async () => {
              const id = await envs.collection.clone(root, selectedEnv);
              if (id) setSelection({ kind: "env", id });
            }}
            onDelete={async () => {
              if (await envs.collection.remove(root, selectedEnv)) setSelection({ kind: "vars" });
            }}
          />
        </div>
        <p className="hint">
          Saved as <code>environments/{selectedEnv.id}</code>. Secret values <Lock size={11} className="inline-icon" /> stay
          on this machine, never in the file.
        </p>
        <KeyValueEditor
          rows={selectedEnv.variables}
          keyPlaceholder="Variable"
          secrets
          onChange={(variables) => envs.collection.update(root, { ...selectedEnv, variables })}
        />
      </>
    );
  };

  const globalEditor = () =>
    selectedGlobal ? (
      <>
        <div className="env-editor-header">
          <NameInput
            key={selectedGlobal.id}
            value={selectedGlobal.name}
            onCommit={(name) => envs.global.update({ ...selectedGlobal, name })}
          />
          <EnvActions
            env={selectedGlobal}
            active={envs.activeGlobal?.id === selectedGlobal.id}
            onProtect={(on) => envs.global.update({ ...selectedGlobal, protected: on })}
            onToggle={() => envs.global.setActive(envs.activeGlobal?.id === selectedGlobal.id ? null : selectedGlobal.id)}
            onClone={() => setGlobalId(envs.global.clone(selectedGlobal))}
            onDelete={async () => {
              if (await envs.global.remove(selectedGlobal)) setGlobalId(null);
            }}
          />
        </div>
        <p className="hint">
          Available in every collection, stored on this machine only. Collection variables and environments override
          them.
        </p>
        <KeyValueEditor
          rows={selectedGlobal.variables}
          keyPlaceholder="Variable"
          secrets
          onChange={(variables) => envs.global.update({ ...selectedGlobal, variables })}
        />
      </>
    ) : (
      <div className="empty-state">
        <p>Global environments hold variables shared by all your collections, like tokens or hosts.</p>
        <button className="btn-primary" onClick={newGlobal}><Plus size={15} /> New global environment</button>
      </div>
    );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal env-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-heading">
            <div className="modal-title">Environments</div>
            <div className="segmented">
              <button className={tab === "collection" ? "active" : ""} onClick={() => setTab("collection")}>
                <Layers size={13} /> Collection
              </button>
              <button className={tab === "global" ? "active" : ""} onClick={() => setTab("global")}>
                <Globe size={13} /> Global
              </button>
            </div>
          </div>
          <button className="icon-btn" title="Close" onClick={onClose}><X size={16} /></button>
        </div>
        <ScopeContext.Provider value={scope}>
          <div className="modal-body">
            {tab === "collection" ? (
              <ul className="env-list">
                {collections.length > 1 && (
                  <li className="env-collection-pick">
                    <Dropdown
                      value={root ?? ""}
                      options={collections.map((c) => ({ value: c.root, label: c.name, icon: <Library size={14} /> }))}
                      onChange={switchRoot}
                    />
                  </li>
                )}
                <Item icon={<Layers size={14} />} active={selection.kind === "vars"} onClick={() => setSelection({ kind: "vars" })}>
                  Collection variables
                </Item>
                <li className="env-list-label">Environments</li>
                {colEnvs?.environments.map((env: Environment) => (
                  <Item
                    key={env.id}
                    icon={<Globe size={14} />}
                    active={selection.kind === "env" && selection.id === env.id}
                    current={activeFile === env.id}
                    onClick={() => setSelection({ kind: "env", id: env.id })}
                  >
                    {env.name}
                  </Item>
                ))}
                <li className="env-add" onClick={newCollectionEnv}>
                  <Plus size={14} /> New environment
                </li>
                <li className="env-list-label">Inspect</li>
                <Item icon={<FileKey2 size={14} />} active={selection.kind === "dotenv"} onClick={() => setSelection({ kind: "dotenv" })}>
                  .env file
                </Item>
                <Item icon={<ListTree size={14} />} active={selection.kind === "resolved"} onClick={() => setSelection({ kind: "resolved" })}>
                  Resolved variables
                </Item>
              </ul>
            ) : (
              <ul className="env-list">
                <li className="env-list-label">Global environments</li>
                {envs.globals.map((env) => (
                  <Item
                    key={env.id}
                    icon={<Globe size={14} />}
                    active={env.id === globalId}
                    current={envs.activeGlobal?.id === env.id}
                    onClick={() => setGlobalId(env.id)}
                  >
                    {env.name}
                  </Item>
                ))}
                <li className="env-add" onClick={newGlobal}>
                  <Plus size={14} /> New environment
                </li>
              </ul>
            )}
            <div className="env-editor">{tab === "collection" ? collectionEditor() : globalEditor()}</div>
          </div>
        </ScopeContext.Provider>
      </div>
    </div>
  );
}

/** Final value of every variable for the active environments, and where it comes from. */
function Resolved({ scope }: { scope: Scope }) {
  const vars = Object.values(scope).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <div className="env-editor-title">
        <ListTree size={16} /> Resolved variables
      </div>
      <p className="hint">
        What <code>{"{{name}}"}</code> becomes with the active environments. Precedence, highest first: request
        variables › collection environment › collection variables › global environment.
      </p>
      {vars.length ? (
        <table className="resolved-table">
          <tbody>
            {vars.map((v) => (
              <tr key={v.name}>
                <td><code>{v.name}</code></td>
                <td className="mono">{v.secret ? <span className="muted">{mask(v.value)}</span> : v.value || <em className="muted">empty</em>}</td>
                <td>
                  <span className={`var-tag ${v.source}`}>{SOURCE_LABELS[v.source]}</span>
                  {v.overrides.length > 0 && (
                    <div className="resolved-overrides">overrides {v.overrides.map((s) => SOURCE_LABELS[s].toLowerCase()).join(", ")}</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="hint">No variable defined yet.</p>
      )}
      <div className="env-list-label standalone">Dynamic variables</div>
      <table className="resolved-table">
        <tbody>
          {Object.entries(DYNAMIC).map(([name, d]) => (
            <tr key={name}>
              <td><code>{name}</code></td>
              <td className="muted">{d.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
