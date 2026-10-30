import { useRef, useState, type ReactNode } from "react";
import logo from "../assets/logo.png";
import { baseName, nodeKey, type Collection, type CollectionsState, type TreeNode } from "../collections";

interface Props {
  state: CollectionsState;
}

function IconButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button className="row-btn" title={title} onClick={onClick}>
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
      style={{ paddingLeft: 8 + depth * 14 }}
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

const Chevron = ({ open }: { open: boolean }) => <span className={`chevron ${open ? "open" : ""}`}>›</span>;

function Nodes({ state, root, nodes, depth }: { state: CollectionsState; root: string; nodes: TreeNode[]; depth: number }) {
  const { actions, renaming } = state;
  const isRenaming = (path: string) => renaming?.root === root && renaming.path === path;

  return (
    <>
      {nodes.map((node) => {
        const rename = (name: string) => actions.rename(root, node.path, name);

        if (node.kind === "folder") {
          const key = nodeKey(root, node.path);
          const open = state.expanded.has(key);
          return (
            <div key={node.path}>
              <Row
                depth={depth}
                onClick={() => actions.toggle(key)}
                onDoubleClick={() => actions.startRename(root, node.path)}
                actions={
                  <>
                    <IconButton title="New request" onClick={() => actions.newRequest(root, node.path)}>+</IconButton>
                    <IconButton title="New folder" onClick={() => actions.newFolder(root, node.path)}>⊞</IconButton>
                    <IconButton title="Rename" onClick={() => actions.startRename(root, node.path)}>✎</IconButton>
                    <IconButton title="Delete" onClick={() => actions.remove(root, node.path)}>×</IconButton>
                  </>
                }
              >
                <Chevron open={open} />
                {isRenaming(node.path) ? (
                  <RenameInput initial={node.name} onSubmit={rename} onCancel={actions.cancelRename} />
                ) : (
                  <span className="name">{node.name}</span>
                )}
              </Row>
              {open && <Nodes state={state} root={root} nodes={node.children} depth={depth + 1} />}
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
                <IconButton title="Duplicate" onClick={() => actions.duplicate(root, node.path)}>⧉</IconButton>
                <IconButton title="Rename" onClick={() => actions.startRename(root, node.path)}>✎</IconButton>
                <IconButton title="Delete" onClick={() => actions.remove(root, node.path)}>×</IconButton>
              </>
            }
          >
            <span className={`method method-${req.method}`}>{req.method}</span>
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

function CollectionRow({ state, collection }: { state: CollectionsState; collection: Collection }) {
  const { actions, renaming } = state;
  const { root } = collection;
  const key = nodeKey(root, "");
  const open = state.expanded.has(key);

  return (
    <div className="collection">
      <Row
        depth={0}
        className="collection-row"
        onClick={() => actions.toggle(key)}
        onDoubleClick={() => actions.startRename(root, "")}
        actions={
          <>
            <IconButton title="New request" onClick={() => actions.newRequest(root, "")}>+</IconButton>
            <IconButton title="New folder" onClick={() => actions.newFolder(root, "")}>⊞</IconButton>
            <IconButton title="Rename" onClick={() => actions.startRename(root, "")}>✎</IconButton>
            <IconButton title="Close collection (files stay on disk)" onClick={() => actions.closeCollection(root)}>⏏</IconButton>
          </>
        }
      >
        <Chevron open={open} />
        {renaming?.root === root && renaming.path === "" ? (
          <RenameInput
            initial={collection.name}
            onSubmit={(name) => actions.rename(root, "", name)}
            onCancel={actions.cancelRename}
          />
        ) : (
          <span className="name" title={root}>{collection.name}</span>
        )}
      </Row>
      {open && <Nodes state={state} root={root} nodes={collection.children} depth={1} />}
      {open && !collection.children.length && <p className="hint tree-empty">Empty collection</p>}
    </div>
  );
}

export function Sidebar({ state }: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="logo">
          <img src={logo} alt="" />
          Burno
        </span>
      </div>
      <div className="sidebar-toolbar">
        <button className="btn small" onClick={state.actions.newCollection}>+ New collection</button>
        <button className="btn small" onClick={state.actions.openCollection}>Open</button>
      </div>
      <div className="tree">
        {state.collections.map((c) => (
          <CollectionRow key={c.root} state={state} collection={c} />
        ))}
        {!state.collections.length && <p className="hint tree-empty">No collection open.</p>}
      </div>
    </aside>
  );
}
