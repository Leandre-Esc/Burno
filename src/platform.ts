export const isMac = navigator.userAgent.includes("Mac");

export const sendShortcut = isMac ? "⌘↵" : "Ctrl ↵";
