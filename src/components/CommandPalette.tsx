import { FolderOpen, Globe, Import, Plus, Search, Settings2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CollectionsState, TreeNode } from "../collections";
import type { EnvironmentsState } from "../environments";
import { search, type SearchItem } from "../search";

interface Props {
  collections: CollectionsState;
  envs: EnvironmentsState;
  /** Collection of the open request */
  root: string | null;
  onImport: () => void;
  onManageEnvironments: () => void;
  onClose: () => void;
}

interface Command extends SearchItem {
  icon?: ReactNode;
  run: () => void;
}

export function CommandPalette({ collections, envs, root, onImport, onManageEnvironments, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const { actions, requests } = collections;

  const commands = useMemo(() => {
    const items: Command[] = [];
    if (root) {
      items.push({ key: "new", kind: "action", label: "New request", detail: "In the current collection", icon: <Plus size={15} />, run: () => actions.newRequest(root, "") });
    }
    items.push(
      { key: "import", kind: "action", label: "Import…", detail: "cURL, Postman, Insomnia, OpenAPI", icon: <Import size={15} />, run: onImport },
      { key: "open", kind: "action", label: "Open collection…", icon: <FolderOpen size={15} />, run: actions.openCollection },
      { key: "envs", kind: "action", label: "Manage environments", icon: <Settings2 size={15} />, run: onManageEnvironments },
    );
    if (root) {
      const name = collections.collections.find((c) => c.root === root)?.name;
      for (const env of envs.byRoot[root]?.environments ?? []) {
        items.push({
          key: `env:${env.id}`,
          kind: "environment",
          label: `Use ${env.name}`,
          detail: `Environment of ${name}`,
          icon: <Globe size={15} />,
          run: () => envs.collection.setActive(root, env.id),
        });
      }
    }
    const walk = (nodes: TreeNode[], where: string) => {
      for (const node of nodes) {
        if (node.kind === "folder") {
          walk(node.children, `${where} / ${node.name}`);
          continue;
        }
        const req = requests[node.id];
        if (!req) continue;
        items.push({ key: node.id, kind: "request", label: req.name, method: req.method, detail: where, keywords: req.url, run: () => actions.reveal(node.id) });
      }
    };
    collections.collections.forEach((c) => walk(c.children, c.name));
    return items;
  }, [collections.collections, requests, envs.byRoot, root]);

  const results = useMemo(() => search(commands, query), [commands, query]);
  const current = Math.min(cursor, Math.max(0, results.length - 1));

  useEffect(() => {
    list.current?.querySelector(".palette-item.active")?.scrollIntoView({ block: "nearest" });
  }, [current, results]);

  const run = (command?: Command) => {
    if (!command) return;
    onClose();
    command.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      if (results.length) setCursor((current + step + results.length) % results.length);
    } else if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      run(results[current]);
    } else if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div className="modal-backdrop palette-backdrop" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="palette-input">
          <Search size={16} />
          <input
            autoFocus
            placeholder="Search requests, environments, actions…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
          />
        </div>
        <ul className="palette-list" ref={list}>
          {results.map((c, i) => (
            <li key={c.key} className={`palette-item ${i === current ? "active" : ""}`} onMouseMove={() => setCursor(i)} onClick={() => run(c)}>
              <span className="palette-icon">
                {c.method ? <span className={`method-tag method-${c.method}`}>{c.method === "DELETE" ? "DEL" : c.method === "OPTIONS" ? "OPT" : c.method}</span> : c.icon}
              </span>
              <span className="palette-text">
                <span className="palette-label">{c.label}</span>
                {c.detail && <span className="palette-detail">{c.detail}</span>}
              </span>
            </li>
          ))}
          {!results.length && <li className="hint palette-empty">No match.</li>}
        </ul>
      </div>
    </div>
  );
}
