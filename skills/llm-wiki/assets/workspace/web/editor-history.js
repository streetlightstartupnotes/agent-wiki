const HISTORY_LIMIT = 100
const INPUT_MERGE_WINDOW = 750

export function createEditorHistory(value = "") {
  return { past: [], present: String(value), future: [], lastKind: null, lastAt: 0 }
}

export function recordEditorValue(history, value, kind = "command", now = Date.now()) {
  const next = String(value)
  if (next === history.present) return history
  const mergeInput = kind === "input" && history.lastKind === "input" && now - history.lastAt <= INPUT_MERGE_WINDOW
  const past = mergeInput ? history.past : [...history.past, history.present].slice(-HISTORY_LIMIT)
  return { past, present: next, future: [], lastKind: kind, lastAt: now }
}

export function undoEditorHistory(history) {
  if (!history.past.length) return history
  const previous = history.past[history.past.length - 1]
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future].slice(0, HISTORY_LIMIT),
    lastKind: null,
    lastAt: 0,
  }
}

export function redoEditorHistory(history) {
  if (!history.future.length) return history
  const next = history.future[0]
  return {
    past: [...history.past, history.present].slice(-HISTORY_LIMIT),
    present: next,
    future: history.future.slice(1),
    lastKind: null,
    lastAt: 0,
  }
}
