export const isMac = navigator.userAgent.includes("Mac");

export const sendShortcut = isMac ? "⌘↵" : "Ctrl ↵";
export const searchShortcut = isMac ? "⌘K" : "Ctrl K";
