function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value || 0)))
}

// Structural scores can tie in small, densely linked Wikis. Keep the backend
// importance as the main signal, then use type rarity as a generic tie-breaker
// so that overview/anchor pages remain visually distinct from repeated pages.
export function calculateVisualImportance(nodes = []) {
  const typeCounts = new Map()
  nodes.forEach((node) => {
    const type = String(node.type || "unknown")
    typeCounts.set(type, (typeCounts.get(type) || 0) + 1)
  })

  const scored = nodes.map((node) => {
    const type = String(node.type || "unknown")
    const base = clamp01(node.importance)
    const rarity = 1 / Math.sqrt(Math.max(1, typeCounts.get(type) || 1))
    return { id: String(node.id), base, composite: base * .88 + rarity * .12 }
  })
  const values = scored.map((item) => item.composite)
  const minimum = values.length ? Math.min(...values) : 0
  const maximum = values.length ? Math.max(...values) : 0
  const spread = maximum - minimum
  return new Map(scored.map((item) => {
    const relative = spread >= .04 ? (item.composite - minimum) / spread : item.base
    return [item.id, clamp01(item.base * .35 + relative * .65)]
  }))
}

export function graphNodeVisuals(importance) {
  const value = clamp01(importance)
  return {
    size: 4.6 + Math.pow(value, .78) * 6,
    labelSize: 12 + Math.pow(value, .72) * 1.5,
  }
}

export function graphDefaultLabelLimit(nodeCount) {
  const count = Math.max(0, Number(nodeCount || 0))
  if (count <= 2) return count
  return Math.max(2, Math.min(9, Math.round(Math.sqrt(count) * .9)))
}

export function graphLabelAlpha({ attention = false, forceLabel = false, zoomAlpha = 0, floor = 0 }) {
  if (attention) return 1
  return clamp01(forceLabel ? Math.max(floor, zoomAlpha) : zoomAlpha)
}
