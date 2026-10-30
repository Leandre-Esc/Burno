import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface DropdownOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Second line under the label */
  hint?: string;
  /** Extra class on the option and on the trigger when selected (e.g. method colors) */
  className?: string;
  icon?: ReactNode;
}

interface Props<T extends string> {
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  /** Look of the trigger: a regular field, or borderless inside another control */
  variant?: "field" | "ghost";
  className?: string;
  title?: string;
  /** Minimum width of the menu, defaults to the trigger width */
  menuWidth?: number;
}

const GAP = 6;
const MAX_HEIGHT = 320;

/** Hand-made replacement for `<select>`: same keyboard behavior, our own look on every OS. */
export function Dropdown<T extends string>({ value, options, onChange, variant = "field", className = "", title, menuWidth }: Props<T>) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null);
  const typed = useRef({ text: "", at: 0 });

  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));
  const selected = options[selectedIndex];

  const place = () => {
    const r = trigger.current?.getBoundingClientRect();
    if (!r) return;
    const height = Math.min(MAX_HEIGHT, (menu.current?.scrollHeight ?? MAX_HEIGHT) + 2);
    const up = r.bottom + GAP + height > window.innerHeight - 8 && r.top - GAP - height > 8;
    const width = Math.max(r.width, menuWidth ?? 0);
    setPos({ left: Math.min(r.left, window.innerWidth - width - 8), top: up ? r.top - GAP - height : r.bottom + GAP, width, up });
  };

  const show = () => {
    // WebKit (Tauri on macOS) doesn't focus buttons on click: the keyboard needs it
    trigger.current?.focus();
    setActive(selectedIndex);
    setOpen(true);
  };

  const close = (refocus = true) => {
    setOpen(false);
    setPos(null);
    if (refocus) trigger.current?.focus();
  };

  const choose = (i: number) => {
    const option = options[i];
    if (option && option.value !== value) onChange(option.value);
    close();
  };

  // Measure once the menu exists, then follow the trigger while scrolling / resizing
  useLayoutEffect(() => {
    if (open) place();
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!trigger.current?.contains(target) && !menu.current?.contains(target)) close(false);
    };
    const follow = (e: Event) => {
      if (!menu.current?.contains(e.target as Node)) place();
    };
    window.addEventListener("mousedown", outside);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      window.removeEventListener("mousedown", outside);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [open]);

  useEffect(() => {
    if (open) menu.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  /** Jump to the first option starting with what was typed (like a native select) */
  const typeAhead = (key: string) => {
    const now = Date.now();
    typed.current = { text: now - typed.current.at < 600 ? typed.current.text + key : key, at: now };
    const q = typed.current.text.toLowerCase();
    const labelOf = (o: DropdownOption<T>) => (typeof o.label === "string" ? o.label : o.value).toLowerCase();
    const i = options.findIndex((o) => labelOf(o).startsWith(q));
    if (i === -1) return;
    if (open) setActive(i);
    else if (options[i].value !== value) onChange(options[i].value);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const last = options.length - 1;
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        handled();
        const d = e.key === "ArrowDown" ? 1 : -1;
        if (!open) show();
        else setActive((a) => Math.min(last, Math.max(0, a + d)));
        return;
      }
      case "Home":
      case "End":
        if (!open) return;
        handled();
        setActive(e.key === "Home" ? 0 : last);
        return;
      case "Enter":
      case " ":
        if (e.metaKey || e.ctrlKey) return;
        handled();
        if (open) choose(active);
        else show();
        return;
      case "Escape":
        if (!open) return;
        handled();
        close();
        return;
      case "Tab":
        if (open) close(false);
        return;
    }
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      handled();
      typeAhead(e.key);
    }
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`dropdown dropdown-${variant} ${open ? "open" : ""} ${selected?.className ?? ""} ${className}`}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        onClick={() => (open ? close() : show())}
        onKeyDown={onKeyDown}
        onBlur={(e) => {
          if (open && !menu.current?.contains(e.relatedTarget as Node)) close(false);
        }}
      >
        {selected?.icon}
        <span className="dropdown-value">{selected?.label}</span>
        <ChevronDown size={13} className="dropdown-chevron" />
      </button>
      {open &&
        createPortal(
          <ul
            ref={menu}
            id={id}
            role="listbox"
            className={`dropdown-menu ${pos?.up ? "up" : ""}`}
            style={pos ? { left: pos.left, top: pos.top, minWidth: pos.width } : { visibility: "hidden" }}
            // Keep focus on the trigger so the keyboard keeps working
            onMouseDown={(e) => e.preventDefault()}
          >
            {options.map((o, i) => (
              <li
                key={o.value}
                id={`${id}-${i}`}
                role="option"
                aria-selected={o.value === value}
                className={`${i === active ? "active" : ""} ${o.value === value ? "selected" : ""} ${o.className ?? ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(i)}
              >
                {o.icon && <span className="dropdown-icon">{o.icon}</span>}
                <span className="dropdown-text">
                  <span className="dropdown-label">{o.label}</span>
                  {o.hint && <span className="dropdown-hint">{o.hint}</span>}
                </span>
                <Check size={14} className="dropdown-check" />
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </>
  );
}
