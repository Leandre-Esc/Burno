import { Lock, LockOpen, X } from "lucide-react";
import type { ReactNode } from "react";
import { emptyRow, type KeyValue } from "../types";
import { VarInput } from "./VarInput";

interface Props<T extends KeyValue & { secret?: boolean }> {
  rows: T[];
  onChange: (rows: T[]) => void;
  newRow?: () => T;
  /** Custom value cell (e.g. text/file switch for multipart) */
  renderValue?: (row: T, update: (patch: Partial<T>) => void) => ReactNode;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  /** Adds a lock toggle that masks the value and keeps it out of files */
  secrets?: boolean;
}

export function KeyValueEditor<T extends KeyValue & { secret?: boolean }>({
  rows,
  onChange,
  newRow = emptyRow as () => T,
  renderValue,
  keyPlaceholder = "Key",
  valuePlaceholder = "Value",
  secrets = false,
}: Props<T>) {
  const update = (i: number, patch: Partial<T>) => {
    const next = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    // Always keep one empty row at the end for quick typing
    const last = next[next.length - 1];
    if (!last || last.key || last.value) next.push(newRow());
    onChange(next);
  };

  const remove = (i: number) => {
    const next = rows.filter((_, idx) => idx !== i);
    onChange(next.length ? next : [newRow()]);
  };

  return (
    <table className="kv-table">
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className={row.enabled ? "" : "disabled"}>
            <td className="kv-check">
              <input
                type="checkbox"
                checked={row.enabled}
                onChange={(e) => update(i, { enabled: e.target.checked } as Partial<T>)}
              />
            </td>
            <td>
              <input
                placeholder={keyPlaceholder}
                value={row.key}
                spellCheck={false}
                onChange={(e) => update(i, { key: e.target.value } as Partial<T>)}
              />
            </td>
            <td>
              {renderValue ? (
                renderValue(row, (patch) => update(i, patch))
              ) : (
                <VarInput
                  placeholder={valuePlaceholder}
                  value={row.value}
                  masked={!!row.secret}
                  onChange={(value) => update(i, { value } as Partial<T>)}
                />
              )}
            </td>
            {secrets && (
              <td className="kv-secret">
                <button
                  className={`delete-btn visible ${row.secret ? "on" : ""}`}
                  title={row.secret ? "Secret: masked and never written to collection files" : "Mark as secret"}
                  onClick={() => update(i, { secret: !row.secret } as Partial<T>)}
                >
                  {row.secret ? <Lock size={13} /> : <LockOpen size={13} />}
                </button>
              </td>
            )}
            <td className="kv-del">
              <button className="delete-btn" title="Remove" onClick={() => remove(i)}><X size={14} /></button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
