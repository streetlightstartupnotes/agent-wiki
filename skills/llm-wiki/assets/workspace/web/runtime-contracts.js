export function projectFromPayload(payload) {
  const candidates = [
    payload?.project,
    payload?.project_info,
    payload?.data?.project,
    payload?.data?.project_info,
    payload,
  ]
  return candidates.find((item) => item && typeof item === "object" && typeof item.path === "string" && item.path.trim()) || null
}

export function sessionFromPayload(payload) {
  const candidates = [payload?.session, payload?.data?.session, payload?.data, payload]
  const session = candidates.find((item) => item && typeof item === "object" && (item.id || item.session_id))
  return session ? { ...session, id: session.id || session.session_id } : null
}

export function workspaceProjectPath({
  showProjectList = false,
  currentPath = null,
  intent = "home",
  sessionProjectPath = null,
  globalPath = null,
  preferredProjectPath = null,
} = {}) {
  if (showProjectList) return null
  if (currentPath) return currentPath
  if (intent === "project") return sessionProjectPath || globalPath || preferredProjectPath || null
  return globalPath || null
}

export function historyMessagesFromEvents(events = []) {
  return (Array.isArray(events) ? events : []).flatMap((event, index) => {
    if (event?.type === "history_user_message" || event?.type === "user_message") {
      const content = String(event.content || "").trim()
      return content ? [{ role: "user", content, key: historyKey(event, index, content) }] : []
    }

    if (event?.type === "assistant_message" || event?.type === "history_assistant_message") {
      const content = String(event.content || "").trim()
      return content ? [{ role: "assistant", content, key: historyKey(event, index, content) }] : []
    }

    if (event?.type === "request_feedback") {
      const context = String(event.context || "").trim()
      const question = String(event.question || event.content || "").trim()
      const options = Array.isArray(event.options) ? event.options.map((option) => String(option || "").trim()).filter(Boolean) : []
      const parts = [context, question, options.length ? options.map((option) => `- ${option}`).join("\n") : ""].filter(Boolean)
      const content = parts.join("\n\n")
      return content ? [{ role: "assistant", content, key: historyKey(event, index, content) }] : []
    }

    return []
  })
}

function historyKey(event, index, content) {
  return `${event?.type || "message"}-${event?.created_at || index}-${content.slice(0, 24)}`
}
