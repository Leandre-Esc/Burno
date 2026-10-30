import { Globe, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { newEnvironment, type Environment } from "../types";
import { KeyValueEditor } from "./KeyValueEditor";

interface Props {
  environments: Environment[];
  onChange: (envs: Environment[]) => void;
  onClose: () => void;
}

export function EnvironmentModal({ environments, onChange, onClose }: Props) {
  const [selectedId, setSelectedId] = useState(environments[0]?.id ?? null);
  const selected = environments.find((e) => e.id === selectedId);

  const update = (env: Environment) => onChange(environments.map((e) => (e.id === env.id ? env : e)));

  const add = () => {
    const env = newEnvironment(`Environment ${environments.length + 1}`);
    onChange([...environments, env]);
    setSelectedId(env.id);
  };

  const remove = (id: string) => {
    const remaining = environments.filter((e) => e.id !== id);
    onChange(remaining);
    setSelectedId(remaining[0]?.id ?? null);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">Environments</div>
            <div className="modal-subtitle">Variables shared by every collection</div>
          </div>
          <button className="icon-btn" title="Close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <ul className="env-list">
            {environments.map((env) => (
              <li key={env.id} className={env.id === selectedId ? "active" : ""} onClick={() => setSelectedId(env.id)}>
                <Globe size={14} />
                {env.name}
              </li>
            ))}
            <li className="env-add" onClick={add}>
              <Plus size={14} />
              New environment
            </li>
          </ul>
          <div className="env-editor">
            {selected ? (
              <>
                <div className="env-editor-header">
                  <input
                    className="input"
                    value={selected.name}
                    onChange={(e) => update({ ...selected, name: e.target.value })}
                  />
                  <button className="btn danger" onClick={() => remove(selected.id)}>
                    <Trash2 size={14} /> Delete
                  </button>
                </div>
                <p className="hint">
                  Use <code>{"{{name}}"}</code> in the URL, params, headers, body and auth fields.
                </p>
                <KeyValueEditor
                  rows={selected.variables}
                  keyPlaceholder="Variable"
                  onChange={(variables) => update({ ...selected, variables })}
                />
              </>
            ) : (
              <div className="empty-state">
                <p>Create an environment to store variables like base URLs and tokens.</p>
                <button className="btn-primary" onClick={add}><Plus size={15} /> New environment</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
