import { marked } from "marked"
import { wikiPageId } from "./wiki-link-resolver.js"

export const DEFAULT_WORKSPACE_STATE = Object.freeze({
  version: 2, tabs: Object.freeze([]), activePath: null,
  leftVisible: true, rightVisible: false, leftWidth: 244, rightWidth: 280,
  inspectorTab: "outline",
})
const STORAGE_PREFIX = "llm-wiki:workspace:v1:"
const MAX_STATE_BYTES = 1024 * 1024

export function validWorkspacePagePath(value) {
  if (typeof value !== "string" || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) return null
  const path = value.replace(/\\/g, "/")
  if (!path.startsWith("wiki/") || !/\.md$/i.test(path) || path.split("/").some(part => !part || part === "." || part === "..")) return null
  return path
}

function width(value, fallback, minimum) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(Math.min(480, Math.max(minimum, value))) : fallback
}

/** Stores paths and panel preferences only; never document text or unsaved drafts. */
export function normalizeWorkspaceState(value, { availablePaths } = {}) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {}
  const available = Array.isArray(availablePaths) ? new Set(availablePaths.map(validWorkspacePagePath).filter(Boolean)) : null
  const tabs = [...new Set((Array.isArray(input.tabs) ? input.tabs : []).map(validWorkspacePagePath).filter(path => path && (!available || available.has(path))))]
  const selected = validWorkspacePagePath(input.activePath)
  const activePath = tabs.includes(selected) ? selected : tabs[0] || null
  return {
    version: 2, tabs, activePath,
    leftVisible: typeof input.leftVisible === "boolean" ? input.leftVisible : true,
    rightVisible: input.version===2 && typeof input.rightVisible === "boolean" ? input.rightVisible : false,
    leftWidth: width(input.leftWidth, 244, 200), rightWidth: width(input.rightWidth, 280, 220),
    inspectorTab: input.inspectorTab === "links" ? "links" : "outline",
  }
}

export function workspaceStorageKey(wikiPath) {
  if (typeof wikiPath !== "string" || !wikiPath.trim() || wikiPath.length > 4096 || /[\u0000-\u001f\u007f]/.test(wikiPath)) return null
  return STORAGE_PREFIX + encodeURIComponent(wikiPath.trim().replace(/\\/g, "/").replace(/\/+$/, ""))
}
function storageOrDefault(storage) {
  if (storage !== undefined) return storage
  try { return globalThis.localStorage } catch { return null }
}
export function loadWorkspaceState(wikiPath, { storage, availablePaths } = {}) {
  const fallback = () => normalizeWorkspaceState(null, { availablePaths })
  const key = workspaceStorageKey(wikiPath)
  if (!key) return fallback()
  try {
    const raw = storageOrDefault(storage)?.getItem(key)
    if (!raw || raw.length > MAX_STATE_BYTES) return fallback()
    const input = JSON.parse(raw)
    if (![1, 2].includes(input?.version)) return fallback()
    return normalizeWorkspaceState(input, { availablePaths })
  } catch { return fallback() }
}
export function saveWorkspaceState(wikiPath, value, { storage } = {}) {
  const key = workspaceStorageKey(wikiPath)
  if (!key) return false
  try {
    const target = storageOrDefault(storage)
    if (!target?.setItem) return false
    const raw = JSON.stringify(normalizeWorkspaceState(value))
    if (raw.length > MAX_STATE_BYTES) return false
    target.setItem(key, raw)
    return true
  } catch { return false }
}
/** Parent must obtain approval to leave/close a dirty editor before applying these transitions. */
export function openWorkspaceTab(value, candidate) {
  const state = normalizeWorkspaceState(value), path = validWorkspacePagePath(candidate)
  return path ? { ...state, tabs: state.tabs.includes(path) ? state.tabs : [...state.tabs, path], activePath: path } : state
}
export function closeWorkspaceTab(value, path) {
  const state = normalizeWorkspaceState(value)
  const index = state.tabs.indexOf(path)
  if (index < 0) return state
  const tabs = state.tabs.filter(item => item !== path)
  return { ...state, tabs, activePath: state.activePath === path ? tabs[Math.min(index, tabs.length - 1)] || null : state.activePath }
}
export function workspacePageTitle(page) {
  if (typeof page === "string") return page.split("/").pop().replace(/\.md$/i, "")
  return String(page?.frontmatter?.title || page?.title || page?.path?.split("/").pop()?.replace(/\.md$/i, "") || "")
}

const normalizedSearch = text => String(text || "").normalize("NFKC").toLocaleLowerCase().trim()
export function filterPaletteItems({ mode = "pages", pages = [], commands = [], query = "", limit = 100 } = {}) {
  const seen = new Set()
  const candidates = mode === "commands" ? (Array.isArray(commands) ? commands : []).flatMap(command => {
    if (!command || typeof command.id !== "string" || !command.id || seen.has(command.id)) return []
    seen.add(command.id)
    return [{ id: `command:${command.id}`, kind: "command", label: String(command.label || command.title || command.id), detail: String(command.description || ""), keywords: command.keywords || [], shortcut: command.shortcut || "", disabled: Boolean(command.disabled), command }]
  }) : (Array.isArray(pages) ? pages : []).flatMap(page => {
    const path = validWorkspacePagePath(typeof page === "string" ? page : page?.path)
    if (!path || seen.has(path)) return []
    seen.add(path)
    return [{ id: `page:${path}`, kind: "page", label: workspacePageTitle(page), detail: path.replace(/^wiki\//, ""), path, page, disabled: false }]
  })
  const needle = normalizedSearch(query), parts = needle.split(/\s+/).filter(Boolean)
  return candidates.map((item, index) => {
    const label = normalizedSearch(item.label), detail = normalizedSearch(item.detail)
    const haystack = `${label} ${detail} ${normalizedSearch(Array.isArray(item.keywords) ? item.keywords.join(" ") : item.keywords)}`
    const match = parts.every(part => haystack.includes(part))
    const score = !needle ? 0 : label === needle ? 3 : label.startsWith(needle) ? 2 : label.includes(needle) ? 1 : 0
    return { item, index, match, score }
  }).filter(item => item.match).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, Math.max(1, Math.min(1000, Number(limit) || 100))).map(({ item }) => item)
}
export function nextPaletteIndex(items, current, direction) {
  if (!items.length || items.every(item => item.disabled)) return -1
  const step = direction < 0 ? -1 : 1
  let index = current >= 0 && current < items.length ? current : step > 0 ? -1 : 0
  for (let count = 0; count < items.length; count++) {
    index = (index + step + items.length) % items.length
    if (!items[index].disabled) return index
  }
  return -1
}

function decodeEntities(text) {
  return text.replace(/&(?:amp|lt|gt|quot|apos|#39|#\d+|#x[\da-f]+);/gi, entity => {
    const named = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#39;": "'" }
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()]
    const number = entity.slice(2, -1), code = parseInt(number.replace(/^x/i, ""), /^x/i.test(number) ? 16 : 10)
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "�"
  })
}
function inlineText(tokens, fallback = "") {
  if (!Array.isArray(tokens)) return decodeEntities(fallback.replace(/<[^>]*>/g, ""))
  return tokens.map(token => token.type === "html" ? "" : token.tokens ? inlineText(token.tokens) : decodeEntities(String(token.text || ""))).join("")
}
/** Heading index follows Markdown heading order. No invented DOM anchors. */
export function extractMarkdownHeadings(markdown = "") {
  const original = String(markdown || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n")
  const frontmatter = original.match(/^---\n[\s\S]*?\n(?:---|\.\.\.)\n?/)?.[0] || ""
  const source = (frontmatter ? frontmatter.replace(/[^\n]/g, " ") + original.slice(frontmatter.length) : original)
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => label || target)
  const result = []
  function visit(tokens, from = 0) {
    let cursor = from
    for (const token of tokens || []) {
      const offset = token.raw ? source.indexOf(token.raw, cursor) : -1
      const start = offset < 0 ? cursor : offset
      if (token.type === "heading") {
        result.push({ key: `heading-${result.length}`, index: result.length, level: token.depth, text: inlineText(token.tokens, token.text).trim(), line: offset < 0 ? null : source.slice(0, offset).split("\n").length })
      } else if (token.type === "list") {
        for (const item of token.items || []) visit(item.tokens, start)
      } else if (token.type === "blockquote") visit(token.tokens, start)
      if (offset >= 0) cursor = start + token.raw.length
    }
  }
  visit(marked.lexer(source, { gfm: true }))
  return result
}

/** Graph.build's real edge contract: reciprocal links are stored once with bidirectional:true. */
export function workspacePageConnections(page, graph, pages = []) {
  const available = Boolean(graph && Array.isArray(graph.nodes) && Array.isArray(graph.edges))
  const nodeById = new Map((available ? graph.nodes : []).filter(node => node && typeof node.id === "string" && node.id).map(node => [node.id, node]))
  const current = [...nodeById.values()].find(node => node.path === page?.path) || nodeById.get(wikiPageId(page?.path || ""))
  const currentId = current ? String(current.id) : wikiPageId(page?.path || "")
  const pageById = new Map((Array.isArray(pages) ? pages : []).filter(item => item?.path).map(item => [wikiPageId(item.path), item]))
  const incoming = new Map(), outgoing = new Map()
  function add(target, id, edge) {
    if (id === currentId || target.has(id)) return
    const node = nodeById.get(id), entry = pageById.get(id)
    const path = validWorkspacePagePath(node?.path || entry?.path)
    target.set(id, { id, path, title: String(node?.title || workspacePageTitle(entry) || id), label: String(edge.label || ""), bidirectional: edge.bidirectional === true })
  }
  if (available && currentId) for (const edge of graph.edges) {
    // source/target are canonical page IDs from Graph.build, not display titles.
    if (!edge || typeof edge.source !== "string" || typeof edge.target !== "string" || !edge.source || !edge.target) continue
    const source = String(edge.source), target = String(edge.target)
    if (source === currentId) { add(outgoing, target, edge); if (edge.bidirectional === true) add(incoming, target, edge) }
    if (target === currentId) { add(incoming, source, edge); if (edge.bidirectional === true) add(outgoing, source, edge) }
  }
  const rawSources = page?.frontmatter?.sources ?? current?.sources ?? []
  const sources = [...new Set((Array.isArray(rawSources) ? rawSources : [rawSources]).filter(value => typeof value === "string" && value.trim()).map(value => value.trim()))]
  return { available, indexed: Boolean(current), incoming: [...incoming.values()], outgoing: [...outgoing.values()], sources }
}
