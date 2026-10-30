import { X } from "lucide-react";
import type { ReactNode } from "react";
import { emptyRow, type KeyValue } from "../types";

interface Props<T extends KeyValue> {
  rows: T[];
  onChange: (rows: T[]) => void;
  newRow?: () => T;
  /** Custom value cell (e.g. text/file switch for multipart) */
  renderValue?: (row: T, update: (patch: Partial<T>) => void) => ReactNode;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}

export function KeyValueEditor<T extends KeyValue>({
  rows,
  onChange,
  newRow = emptyRow as () => T,
  renderValue,
  keyPlaceholder = "Key",
  valuePlaceholder = "Value",
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
          <tr key={i}>
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
                <input
                  placeholder={valuePlaceholder}
                  value={row.value}
                  spellCheck={false}
                  onChange={(e) => update(i, { value: e.target.value } as Partial<T>)}
                />
              )}
            </td>
            <td className="kv-del">
              <button className="delete-btn" title="Remove" onClick={() => remove(i)}><X size={14} /></button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
