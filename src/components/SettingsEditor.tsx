import type { RequestSettings } from "../types";
import { Checkbox, Field } from "./fields";

interface Props {
  settings: RequestSettings;
  onChange: (settings: RequestSettings) => void;
}

export function SettingsEditor({ settings, onChange }: Props) {
  const set = (patch: Partial<RequestSettings>) => onChange({ ...settings, ...patch });

  return (
    <div className="form">
      <Field label="Timeout (ms)">
        <input
          className="input"
          type="number"
          min={0}
          value={settings.timeoutMs}
          onChange={(e) => set({ timeoutMs: Math.max(0, Number(e.target.value) || 0) })}
        />
      </Field>
      <p className="hint">0 = no timeout</p>
      <Field label="Redirects">
        <Checkbox label="Follow redirects" checked={settings.followRedirects} onChange={(followRedirects) => set({ followRedirects })} />
      </Field>
      <Field label="SSL">
        <Checkbox label="Verify SSL certificates" checked={settings.verifySsl} onChange={(verifySsl) => set({ verifySsl })} />
      </Field>
    </div>
  );
}
