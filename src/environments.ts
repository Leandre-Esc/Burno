import { ask } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { envApi, onCollectionChanged } from "./api";
import { nodeKey, type Collection } from "./collections";
import { buildScope, type Layer, type Scope } from "./interpolate";
import {
  loadActiveCollectionEnvs,
  loadActiveEnvironment,
  loadEnvironments,
  moveSecrets,
  saveActiveCollectionEnvs,
  saveActiveEnvironment,
  saveEnvironments,
  saveSecrets,
  stripSecrets,
  withSecrets,
} from "./storage";
import { emptyRow, isProtected, newEnvironment, withEmptyRow, type Environment, type RequestItem, type Variable } from "./types";

/** Environments of one collection; their id is the file name in `environments/` */
export interface CollectionEnvs {
  environments: Environment[];
  dotenv: Record<string, string>;
}

const SAVE_DELAY_MS = 400;
const sanitize = (name: string) => name.replace(/[\\/:*?"<>|]/g, "-").trim() || "Untitled";
const fileOf = (name: string) => `${sanitize(name)}.json`;
const owner = (root: string, file: string) => nodeKey(root, `environments/${file}`);

function uniqueName(envs: Environment[], base: string) {
  const taken = new Set(envs.map((e) => e.id.toLowerCase()));
  for (let i = 1; ; i++) {
    const name = i === 1 ? base : `${base} ${i}`;
    if (!taken.has(fileOf(name).toLowerCase())) return name;
  }
}

const toFile = (env: Environment) => ({ uid: env.uid, name: env.name, protected: env.protected, variables: stripSecrets(env.variables) });

/** Global environments (on this machine) and per-collection environments (on disk). */
export function useEnvironments(collections: Collection[], report: (e: unknown) => void) {
  const [globals, setGlobalsState] = useState(loadEnvironments);
  const [activeGlobalId, setActiveGlobalId] = useState(loadActiveEnvironment);
  const [byRoot, setByRoot] = useState<Record<string, CollectionEnvs>>({});
  const [activeByRoot, setActiveByRoot] = useState(loadActiveCollectionEnvs);
  const timers = useRef(new Map<string, number>());
  const latest = useRef(byRoot);
  latest.current = byRoot;

  useEffect(() => saveEnvironments(globals), [globals]);
  useEffect(() => saveActiveEnvironment(activeGlobalId), [activeGlobalId]);
  useEffect(() => saveActiveCollectionEnvs(activeByRoot), [activeByRoot]);

  const reload = async (root: string) => {
    const raw = await envApi.list(root);
    const seenUids = new Set<string>();
    const migrations: Environment[] = [];
    const environments = raw.environments.map(({ file, data }): Environment => {
      const d = (data ?? {}) as Partial<Environment>;
      const variables = withEmptyRow<Variable>(d.variables);
      const env = {
        id: file,
        // No uid yet, or a file copied by hand
        uid: d.uid && !seenUids.has(d.uid) ? d.uid : crypto.randomUUID(),
        name: d.name || file.replace(/\.json$/, ""),
        protected: typeof d.protected === "boolean" ? d.protected : undefined,
        variables: withSecrets(owner(root, file), variables),
      };
      seenUids.add(env.uid);
      if (env.uid !== d.uid) migrations.push(env);
      return env;
    });
    setByRoot((b) => {
      // Edits not written yet win over what is still on disk
      const pending = (env: Environment) => timers.current.has(owner(root, env.id));
      const merged = environments.map((env) =>
        pending(env) ? (b[root]?.environments.find((e) => e.id === env.id) ?? env) : env,
      );
      return { ...b, [root]: { environments: merged, dotenv: raw.dotenv } };
    });
    for (const env of migrations) {
      if (!timers.current.has(owner(root, env.id))) await envApi.write(root, env.id, toFile(env));
    }
  };

  useEffect(() => {
    const stop = onCollectionChanged((root) => {
      reload(root).catch(report);
    });
    return () => stop();
  }, []);

  const rootsKey = collections.map((c) => c.root).join("\n");
  useEffect(() => {
    collections.forEach((c) => {
      if (!latest.current[c.root]) reload(c.root).catch(report);
    });
  }, [rootsKey]);

  /** Writes pending edits of a collection right away */
  const flush = async (root: string) => {
    const pending = (latest.current[root]?.environments ?? []).filter((e) => timers.current.has(owner(root, e.id)));
    for (const env of pending) {
      clearTimeout(timers.current.get(owner(root, env.id)));
      timers.current.delete(owner(root, env.id));
      await envApi.write(root, env.id, toFile(env));
    }
  };

  const setActive = (root: string, file: string | null) =>
    setActiveByRoot((m) => {
      const next = { ...m };
      if (file) next[root] = file;
      else delete next[root];
      return next;
    });

  const collection = {
    reload: (root: string) => reload(root).catch(report),

    setActive,

    create: async (root: string, base = "New Environment", variables: Variable[] = [emptyRow()]) => {
      try {
        await flush(root);
        const name = uniqueName(latest.current[root]?.environments ?? [], base);
        const env = { id: fileOf(name), uid: crypto.randomUUID(), name, variables };
        saveSecrets(owner(root, env.id), variables);
        await envApi.write(root, env.id, toFile(env), true);
        await reload(root);
        return env.id;
      } catch (e) {
        report(e);
        return null;
      }
    },

    update: (root: string, env: Environment) => {
      setByRoot((b) => ({
        ...b,
        [root]: { ...b[root], environments: b[root].environments.map((e) => (e.id === env.id ? env : e)) },
      }));
      const key = owner(root, env.id);
      saveSecrets(key, env.variables);
      clearTimeout(timers.current.get(key));
      const timer = window.setTimeout(() => {
        // Stays pending until written, so a reload can't bring back older content meanwhile
        envApi
          .write(root, env.id, toFile(env))
          .catch(report)
          .finally(() => {
            if (timers.current.get(key) === timer) timers.current.delete(key);
          });
      }, SAVE_DELAY_MS);
      timers.current.set(key, timer);
    },

    /** Renames the environment and its file; returns the new id */
    rename: async (root: string, env: Environment, newName: string) => {
      const name = newName.trim();
      if (!name || name === env.name) return env.id;
      try {
        await flush(root);
        const file = fileOf(name);
        if (file !== env.id) {
          await envApi.rename(root, env.id, file);
          moveSecrets(owner(root, env.id), owner(root, file));
          if (activeByRoot[root] === env.id) setActive(root, file);
        }
        await envApi.write(root, file, toFile({ ...env, id: file, name }));
        await reload(root);
        return file;
      } catch (e) {
        report(e);
        return env.id;
      }
    },

    clone: (root: string, env: Environment) => collection.create(root, `${env.name} copy`, env.variables),

    remove: async (root: string, env: Environment) => {
      if (!(await ask(`Move the environment "${env.name}" to the trash?`, { title: "Delete", kind: "warning" }))) return false;
      try {
        await flush(root);
        await envApi.remove(root, env.id);
        saveSecrets(owner(root, env.id), []);
        if (activeByRoot[root] === env.id) setActive(root, null);
        await reload(root);
        return true;
      } catch (e) {
        report(e);
        return false;
      }
    },
  };

  const global = {
    set: setGlobalsState,
    setActive: setActiveGlobalId,
    create: (base = "New Environment", variables: Variable[] = [emptyRow()]) => {
      const env = { ...newEnvironment(uniqueName(globals.map((g) => ({ ...g, id: fileOf(g.name) })), base)), variables };
      setGlobalsState((g) => [...g, env]);
      return env.id;
    },
    update: (env: Environment) => setGlobalsState((g) => g.map((e) => (e.id === env.id ? env : e))),
    clone: (env: Environment) => global.create(`${env.name} copy`, env.variables),
    remove: async (env: Environment) => {
      if (!(await ask(`Delete the global environment "${env.name}"?`, { title: "Delete", kind: "warning" }))) return false;
      setGlobalsState((g) => g.filter((e) => e.id !== env.id));
      if (activeGlobalId === env.id) setActiveGlobalId(null);
      return true;
    },
  };

  const activeGlobal = globals.find((e) => e.id === activeGlobalId) ?? null;
  const activeCollectionEnv = (root: string | null) =>
    (root && byRoot[root]?.environments.find((e) => e.id === activeByRoot[root])) || null;

  /** The active environment that asks before changing data, if any */
  const protectedEnv = (root: string | null) =>
    [activeCollectionEnv(root), activeGlobal].find((env) => env && isProtected(env)) ?? null;

  /**
   * Every variable visible from a request, lowest precedence first:
   * global env < collection variables < collection env < request variables.
   * `{{process.env.X}}` comes from the collection's `.env` file.
   */
  const scopeFor = (root: string | null, request: RequestItem | null): Scope => {
    const col = collections.find((c) => c.root === root);
    const layers: Layer[] = [
      { source: "global", variables: activeGlobal?.variables ?? [] },
      { source: "collection", variables: col?.variables ?? [] },
      { source: "environment", variables: activeCollectionEnv(root)?.variables ?? [] },
      { source: "request", variables: request?.vars ?? [] },
    ];
    return buildScope(layers, root ? byRoot[root]?.dotenv : {});
  };

  return {
    globals,
    activeGlobal,
    byRoot,
    activeByRoot,
    activeCollectionEnv,
    protectedEnv,
    scopeFor,
    collection,
    global,
  };
}

export type EnvironmentsState = ReturnType<typeof useEnvironments>;
