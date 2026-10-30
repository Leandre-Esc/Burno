import type { Environment } from "./types";

export type Vars = Record<string, string>;

export function envVars(env: Environment | undefined): Vars {
  const vars: Vars = {};
  env?.variables.forEach((v) => {
    if (v.enabled && v.key) vars[v.key] = v.value;
  });
  return vars;
}

/** Replaces `{{name}}` with the variable value; unknown variables are left as-is. */
export function interpolate(text: string, vars: Vars): string {
  return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, name: string) =>
    name in vars ? vars[name] : match,
  );
}
