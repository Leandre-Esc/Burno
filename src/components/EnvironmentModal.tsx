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
          <span>Environments</span>
          <button className="delete-btn visible" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <ul className="env-list">
            {environments.map((env) => (
              <li key={env.id} className={env.id === selectedId ? "active" : ""} onClick={() => setSelectedId(env.id)}>
                {env.name}
              </li>
            ))}
            <li className="env-add" onClick={add}>+ New environment</li>
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
                  <button className="btn danger" onClick={() => remove(selected.id)}>Delete</button>
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
              <p className="hint">Create an environment to store variables like base URLs and tokens.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
