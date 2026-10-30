import type { ReactNode } from "react";
import { Dropdown } from "./Dropdown";
import { VarInput } from "./VarInput";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  secret?: boolean;
}

export function TextInput({ value, onChange, placeholder, secret }: TextInputProps) {
  return <VarInput inputClassName="input" value={value} placeholder={placeholder} masked={secret} onChange={onChange} />;
}

interface SelectProps<T extends string> {
  value: T;
  /** [value, label, optional hint shown under the label] */
  options: [T, string, string?][];
  onChange: (value: T) => void;
}

export function Select<T extends string>({ value, options, onChange }: SelectProps<T>) {
  return (
    <Dropdown
      value={value}
      options={options.map(([v, label, hint]) => ({ value: v, label, hint }))}
      onChange={onChange}
    />
  );
}

export function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="checkbox">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
