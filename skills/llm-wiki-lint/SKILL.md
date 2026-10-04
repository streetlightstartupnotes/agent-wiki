---
name: llm-wiki-lint
description: Check the selected LLM Wiki for broken links, orphan pages, missing outgoing links and inconsistent knowledge structure.
---

# LLM Wiki Lint

## Native Codex execution

Read and follow [the shared native execution contract](../llm-wiki/references/native-execution.md) for workspace initialization, explicit destination selection, structured MCP calls and revision-safe persistence. Complete the requested outcome in the current conversation; sending a prompt or adding a task is not completion. Preserve current authorization and Session evidence boundaries.

## Workflow

Call `/lint`, `/review` and, when useful, `/graph/insights`. Distinguish structural errors from suggestions: an isolated or unlinked page may be intentional. Show affected paths and evidence. Checking is read-only. Under an explicit repair request, inspect source and target pages before edits, resolve ambiguous identities with the user, preserve content, and rerun affected checks. Do not make links merely to increase graph density.

`/lint` returns `results`; `/review` returns `items`. A lint path is relative to `wiki/`, while `/wiki/page` needs `wiki/<path>`. Open each affected full page before fixing a suggested target. Lint does not validate factual truth or Session publication gates.

When the user requests action on a review item, `/review/resolve` accepts `{id,action}`. `dismiss` records a dismissal; `research` records `researching` but does not execute a model. Continue the research workflow in this same conversation. `accept`/`complete` marks the item completed; use it only after the requested review or corrective work actually finishes. A successful status update alone is not proof that a source was verified or a page was repaired. Preserve pending/researching status on partial work and state what remains.
