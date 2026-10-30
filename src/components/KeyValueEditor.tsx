import type { KeyValue } from "../types";

interface Props {
  rows: KeyValue[];
  onChange: (rows: KeyValue[]) => void;
}

export function KeyValueEditor({ rows, onChange }: Props) {
  const update = (i: number, patch: Partial<KeyValue>) => {
    const next = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    // Always keep one empty row at the end for quick typing
    const last = next[next.length - 1];
    if (!last || last.key || last.value) next.push({ key: "", value: "", enabled: true });
    onChange(next);
  };

  const remove = (i: number) => {
    const next = rows.filter((_, idx) => idx !== i);
    onChange(next.length ? next : [{ key: "", value: "", enabled: true }]);
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
                onChange={(e) => update(i, { enabled: e.target.checked })}
              />
            </td>
            <td>
              <input
                placeholder="Key"
                value={row.key}
                onChange={(e) => update(i, { key: e.target.value })}
              />
            </td>
            <td>
              <input
                placeholder="Value"
                value={row.value}
                onChange={(e) => update(i, { value: e.target.value })}
              />
            </td>
            <td className="kv-del">
              <button className="delete-btn" onClick={() => remove(i)}>×</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
