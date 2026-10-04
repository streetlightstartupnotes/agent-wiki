export function wikiPageId(path = "") {
  return String(path)
    .trim()
    .replace(/\\/g, "/")
    .replace(/^wiki\//i, "")
    .replace(/\.md$/i, "")
}

export function normalizeWikiTarget(target = "") {
  return wikiPageId(String(target).split("#", 1)[0]).replace(/^\.\//, "")
}

function pageEntries(pages) {
  return (pages || []).map((page) => ({ page, id: wikiPageId(page?.path) })).filter((entry) => entry.id)
}

function exactPage(entries, target) {
  const normalized = target.toLowerCase()
  return entries.find((entry) => entry.id.toLowerCase() === normalized)?.page || null
}

// Keep browser navigation identical to WikiEngine.resolve_page_id:
// 1. canonical wiki-relative path;
// 2. a bare sibling link relative to the current page;
// 3. a bare basename only when it identifies exactly one page.
// Page titles are display labels, not stable link identifiers.
export function resolveWikiPage(target, pages, fromPath = null) {
  const normalized = normalizeWikiTarget(target)
  if (!normalized) return null
  const entries = pageEntries(pages)

  const exact = exactPage(entries, normalized)
  if (exact) return exact

  if (fromPath && !normalized.includes("/")) {
    const fromId = wikiPageId(fromPath)
    const slash = fromId.lastIndexOf("/")
    const siblingId = slash >= 0 ? `${fromId.slice(0, slash)}/${normalized}` : normalized
    const sibling = exactPage(entries, siblingId)
    if (sibling) return sibling
  }

  const basename = normalized.split("/").pop().toLowerCase()
  const matches = entries.filter((entry) => entry.id.split("/").pop().toLowerCase() === basename)
  return matches.length === 1 ? matches[0].page : null
}
