const WIKI_PREFIX = "wiki"
export const WIKI_ASSET_DIR = "wiki/.attachments"

function pathParts(value) {
  return String(value || "").replace(/\\/g, "/").split("/").filter(Boolean)
}

function decodePart(value) {
  try { return decodeURIComponent(value) } catch { return value }
}

function normalizeParts(parts) {
  const normalized = []
  for (const part of parts) {
    if (!part || part === ".") continue
    if (part === "..") {
      if (!normalized.length) return null
      normalized.pop()
    } else normalized.push(decodePart(part))
  }
  return normalized
}

function encodeReferenceParts(parts) {
  return parts.map((part) => part === ".." ? part : encodeURIComponent(part)).join("/")
}

export function relativeWikiAssetReference(pagePath, assetPath) {
  const page = normalizeParts(pathParts(pagePath))
  const asset = normalizeParts(pathParts(assetPath))
  if (!page || !asset || page[0] !== WIKI_PREFIX || asset.slice(0, 2).join("/") !== WIKI_ASSET_DIR) {
    throw new Error("Invalid wiki asset path")
  }
  const from = page.slice(0, -1)
  let common = 0
  while (common < from.length && common < asset.length && from[common] === asset[common]) common += 1
  return encodeReferenceParts([...Array(from.length - common).fill(".."), ...asset.slice(common)])
}

export function resolveWikiAssetReference(pagePath, reference) {
  let raw = String(reference || "").trim()
  if (raw.startsWith("<") && raw.endsWith(">")) raw = raw.slice(1, -1)
  raw = raw.split(/[?#]/, 1)[0]
  if (!raw || raw.startsWith("/") || raw.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return null

  const page = normalizeParts(pathParts(pagePath))
  const base = page?.[0] === WIKI_PREFIX ? page.slice(0, -1) : [WIKI_PREFIX]
  const referenceParts = pathParts(raw)
  const combined = referenceParts[0] === WIKI_PREFIX ? normalizeParts(referenceParts) : normalizeParts([...base, ...referenceParts])
  if (!combined || combined.slice(0, 2).join("/") !== WIKI_ASSET_DIR || combined.length < 3) return null
  return combined.join("/")
}

export function normalizeImageWidth(value, fallback = 720) {
  const number = Number(value)
  const resolved = Number.isFinite(number) && number > 0 ? number : fallback
  return Math.max(80, Math.min(1600, Math.round(resolved)))
}

function escapeHtmlAttribute(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function escapeMarkdownLabel(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/\]/g, "\\]")
}

export function imageAssetMarkup(reference, alt, width) {
  return `<img src="${escapeHtmlAttribute(reference)}" alt="${escapeHtmlAttribute(alt)}" width="${normalizeImageWidth(width)}">`
}

export function attachmentAssetMarkup(reference, label) {
  return `[${escapeMarkdownLabel(label)}](<${reference}>)`
}

export function wikiAssetFilename(path) {
  const parts = pathParts(path)
  return decodePart(parts[parts.length - 1] || "attachment")
}
