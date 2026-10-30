import { Check, ChevronsUpDown, Globe, Layers, Settings2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { EnvironmentsState } from "../environments";
import type { Environment } from "../types";
import type { EnvTab } from "./EnvironmentModal";

interface Props {
  envs: EnvironmentsState;
  /** Collection of the open request */
  root: string | null;
  collectionName: string | null;
  onManage: (tab: EnvTab) => void;
}

function Options({ list, activeId, onPick }: { list: Environment[]; activeId: string | null; onPick: (id: string | null) => void }) {
  return (
    <>
      {[null, ...list].map((env) => (
        <button key={env?.id ?? ""} className={`env-option ${(env?.id ?? null) === activeId ? "active" : ""}`} onClick={() => onPick(env?.id ?? null)}>
          <Check size={13} />
          <span>{env ? env.name : "No environment"}</span>
        </button>
      ))}
    </>
  );
}

/** Footer button choosing the active collection environment and global environment. */
export function EnvPicker({ envs, root, collectionName, onManage }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const colEnv = envs.activeCollectionEnv(root);
  const global = envs.activeGlobal;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const manage = (tab: EnvTab) => {
    setOpen(false);
    onManage(tab);
  };

  return (
    <div className="env-picker-wrap" ref={ref}>
      <button className={`env-picker ${colEnv || global ? "active" : ""}`} onClick={() => setOpen((o) => !o)} title="Environments">
        <Globe size={14} />
        <span className="env-picker-labels">
          <span className={colEnv ? "" : "muted"}>{colEnv?.name ?? "No environment"}</span>
          {global && <span className="env-picker-global">+ {global.name}</span>}
        </span>
        <ChevronsUpDown size={13} className="muted" />
      </button>
      {open && (
        <div className="env-popover">
          <div className="env-popover-section">
            <div className="env-popover-title">
              <Layers size={12} /> {collectionName ?? "Collection"}
              <button className="icon-btn" title="Configure collection environments" onClick={() => manage("collection")}><Settings2 size={13} /></button>
            </div>
            {root ? (
              <Options
                list={envs.byRoot[root]?.environments ?? []}
                activeId={colEnv?.id ?? null}
                onPick={(id) => {
                  envs.collection.setActive(root, id);
                  setOpen(false);
                }}
              />
            ) : (
              <p className="hint">No collection open.</p>
            )}
          </div>
          <div className="env-popover-section">
            <div className="env-popover-title">
              <Globe size={12} /> Global
              <button className="icon-btn" title="Configure global environments" onClick={() => manage("global")}><Settings2 size={13} /></button>
            </div>
            <Options
              list={envs.globals}
              activeId={global?.id ?? null}
              onPick={(id) => {
                envs.global.setActive(id);
                setOpen(false);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
