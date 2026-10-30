import type { RequestItem } from "../types";
import logo from "../assets/logo.png";

interface Props {
  requests: RequestItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
}

export function Sidebar({ requests, activeId, onSelect, onAdd, onDelete }: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="logo">
          <img src={logo} alt="" />
          Burno
        </span>
        <button className="icon-btn" onClick={onAdd} title="New request">+</button>
      </div>
      <ul className="request-list">
        {requests.map((r) => (
          <li
            key={r.id}
            className={r.id === activeId ? "active" : ""}
            onClick={() => onSelect(r.id)}
          >
            <span className={`method method-${r.method}`}>{r.method}</span>
            <span className="name">{r.name}</span>
            <button
              className="delete-btn"
              title="Delete"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(r.id);
              }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
