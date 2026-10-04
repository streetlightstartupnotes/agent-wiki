---
name: llm-wiki-global
description: Use an explicitly selected default LLM Wiki across Codex conversations for requested wiki work or a genuinely missing historical fact. Respect paused lookup and do not turn ordinary tasks into personal-history searches.
---

# LLM Wiki Global

## Native Codex execution

Read and follow [the shared native execution contract](../llm-wiki/references/native-execution.md) for workspace initialization, explicit destination selection, structured MCP calls and revision-safe persistence. Complete the requested outcome in the current conversation; sending a prompt or adding a task is not completion. Preserve current authorization and Session evidence boundaries.

## Workflow

Read `/global-project`. Explicit conversation selection takes priority. Automatic lookup requires active global lookup and a relevant missing fact; a manual request may use a paused selected library. Search `/search`, then read complete matching pages. Cite wiki path, original source and relevant date. Use `wiki_recall` when verified linked session evidence is needed; stop on failed Reader gates. Sufficient conversation context means no history reads.

Write only under the current task or destination-scoped standing permission. Read revisions, preserve unrelated text, record `/activity`, and verify. Selecting a default library is not permission to scan all private sessions or schedule background work.
