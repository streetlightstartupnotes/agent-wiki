export const HOST_SHORTCUTS = Object.freeze({
  openWiki: Object.freeze({
    key: "k",
    code: "KeyK",
    keyLabel: "K",
    aria: "Meta+Shift+K Control+Shift+K",
  }),
  captureConversation: Object.freeze({
    key: "m",
    code: "KeyM",
    keyLabel: "M",
    aria: "Meta+Shift+M Control+Shift+M",
  }),
})

export function hostShortcutLabel(action, platform = "") {
  const shortcut = HOST_SHORTCUTS[action]
  if (!shortcut) return ""
  return /mac/i.test(String(platform || "")) ? `⌘⇧${shortcut.keyLabel}` : `Ctrl+Shift+${shortcut.keyLabel}`
}

export function matchesHostShortcut(event, action) {
  const shortcut = HOST_SHORTCUTS[action]
  if (!shortcut || !event || event.defaultPrevented || event.repeat || event.isComposing) return false
  if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey) return false
  const key = String(event.key || "").toLowerCase()
  return key === shortcut.key || String(event.code || "") === shortcut.code
}

export function isEditableShortcutTarget(target) {
  if (!target || typeof target !== "object") return false
  if (target.isContentEditable === true) return true
  const tag = String(target.tagName || "").toLowerCase()
  if (["input", "textarea", "select"].includes(tag)) return true
  if (typeof target.closest !== "function") return false
  return Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'))
}
