import {
  ChevronRight,
  Copy,
  Folder,
  FolderOpen,
  FolderPlus,
  Library,
  LogOut,
  Moon,
  Pencil,
  Plus,
  Search,
  Sun,
  Volume2,
  VolumeX,
  Trash2,
} from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import logo from "../assets/logo.png";
import { baseName, nodeKey, type Collection, type CollectionsState, type TreeNode } from "../collections";
import { fun } from "../fun";
import type { Theme } from "../storage";
import type { EnvironmentsState } from "../environments";
import type { RequestItem } from "../types";
import type { EnvTab } from "./EnvironmentModal";
import { EnvPicker } from "./EnvPicker";

interface Props {
  state: CollectionsState;
  envs: EnvironmentsState;
  /** Collection whose environments the picker shows */
  envRoot: string | null;
  onManageEnvironments: (tab: EnvTab) => void;
  theme: Theme;
  sounds: boolean;
  onToggleSounds: () => void;
  onToggleTheme: () => void;
}

function IconButton({ title, onClick, danger, children }: { title: string; onClick: () => void; danger?: boolean; children: ReactNode }) {
  return (
    <button className={`row-btn ${danger ? "danger" : ""}`} title={title} onClick={onClick}>
      {children}
    </button>
  );
}

function RenameInput({ initial, onSubmit, onCancel }: { initial: string; onSubmit: (v: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  // Enter submits then unmounts, which can also fire blur: submit only once
  const done = useRef(false);
  const finish = (submit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (submit && value.trim() && value !== initial) onSubmit(value);
    else onCancel();
  };
  return (
    <input
      className="rename-input"
      autoFocus
      value={value}
      onFocus={(e) => e.target.select()}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      }}
      onBlur={() => finish(true)}
    />
  );
}

interface RowProps {
  depth: number;
  active?: boolean;
  className?: string;
  onClick: () => void;
  onDoubleClick?: () => void;
  actions: ReactNode;
  children: ReactNode;
}

function Row({ depth, active, className = "", onClick, onDoubleClick, actions, children }: RowProps) {
  return (
    <div
      className={`tree-row ${className} ${active ? "active" : ""}`}
      style={{ paddingLeft: 6 + depth * 14 }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      {children}
      <span className="row-actions" onClick={(e) => e.stopPropagation()}>
        {actions}
      </span>
    </div>
  );
}

const Chevron = ({ open }: { open: boolean }) => <ChevronRight size={14} className={`chevron ${open ? "open" : ""}`} />;

/** Keeps requests whose name or URL matches, plus the folders leading to them. */
function filterNodes(nodes: TreeNode[], requests: Record<string, RequestItem>, query: string): TreeNode[] {
  return nodes.flatMap((node): TreeNode[] => {
    if (node.kind === "request") {
      const req = requests[node.id];
      const hit = req && (req.name.toLowerCase().includes(query) || req.url.toLowerCase().includes(query));
      return hit ? [node] : [];
    }
    if (node.name.toLowerCase().includes(query)) return [node];
    const children = filterNodes(node.children, requests, query);
    return children.length ? [{ ...node, children }] : [];
  });
}

interface TreeProps {
  state: CollectionsState;
  root: string;
  nodes: TreeNode[];
  depth: number;
  isOpen: (key: string) => boolean;
}

function Nodes({ state, root, nodes, depth, isOpen }: TreeProps) {
  const { actions, renaming } = state;
  const isRenaming = (path: string) => renaming?.root === root && renaming.path === path;

  return (
    <>
      {nodes.map((node) => {
        const rename = (name: string) => actions.rename(root, node.path, name);

        if (node.kind === "folder") {
          const key = nodeKey(root, node.path);
          const open = isOpen(key);
          return (
            <div key={node.path}>
              <Row
                depth={depth}
                onClick={() => actions.toggle(key)}
                onDoubleClick={() => actions.startRename(root, node.path)}
                actions={
                  <>
                    <IconButton title="New request" onClick={() => actions.newRequest(root, node.path)}><Plus size={14} /></IconButton>
                    <IconButton title="New folder" onClick={() => actions.newFolder(root, node.path)}><FolderPlus size={14} /></IconButton>
                    <IconButton title="Rename" onClick={() => actions.startRename(root, node.path)}><Pencil size={13} /></IconButton>
                    <IconButton title="Delete" danger onClick={() => actions.remove(root, node.path)}><Trash2 size={13} /></IconButton>
                  </>
                }
              >
                <Chevron open={open} />
                {open ? <FolderOpen size={15} className="node-icon" /> : <Folder size={15} className="node-icon" />}
                {isRenaming(node.path) ? (
                  <RenameInput initial={node.name} onSubmit={rename} onCancel={actions.cancelRename} />
                ) : (
                  <span className="name">{node.name}</span>
                )}
              </Row>
              {open && <Nodes state={state} root={root} nodes={node.children} depth={depth + 1} isOpen={isOpen} />}
            </div>
          );
        }

        const req = state.requests[node.id];
        if (!req) return null;
        return (
          <Row
            key={node.path}
            depth={depth}
            active={node.id === state.activeId}
            onClick={() => actions.select(node.id)}
            onDoubleClick={() => actions.startRename(root, node.path)}
            actions={
              <>
                <IconButton title="Duplicate" onClick={() => actions.duplicate(root, node.path)}><Copy size={13} /></IconButton>
                <IconButton title="Rename" onClick={() => actions.startRename(root, node.path)}><Pencil size={13} /></IconButton>
                <IconButton title="Delete" danger onClick={() => actions.remove(root, node.path)}><Trash2 size={13} /></IconButton>
              </>
            }
          >
            <span className={`method-tag method-${req.method}`}>{req.method === "DELETE" ? "DEL" : req.method === "OPTIONS" ? "OPT" : req.method}</span>
            {isRenaming(node.path) ? (
              <RenameInput initial={req.name} onSubmit={rename} onCancel={actions.cancelRename} />
            ) : (
              <span className="name" title={baseName(node.path)}>{req.name}</span>
            )}
          </Row>
        );
      })}
    </>
  );
}

function CollectionRow({ state, collection, isOpen }: { state: CollectionsState; collection: Collection; isOpen: (key: string) => boolean }) {
  const { actions, renaming } = state;
  const { root } = collection;
  const key = nodeKey(root, "");
  const open = isOpen(key);
  const emptyLine = useMemo(fun.emptyCollection, []);

  return (
    <div className="collection">
      <Row
        depth={0}
        className="collection-row"
        onClick={() => actions.toggle(key)}
        onDoubleClick={() => actions.startRename(root, "")}
        actions={
          <>
            <IconButton title="New request" onClick={() => actions.newRequest(root, "")}><Plus size={14} /></IconButton>
            <IconButton title="New folder" onClick={() => actions.newFolder(root, "")}><FolderPlus size={14} /></IconButton>
            <IconButton title="Rename" onClick={() => actions.startRename(root, "")}><Pencil size={13} /></IconButton>
            <IconButton title="Close collection (files stay on disk)" onClick={() => actions.closeCollection(root)}><LogOut size={13} /></IconButton>
          </>
        }
      >
        <Chevron open={open} />
        <Library size={15} className="node-icon" />
        {renaming?.root === root && renaming.path === "" ? (
          <RenameInput initial={collection.name} onSubmit={(name) => actions.rename(root, "", name)} onCancel={actions.cancelRename} />
        ) : (
          <span className="name" title={root}>{collection.name}</span>
        )}
      </Row>
      {open && <Nodes state={state} root={root} nodes={collection.children} depth={1} isOpen={isOpen} />}
      {open && !collection.children.length && <p className="hint tree-empty">{emptyLine}</p>}
    </div>
  );
}

export function Sidebar({ state, envs, envRoot, onManageEnvironments, theme, onToggleTheme, sounds, onToggleSounds }: Props) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const collections = q
    ? state.collections
        .map((c) => ({ ...c, children: filterNodes(c.children, state.requests, q) }))
        .filter((c) => c.children.length)
    : state.collections;
  // While searching, show every match unfolded
  const isOpen = (key: string) => q !== "" || state.expanded.has(key);

  return (
    <aside className="sidebar">
      <div className="sidebar-header" data-tauri-drag-region>
        <div className="brand-logo">
          <img src={logo} alt="" />
        </div>
        <div data-tauri-drag-region>
          <div className="brand-name">Burno</div>
          <div className="brand-tagline">{fun.tagline}</div>
        </div>
      </div>

      <div className="search">
        <Search size={14} />
        <input className="input" placeholder="Search requests" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <div className="section-title">
        <span>Collections</span>
        <span className="section-actions">
          <button className="icon-btn" title="New collection" onClick={state.actions.newCollection}><Plus size={15} /></button>
          <button className="icon-btn" title="Open collection" onClick={state.actions.openCollection}><FolderOpen size={15} /></button>
        </span>
      </div>

      <div className="tree">
        {collections.map((c) => (
          <CollectionRow key={c.root} state={state} collection={c} isOpen={isOpen} />
        ))}
        {!collections.length && <p className="hint tree-empty">{q ? "No match." : "No collection open."}</p>}
      </div>

      <div className="sidebar-footer">
        <EnvPicker
          envs={envs}
          root={envRoot}
          collectionName={state.collections.find((c) => c.root === envRoot)?.name ?? null}
          onManage={onManageEnvironments}
        />
        <button className="icon-btn" title={sounds ? "Mute sounds" : "Turn sounds on"} onClick={onToggleSounds}>
          {sounds ? <Volume2 size={16} /> : <VolumeX size={16} />}
        </button>
        <button className="icon-btn" title={theme === "dark" ? "Light mode" : "Dark mode"} onClick={onToggleTheme}>
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </aside>
  );
}
