function lineOffsets(value) {
  const lines = String(value).split("\n")
  const offsets = []
  let offset = 0
  for (const line of lines) {
    offsets.push(offset)
    offset += line.length + 1
  }
  return { lines, offsets }
}

function splitRow(line) {
  const trimmed = line.trim()
  if (!trimmed.includes("|")) return null
  const body = trimmed.replace(/^\|/, "").replace(/\|$/, "")
  const cells = []
  let cell = ""
  let escaped = false
  for (const char of body) {
    if (char === "|" && !escaped) {
      cells.push(cell.trim())
      cell = ""
    } else {
      cell += char
    }
    escaped = char === "\\" && !escaped
    if (char !== "\\") escaped = false
  }
  cells.push(cell.trim())
  return cells
}

function isDelimiter(line) {
  const cells = splitRow(line)
  return !!cells?.length && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, "")))
}

function tableAt(value, selectionStart) {
  const { lines, offsets } = lineOffsets(value)
  const position = Math.max(0, Math.min(Number(selectionStart) || 0, String(value).length))
  let lineIndex = offsets.length - 1
  for (let index = 0; index < offsets.length; index += 1) {
    if (offsets[index] > position) { lineIndex = index - 1; break }
  }

  let start = lineIndex
  while (start > 0 && splitRow(lines[start - 1])) start -= 1
  let end = lineIndex
  while (end + 1 < lines.length && splitRow(lines[end + 1])) end += 1
  if (end - start < 1 || !isDelimiter(lines[start + 1])) return null

  const width = splitRow(lines[start])?.length || 0
  if (!width || splitRow(lines[start + 1])?.length !== width) return null
  const lineOffset = offsets[lineIndex]
  const localPosition = Math.max(0, position - lineOffset)
  const beforeCursor = lines[lineIndex].slice(0, localPosition)
  let column = 0
  let escaped = false
  for (const char of beforeCursor) {
    if (char === "|" && !escaped) column += 1
    escaped = char === "\\" && !escaped
    if (char !== "\\") escaped = false
  }
  if (lines[lineIndex].trimStart().startsWith("|")) column -= 1
  column = Math.max(0, Math.min(column, width - 1))
  return { lines, offsets, start, end, lineIndex, column, width }
}

function renderRow(cells) {
  return `| ${cells.join(" | ")} |`
}

function resultFromLines(table, lines, caretLine, caretColumn) {
  const value = lines.join("\n")
  const { offsets } = lineOffsets(value)
  const line = lines[caretLine] || ""
  let cursor = offsets[caretLine] || 0
  let pipes = line.trimStart().startsWith("|") ? -1 : 0
  let escaped = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === "|" && !escaped) {
      pipes += 1
      if (pipes === caretColumn) { cursor = (offsets[caretLine] || 0) + index + 2; break }
    }
    escaped = char === "\\" && !escaped
    if (char !== "\\") escaped = false
  }
  return { changed: true, value, selectionStart: cursor, selectionEnd: cursor }
}

export function editMarkdownTable(value, selectionStart, action, labels = {}) {
  const table = tableAt(value, selectionStart)
  if (!table) return { changed: false, reason: "not-in-table", value: String(value) }
  const lines = [...table.lines]
  const emptyCell = labels.cell || ""

  if (action === "add-row") {
    const insertAt = Math.max(table.start + 2, table.lineIndex + 1)
    lines.splice(insertAt, 0, renderRow(Array(table.width).fill(emptyCell)))
    return resultFromLines(table, lines, insertAt, table.column)
  }

  if (action === "remove-row") {
    const bodyStart = table.start + 2
    if (table.end < bodyStart) return { changed: false, reason: "minimum-row", value: String(value) }
    const removeAt = table.lineIndex >= bodyStart ? table.lineIndex : table.end
    lines.splice(removeAt, 1)
    const caretLine = Math.max(table.start, Math.min(removeAt, lines.length - 1))
    return resultFromLines(table, lines, caretLine, table.column)
  }

  if (action === "add-column") {
    const insertAt = table.column + 1
    for (let index = table.start; index <= table.end; index += 1) {
      const cells = splitRow(lines[index])
      const content = index === table.start + 1 ? "---" : (index === table.start ? (labels.column || "Column") : emptyCell)
      cells.splice(insertAt, 0, content)
      lines[index] = renderRow(cells)
    }
    return resultFromLines(table, lines, table.lineIndex, insertAt)
  }

  if (action === "remove-column") {
    if (table.width <= 1) return { changed: false, reason: "minimum-column", value: String(value) }
    for (let index = table.start; index <= table.end; index += 1) {
      const cells = splitRow(lines[index])
      cells.splice(table.column, 1)
      lines[index] = renderRow(cells)
    }
    return resultFromLines(table, lines, table.lineIndex, Math.min(table.column, table.width - 2))
  }

  return { changed: false, reason: "unknown-action", value: String(value) }
}
