function lineBounds(value, start, end = start) {
  const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1
  const trailingBreak = value.indexOf("\n", end)
  const lineEnd = trailingBreak < 0 ? value.length : trailingBreak
  return { lineStart, lineEnd }
}

export function wrapMarkdownSelection(value, start, end, before, after = before) {
  const selected = value.slice(start, end)
  const text = `${before}${selected}${after}`
  return {
    value: value.slice(0, start) + text + value.slice(end),
    selectionStart: start + before.length,
    selectionEnd: start + before.length + selected.length,
  }
}

export function prefixMarkdownLines(value, start, end, prefix) {
  if (start === end) {
    const { lineStart } = lineBounds(value, start)
    const marker = typeof prefix === "function" ? prefix(0) : prefix
    return {
      value: value.slice(0, lineStart) + marker + value.slice(lineStart),
      selectionStart: start + marker.length,
      selectionEnd: start + marker.length,
    }
  }
  const { lineStart, lineEnd } = lineBounds(value, start, end)
  const block = value.slice(lineStart, lineEnd)
  let offset = 0
  const text = block.split("\n").map((line, index) => {
    const marker = typeof prefix === "function" ? prefix(index) : prefix
    if (index === 0) offset = marker.length
    return `${marker}${line}`
  }).join("\n")
  return {
    value: value.slice(0, lineStart) + text + value.slice(lineEnd),
    selectionStart: start + offset,
    selectionEnd: lineStart + text.length,
  }
}

export function continueMarkdownList(value, start, end = start) {
  if (start !== end) return null
  const { lineStart } = lineBounds(value, start)
  const beforeCaret = value.slice(lineStart, start)
  const match = beforeCaret.match(/^(\s*)(?:(\d+)\.|([-+*]))\s+(\[[ xX]\]\s+)?(.*)$/)
  if (!match) return null
  const [, indent, ordered, bullet, task = "", body] = match
  if (!body.trim()) {
    return {
      value: value.slice(0, lineStart) + value.slice(start),
      selectionStart: lineStart,
      selectionEnd: lineStart,
    }
  }
  const marker = ordered ? `${Number(ordered) + 1}.` : bullet
  const continuation = `\n${indent}${marker} ${task ? "[ ] " : ""}`
  return {
    value: value.slice(0, start) + continuation + value.slice(end),
    selectionStart: start + continuation.length,
    selectionEnd: start + continuation.length,
  }
}

export function indentMarkdownLines(value, start, end, outdent = false) {
  const { lineStart, lineEnd } = lineBounds(value, start, end)
  const block = value.slice(lineStart, lineEnd)
  const lines = block.split("\n")
  let firstDelta = 0
  let totalDelta = 0
  const text = lines.map((line, index) => {
    if (!outdent) {
      if (index === 0) firstDelta = 4
      totalDelta += 4
      return `    ${line}`
    }
    const match = line.match(/^( {1,4}|\t)/)
    const removed = match?.[0].length || 0
    if (index === 0) firstDelta = -removed
    totalDelta -= removed
    return line.slice(removed)
  }).join("\n")
  return {
    value: value.slice(0, lineStart) + text + value.slice(lineEnd),
    selectionStart: Math.max(lineStart, start + firstDelta),
    selectionEnd: Math.max(lineStart, end + totalDelta),
  }
}
