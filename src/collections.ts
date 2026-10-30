import { ask, open } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { collectionApi, envApi, type RawNode } from "./api";
import {
  clearLegacyRequests,
  loadActiveRequest,
  loadCollectionRoots,
  loadExpanded,
  loadLegacyRequests,
  loadTokens,
  moveTokens,
  normalizeRequest,
  saveActiveRequest,
  saveCollectionRoots,
  saveExpanded,
  saveSecrets,
  saveToken,
  stripSecrets,
  withSecrets,
} from "./storage";
import { newRequest, withEmptyRow, type OAuth2Token, type RequestItem, type Variable } from "./types";

export interface FolderNode {
  kind: "folder";
  name: string;
  path: string;
  children: TreeNode[];
}

export interface RequestNode {
  kind: "request";
  path: string;
  id: string;
}

export type TreeNode = FolderNode | RequestNode;

export interface Collection {
  root: string;
  name: string;
  /** Collection-level variables, stored in burno.json */
  variables: Variable[];
  children: TreeNode[];
}

/** `path` "" targets the collection itself */
export interface RenameTarget {
  root: string;
  path: string;
}

const SEP = "::";
const SAVE_DELAY_MS = 400;

/** Unique key of a node: request ids, expanded folders, … */
export const nodeKey = (root: string, path: string) => `${root}${SEP}${path}`;

/** Collection root of a request id */
export const rootOf = (id: string) => splitKey(id)[0];

/** Owner key of the collection variables' secrets */
const varsOwner = (root: string) => nodeKey(root, "burno.json");

function splitKey(key: string): [string, string] {
  const i = key.lastIndexOf(SEP);
  return [key.slice(0, i), key.slice(i + SEP.length)];
}

const joinPath = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
const parentDir = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));
export const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const sanitize = (name: string) => name.replace(/[\\/:*?"<>|]/g, "-").trim() || "Untitled";

function folderChildren(nodes: TreeNode[], dir: string): TreeNode[] {
  if (!dir) return nodes;
  for (const node of nodes) {
    if (node.kind !== "folder") continue;
    if (node.path === dir) return node.children;
    if (dir.startsWith(`${node.path}/`)) return folderChildren(node.children, dir);
  }
  return [];
}

/** "New Request", "New Request 2", … whichever file name is still free in the folder. */
function uniqueName(siblings: TreeNode[], base: string, ext: string): string {
  const taken = new Set(siblings.map((n) => baseName(n.path).toLowerCase()));
  for (let i = 1; ; i++) {
    const name = i === 1 ? base : `${base} ${i}`;
    if (!taken.has(`${sanitize(name)}${ext}`.toLowerCase())) return name;
  }
}

/** What goes in the request file: no in-memory id, no OAuth token. */
function toFile(req: RequestItem) {
  return { ...req, id: undefined, auth: { ...req.auth, oauth2: { ...req.auth.oauth2, token: null } } };
}

function convert(
  root: string,
  nodes: RawNode[],
  requests: Record<string, RequestItem>,
  tokens: Record<string, OAuth2Token>,
): TreeNode[] {
  return nodes.map((node): TreeNode => {
    if (node.kind === "folder") return { ...node, children: convert(root, node.children, requests, tokens) };
    const id = nodeKey(root, node.path);
    const req = normalizeRequest({ name: baseName(node.path).replace(/\.json$/, ""), ...(node.data as object), id });
    req.auth.oauth2.token = tokens[id] ?? null;
    requests[id] = req;
    return { kind: "request", path: node.path, id };
  });
}

/** Moves requests saved in localStorage by older versions into the default collection. */
async function migrateLegacyRequests(root: string) {
  const used = new Set<string>();
  for (const req of loadLegacyRequests()) {
    let name = req.name;
    for (let i = 2; used.has(sanitize(name).toLowerCase()); i++) name = `${req.name} ${i}`;
    used.add(sanitize(name).toLowerCase());
    const path = `${sanitize(name)}.json`;
    try {
      await collectionApi.createRequest(root, path, toFile({ ...req, name }));
      if (req.auth.oauth2.token) saveToken(nodeKey(root, path), req.auth.oauth2.token);
    } catch {
      // file already exists: keep the one on disk
    }
  }
  clearLegacyRequests();
}

export function useCollections() {
  const [roots, setRoots] = useState(loadCollectionRoots);
  const [loaded, setLoaded] = useState<Record<string, Collection>>({});
  const [requests, setRequests] = useState<Record<string, RequestItem>>({});
  const [activeId, setActiveId] = useState(loadActiveRequest);
  const [expanded, setExpanded] = useState(() => new Set(loadExpanded()));
  const [renaming, setRenaming] = useState<RenameTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(requests);
  latest.current = requests;
  const timers = useRef(new Map<string, number>());
  const started = useRef(false);

  useEffect(() => saveCollectionRoots(roots), [roots]);
  useEffect(() => saveExpanded([...expanded]), [expanded]);
  useEffect(() => saveActiveRequest(activeId), [activeId]);

  const report = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  /** Wraps an async action so failures show up in the error toast. */
  const guard =
    <A extends unknown[]>(fn: (...args: A) => Promise<void>) =>
    (...args: A) => {
      fn(...args).catch(report);
    };

  /** Re-reads a collection from disk (disk is the source of truth). */
  const reload = async (root: string) => {
    const raw = await collectionApi.load(root);
    const fresh: Record<string, RequestItem> = {};
    const variables = withEmptyRow<Variable>(raw.variables);
    const collection = {
      root,
      name: raw.name,
      variables: withSecrets(varsOwner(root), variables),
      children: convert(root, raw.children, fresh, loadTokens()),
    };
    // Unsaved variable edits win over what is still on disk
    const pending = timers.current.has(varsOwner(root));
    setLoaded((l) => ({ ...l, [root]: pending && l[root] ? { ...collection, variables: l[root].variables } : collection }));
    setRequests((rs) => ({
      ...Object.fromEntries(Object.entries(rs).filter(([id]) => !id.startsWith(nodeKey(root, "")))),
      ...fresh,
    }));
  };

  const writeNow = (req: RequestItem) => {
    const [root, path] = splitKey(req.id);
    return collectionApi.writeRequest(root, path, toFile(req));
  };

  /** Writes pending edits right away (before renaming, deleting, reloading…). */
  const flush = async () => {
    // Only request writes: collection variables keep their own timer
    const ids = [...timers.current.keys()].filter((id) => latest.current[id]);
    ids.forEach((id) => {
      clearTimeout(timers.current.get(id));
      timers.current.delete(id);
    });
    await Promise.all(ids.map((id) => writeNow(latest.current[id])));
  };

  const expand = (root: string, dir: string) =>
    setExpanded((ex) => {
      const next = new Set(ex).add(nodeKey(root, ""));
      for (let d = dir; d; d = parentDir(d)) next.add(nodeKey(root, d));
      return next;
    });

  /** Keeps ids (active request, expanded folders, tokens) valid after a rename. */
  const remap = (root: string, from: string, to: string) => {
    const fromKey = nodeKey(root, from);
    const toKey = nodeKey(root, to);
    const move = (id: string) =>
      id === fromKey || id.startsWith(`${fromKey}/`) ? toKey + id.slice(fromKey.length) : id;
    moveTokens(move);
    setActiveId((id) => id && move(id));
    setExpanded((ex) => new Set([...ex].map(move)));
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      let list = loadCollectionRoots();
      if (!list.length) {
        const root = await collectionApi.defaultRoot();
        await migrateLegacyRequests(root);
        list = [root];
        setRoots(list);
        expand(root, "");
      }
      const failed: string[] = [];
      for (const root of list) await reload(root).catch(() => failed.push(root));
      if (failed.length) {
        setRoots((rs) => rs.filter((r) => !failed.includes(r)));
        setError(`Could not open collection: ${failed.join(", ")}`);
      }
    })().catch(report);
  }, []);

  const updateRequest = (req: RequestItem) => {
    setRequests((rs) => ({ ...rs, [req.id]: req }));
    saveToken(req.id, req.auth.oauth2.token);
    clearTimeout(timers.current.get(req.id));
    timers.current.set(
      req.id,
      window.setTimeout(() => {
        timers.current.delete(req.id);
        writeNow(req).catch(report);
      }, SAVE_DELAY_MS),
    );
  };

  const setVariables = (root: string, variables: Variable[]) => {
    setLoaded((l) => ({ ...l, [root]: { ...l[root], variables } }));
    saveSecrets(varsOwner(root), variables);
    const key = varsOwner(root);
    clearTimeout(timers.current.get(key));
    timers.current.set(
      key,
      window.setTimeout(() => {
        timers.current.delete(key);
        envApi.setCollectionVariables(root, stripSecrets(variables)).catch(report);
      }, SAVE_DELAY_MS),
    );
  };

  const actions = {
    setVariables,

    select: (id: string) => setActiveId(id),

    toggle: (key: string) =>
      setExpanded((ex) => {
        const next = new Set(ex);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),

    startRename: (root: string, path: string) => setRenaming({ root, path }),
    cancelRename: () => setRenaming(null),

    newRequest: guard(async (root: string, dir: string) => {
      await flush();
      const name = uniqueName(folderChildren(loaded[root].children, dir), "New Request", ".json");
      const path = joinPath(dir, `${sanitize(name)}.json`);
      await collectionApi.createRequest(root, path, toFile({ ...newRequest(), name }));
      await reload(root);
      expand(root, dir);
      setActiveId(nodeKey(root, path));
      setRenaming({ root, path });
    }),

    newFolder: guard(async (root: string, dir: string) => {
      const name = uniqueName(folderChildren(loaded[root].children, dir), "New Folder", "");
      const path = joinPath(dir, sanitize(name));
      await collectionApi.createFolder(root, path);
      await flush();
      await reload(root);
      expand(root, dir);
      setRenaming({ root, path });
    }),

    duplicate: guard(async (root: string, path: string) => {
      const source = latest.current[nodeKey(root, path)];
      if (!source) return;
      await flush();
      const dir = parentDir(path);
      const name = uniqueName(folderChildren(loaded[root].children, dir), `${source.name} copy`, ".json");
      const copyPath = joinPath(dir, `${sanitize(name)}.json`);
      await collectionApi.createRequest(root, copyPath, toFile({ ...source, name }));
      await reload(root);
      setActiveId(nodeKey(root, copyPath));
    }),

    rename: guard(async (root: string, path: string, newName: string) => {
      setRenaming(null);
      const name = newName.trim();
      if (!name) return;
      await flush();
      if (!path) {
        await collectionApi.rename(root, name);
        await reload(root);
        return;
      }
      const req = latest.current[nodeKey(root, path)];
      const newPath = joinPath(parentDir(path), req ? `${sanitize(name)}.json` : sanitize(name));
      if (newPath !== path) {
        await collectionApi.renameEntry(root, path, newPath);
        remap(root, path, newPath);
      }
      if (req) await collectionApi.writeRequest(root, newPath, toFile({ ...req, name }));
      await reload(root);
    }),

    remove: guard(async (root: string, path: string) => {
      const req = latest.current[nodeKey(root, path)];
      const label = req ? `the request "${req.name}"` : `the folder "${baseName(path)}" and everything in it`;
      if (!(await ask(`Move ${label} to the trash?`, { title: "Delete", kind: "warning" }))) return;
      await flush();
      await collectionApi.deleteEntry(root, path);
      const key = nodeKey(root, path);
      setActiveId((id) => (id === key || id?.startsWith(`${key}/`) ? null : id));
      await reload(root);
    }),

    newCollection: guard(async () => {
      const parent = await open({ directory: true, title: "Choose where to create the collection" });
      if (typeof parent !== "string") return;
      const root = await collectionApi.create(parent, "New Collection");
      await reload(root);
      setRoots((rs) => [...rs, root]);
      expand(root, "");
      setRenaming({ root, path: "" });
    }),

    openCollection: guard(async () => {
      const root = await open({ directory: true, title: "Open a Burno collection" });
      if (typeof root !== "string" || roots.includes(root)) return;
      await reload(root); // fails if the folder has no burno.json
      setRoots((rs) => [...rs, root]);
      expand(root, "");
    }),

    /** Removes the collection from the sidebar; files stay on disk. */
    closeCollection: guard(async (root: string) => {
      await flush();
      const prefix = nodeKey(root, "");
      setRoots((rs) => rs.filter((r) => r !== root));
      setLoaded((l) => {
        const next = { ...l };
        delete next[root];
        return next;
      });
      setRequests((rs) => Object.fromEntries(Object.entries(rs).filter(([id]) => !id.startsWith(prefix))));
      setActiveId((id) => (id?.startsWith(prefix) ? null : id));
    }),
  };

  const active = activeId ? (requests[activeId] ?? null) : null;
  const breadcrumb = (() => {
    if (!activeId) return [];
    const [root, path] = splitKey(activeId);
    return [loaded[root]?.name ?? "", ...path.split("/").slice(0, -1)];
  })();

  return {
    collections: roots.map((r) => loaded[r]).filter(Boolean),
    requests,
    active,
    activeId,
    breadcrumb,
    expanded,
    renaming,
    error,
    clearError: () => setError(null),
    report,
    updateRequest,
    actions,
  };
}

export type CollectionsState = ReturnType<typeof useCollections>;
