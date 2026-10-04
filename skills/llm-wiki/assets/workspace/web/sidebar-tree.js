// The type row is level one in the rendered tree. Three actual page levels
// therefore occupy levels two through four.
export const MAX_SIDEBAR_CONTENT_LEVELS = 3
export const MAX_SIDEBAR_LEVELS = MAX_SIDEBAR_CONTENT_LEVELS + 1
export const SIDEBAR_ROOT_PARENT = "__root__"

function pageStem(path = "") {
  return String(path).replace(/\\/g, "/").replace(/^wiki\//, "").replace(/\.md$/i, "")
}

function pathParts(path = "") {
  return pageStem(path).split("/").filter(Boolean)
}

function normalized(value = "") {
  return String(value).normalize("NFKC").toLocaleLowerCase()
}

function humanize(value = "") {
  return String(value).replace(/[-_]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase())
}

function pageTitle(page = {}) {
  return page.title || String(page.name || page.path || "").split("/").pop()?.replace(/\.md$/i, "") || "Untitled"
}

function directoryKey(parts = []) {
  return parts.join("/")
}

function pageType(page = {}) {
  return String(page.type || "other")
}

function makeDirectory(name, fullParts, order) {
  return {
    name,
    fullParts,
    order,
    indexPage: null,
    files: [],
    directories: new Map(),
  }
}

function visibleLevel(nodes, level = 2) {
  return nodes.map((node) => ({
    ...node,
    level,
    children: visibleLevel(node.children || [], level + 1),
  }))
}

function orderTreeChildren(nodes, type, sidebarOrder, parentKey = SIDEBAR_ROOT_PARENT) {
  const saved = Array.isArray(sidebarOrder?.parents?.[type]?.[parentKey]) ? sidebarOrder.parents[type][parentKey] : []
  const positions = new Map(saved.map((path, index) => [path, index]))
  return [...nodes]
    .sort((left, right) => {
      const leftPosition = positions.has(left.page?.path) ? positions.get(left.page.path) : Number.MAX_SAFE_INTEGER
      const rightPosition = positions.has(right.page?.path) ? positions.get(right.page.path) : Number.MAX_SAFE_INTEGER
      return leftPosition - rightPosition
    })
    .map((node) => ({
      ...node,
      children: orderTreeChildren(node.children || [], type, sidebarOrder, node.page?.path || node.key),
    }))
}

function buildTypeTree(items, type, sidebarOrder = {}) {
  const baseDirectory = typePageDirectory(items, type)
  const baseParts = pathParts(baseDirectory)
  const canStripBase = baseParts.length > 0 && items.every((page) => {
    const parts = pathParts(page.path)
    return parts.length > baseParts.length && baseParts.every((part, index) => normalized(parts[index]) === normalized(part))
  })
  const root = makeDirectory("", canStripBase ? baseParts : [], 0)

  items.forEach((page, order) => {
    const originalParts = pathParts(page.path)
    const parts = canStripBase ? originalParts.slice(baseParts.length) : originalParts
    if (!parts.length) return
    let directory = root
    for (const name of parts.slice(0, -1)) {
      const lookup = normalized(name)
      if (!directory.directories.has(lookup)) {
        directory.directories.set(lookup, makeDirectory(name, [...directory.fullParts, name], order))
      }
      directory = directory.directories.get(lookup)
      directory.order = Math.min(directory.order, order)
    }
    const filename = parts[parts.length - 1]
    if (normalized(filename) === "index") {
      directory.indexPage ||= { page, order }
      directory.order = Math.min(directory.order, order)
    } else {
      directory.files.push({ page, name: filename, order })
      directory.order = Math.min(directory.order, order)
    }
  })

  function childrenOf(directory, includeOwnIndex = false) {
    const rows = []
    if (includeOwnIndex && directory.indexPage) {
      const index = directory.indexPage
      rows.push({
        key: index.page.path,
        kind: "page",
        type,
        title: pageTitle(index.page),
        page: index.page,
        directory: directoryKey(directory.fullParts),
        children: [],
        order: index.order,
      })
    }

    const companionByName = new Map(directory.files.map((file) => [normalized(file.name), file]))
    const usedCompanions = new Set()

    for (const childDirectory of directory.directories.values()) {
      const companion = companionByName.get(normalized(childDirectory.name))
      if (companion) usedCompanions.add(companion)
      const childRows = childrenOf(childDirectory, Boolean(companion))
      const landing = companion?.page || childDirectory.indexPage?.page || null
      const explicitCategory = normalized(companion?.page?.kind) === "category"
      rows.push({
        key: companion?.page.path || childDirectory.indexPage?.page.path || `dir:${type}:wiki/${directoryKey(childDirectory.fullParts)}`,
        kind: companion && !explicitCategory ? "page" : "category",
        type,
        title: landing ? pageTitle(landing) : humanize(childDirectory.name),
        page: landing,
        directory: directoryKey(childDirectory.fullParts),
        children: childRows,
        order: Math.min(companion?.order ?? Infinity, childDirectory.order),
      })
    }

    for (const file of directory.files) {
      if (usedCompanions.has(file)) continue
      const explicitCategory = normalized(file.page.kind) === "category"
      rows.push({
        key: file.page.path,
        kind: explicitCategory ? "category" : "page",
        type,
        title: pageTitle(file.page),
        page: file.page,
        directory: explicitCategory ? pageStem(file.page.path) : directoryKey(directory.fullParts),
        children: [],
        order: file.order,
      })
    }

    return rows
      .sort((left, right) => left.order - right.order || left.title.localeCompare(right.title))
      .map(({ order, ...node }) => node)
  }

  return visibleLevel(orderTreeChildren(childrenOf(root, true), type, sidebarOrder))
}

export function buildSidebarTree(items = [], requestedType = "", sidebarOrder = {}) {
  const groups = new Map()
  for (const page of items) {
    const type = requestedType || pageType(page)
    if (requestedType && pageType(page) !== requestedType) continue
    if (!groups.has(type)) groups.set(type, [])
    groups.get(type).push(page)
  }
  return [...groups.entries()].flatMap(([type, pages]) => buildTypeTree(pages, type, sidebarOrder))
}

export function filterSidebarTree(nodes = [], query = "") {
  const search = String(query).trim().toLocaleLowerCase()
  if (!search) return nodes

  return nodes.flatMap((node) => {
    const children = filterSidebarTree(node.children || [], search)
    const haystack = `${node.title || ""} ${node.page?.path || ""} ${node.directory || ""}`.toLocaleLowerCase()
    return haystack.includes(search) || children.length ? [{ ...node, children }] : []
  })
}

export function limitSidebarTree(nodes = [], limit = Infinity) {
  let remaining = Math.max(0, Number(limit) || 0)

  function visit(items) {
    const result = []
    for (const node of items) {
      const cost = node.page ? 1 : 0
      if (cost && remaining <= 0) break
      remaining -= cost
      result.push({ ...node, children: visit(node.children || []) })
    }
    return result
  }

  return visit(nodes)
}

export function sidebarTreeSize(nodes = []) {
  return nodes.reduce((count, node) => count + 1 + sidebarTreeSize(node.children || []), 0)
}

export function sidebarTreeDocumentCount(nodes = []) {
  return nodes.reduce((count, node) => count + (node.page ? 1 : 0) + sidebarTreeDocumentCount(node.children || []), 0)
}

export function sidebarDisplayDepth(node, parentLevel = 1) {
  const level = Number(node?.level || Number(parentLevel) + 1)
  return Math.max(0, Math.min(level, MAX_SIDEBAR_LEVELS) - 2)
}

export function sidebarLogicalPathKey(path = "") {
  const parts = pathParts(path)
  if (normalized(parts[parts.length - 1]) === "index") parts.pop()
  return normalized(parts.join("/"))
}

export function hasSidebarLogicalPathConflict(items = [], candidatePath = "") {
  const candidate = sidebarLogicalPathKey(candidatePath)
  return Boolean(candidate) && items.some((item) => sidebarLogicalPathKey(item?.path) === candidate)
}

export function sidebarPageAncestors(path = "", items = []) {
  const page = items.find((item) => item.path === path)
  if (!page) return []
  const tree = buildSidebarTree(items.filter((item) => pageType(item) === pageType(page)), pageType(page))
  let result = []

  function find(nodes, ancestors) {
    for (const node of nodes) {
      if (node.page?.path === path) {
        result = ancestors
        return true
      }
      if (find(node.children || [], [...ancestors, node.key])) return true
    }
    return false
  }

  find(tree, [])
  return result
}

export function typePageDirectory(items = [], type = "") {
  const pages = items.filter((page) => !type || pageType(page) === type)
  if (!pages.length) return String(type || "other")
  const paths = pages.map((page) => pathParts(page.path))
  if (paths.every((parts) => parts.length > 1)) {
    const root = paths[0][0]
    if (paths.every((parts) => normalized(parts[0]) === normalized(root))) return root
  }
  return ""
}

export function childPageDirectory(parent = "") {
  if (parent && typeof parent === "object") {
    if (parent.kind === "category" && parent.directory) return parent.directory
    if (parent.page?.path) return childPageDirectory(parent.page.path)
    if (parent.directory) return parent.directory
  }
  const stem = pageStem(parent)
  return normalized(stem.split("/").pop()) === "index" ? stem.split("/").slice(0, -1).join("/") : stem
}

export function canCreateSidebarChild(node, parentLevel = 1) {
  const level = Number(node?.level || Number(parentLevel) + 1)
  return level < MAX_SIDEBAR_LEVELS
}
