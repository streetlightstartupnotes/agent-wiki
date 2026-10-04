export const PROJECT_PATH_HEADER = "X-LLM-Wiki-Project-Uri"

export function encodeProjectPathHeader(path = "") {
  const value = String(path || "")
  return value ? encodeURIComponent(value) : ""
}
