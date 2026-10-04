---
name: llm-wiki-capture
description: Save confirmed durable outcomes from the current Codex conversation into its explicitly selected wiki when requested or covered by destination-scoped standing authorization.
---

# LLM Wiki Capture

## Native Codex execution

Read and follow [the shared native execution contract](../llm-wiki/references/native-execution.md) for workspace initialization, explicit destination selection, structured MCP calls and revision-safe persistence. Complete the requested outcome in the current conversation; sending a prompt or adding a task is not completion. Preserve current authorization and Session evidence boundaries.

## Workflow

An explicit “save this decision to this library” request, including the workspace capture button, authorizes that capture. For automatic task-end capture, a visible standing agreement must identify the destination and scope; preserve its exclusions and any later pause. A default library selects a lookup destination, not write permission. Do not infer standing authorization from installing the plugin or opening the panel. If an authorized task produces new durable evidence, finish the capture without requesting the same permission again. No new durable evidence means no write.

Read purpose, schema and related pages. Extract decisions, reasons, dates, corrections, tested results and unresolved work from the visible conversation. Retain superseded facts as dated history where relevant. Exclude hidden reasoning, credentials, wrapper text and unnecessary private identifiers. Do not archive the whole transcript. If there is no new durable evidence, skip writing.

Search and read existing pages first; merge rather than duplicate. Preserve differing accounts and uncertainty. Write full Markdown with current revision and meaningful canonical `[[directory/page]]` links. Record `conversation_captured` via `/activity` with changed paths and actual provenance. Verify the saved pages and report changes and unfinished items. A wiki write does not silently rebuild the session evidence library; use the bundled Rebuilder only within its authorized maintenance scope.

When the conversation has used verified session evidence, retain its actual run ID, relative source document/project key and available claim/event IDs alongside the dated synthesis. Distinguish the old source's assertion from this task's new observation or user correction. The Reader's receipt proves a retrieval context, not that a new claim was human-confirmed. Follow [session integration](../llm-wiki/references/session-memory.md) if generated evidence also needs maintenance; keep that pending state explicit until its review and retrieval gates pass.
