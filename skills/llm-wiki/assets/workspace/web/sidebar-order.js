export function sortSidebarItems(items = [], type, order = {}) {
  const saved = Array.isArray(order?.types?.[type]) ? order.types[type] : []
  const positions = new Map(saved.map((path, index) => [path, index]))
  return [...items].sort((left, right) => {
    const leftPosition = positions.has(left.path) ? positions.get(left.path) : Number.MAX_SAFE_INTEGER
    const rightPosition = positions.has(right.path) ? positions.get(right.path) : Number.MAX_SAFE_INTEGER
    if (leftPosition !== rightPosition) return leftPosition - rightPosition
    return String(left.title || left.path).localeCompare(String(right.title || right.path), "zh-CN", { numeric: true })
  })
}

// Index is calculated after removing the dragged page, matching the backend's
// atomic reorder contract.
export function sidebarDropIndex(items = [], movedPath, targetPath = null, position = "end") {
  const paths = items.map((item) => item.path).filter((path) => path !== movedPath)
  if (!targetPath) return paths.length
  const targetIndex = paths.indexOf(targetPath)
  if (targetIndex < 0) return paths.length
  return targetIndex + (position === "after" ? 1 : 0)
}
