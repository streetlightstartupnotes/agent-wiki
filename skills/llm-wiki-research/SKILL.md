---
name: llm-wiki-research
description: Research a topic with Codex native web search, synthesize multiple sources, and save a cited page into the current conversation-selected or user-selected global LLM Wiki.
---

# LLM Wiki Research

## Native Codex execution

Read and follow [the shared native execution contract](../llm-wiki/references/native-execution.md) for workspace initialization, explicit destination selection, structured MCP calls and revision-safe persistence. Complete the requested outcome in the current conversation; sending a prompt or adding a task is not completion. Preserve current authorization and Session evidence boundaries.

## Start and retain task identity

Read `/wiki/purpose`, `/wiki/schema`, relevant existing pages and `/research/tasks`. If the UI supplied a task ID, continue that exact task, retaining its creation date and topic. Otherwise create one unique ID for this research request. Do not create another task on retry. Record through `wiki_write` route `/research/tasks`, body `{"task":{...}}`; the service upserts by ID and retains the newest 50. Send the complete merged task because this operation replaces that entry.

Use `queued` only before execution, `running` while actual research is underway, `done` after the cited page is saved and verified, and `failed` when a blocking step fails. Preserve `id`, `topic`, `created_at`; update `queries`, `result_count`, `saved_path` and a concise `error` only when supported by actual results. Existing legacy states may appear in history and should not be rewritten merely to normalize labels. A UI send failure or unavailable research tool must not leave a false completed result. If the status write itself fails, report the task/history mismatch.

## Research

1. Break the question into useful complementary queries covering evidence, disagreement, practical implications and recent developments where relevant. A narrow question need not force a fixed number of searches.
2. Use Codex native web search/retrieval. Prefer primary and authoritative sources, with official documentation and original research for technical claims. Never route to the removed OpenClacky `/research` model endpoint or configure a second model/search account.
3. Record title, direct URL, publisher/author when available, and access date. Read the source behind each important claim; snippets are discovery aids.
4. Compare sources and label disagreement, weak evidence and inference. If the task requires a missing past project decision, use the linked Reader under [session integration](../llm-wiki/references/session-memory.md); unrelated personal history is unnecessary.
5. Search existing Wiki pages, read full matches, and merge into an appropriate page or create one under the confirmed schema. Add useful canonical `[[directory/page]]` links, with the related page's reciprocal link only when meaningful.

## Save and verify

The page should answer the research question with a concise synthesis, scope, findings and evidence, uncertainties, relevant Wiki links, and sources with direct URLs/access dates. Preserve the user's language and taxonomy; do not force `wiki/queries/` when the schema calls for another type. Use revision-safe `/wiki/page` calls, preserve unknown metadata, and update an existing index only when useful.

Reread saved pages and run `/lint` for links introduced by this work. Only then upsert the task as `done` with its actual `saved_path` and count of sources used. Record `deep_research_completed` through `/activity` with `actor:"agent:codex"`, topic and saved path. If processing a review item, resolve it as `complete` only after its actual question was addressed; unanswered items remain open. Evidence-backed follow-up questions can remain in the review queue without being presented as established facts.

If research or saving fails, retain useful retrieved evidence and any successfully saved partial page, update the task to `failed` with the unresolved step, and report the limitation. Resume using the same ID and current page revision. Never fabricate citations or use an empty source list as a completed research result.

Report what was learned, the saved page, important connections, and any unanswered part.
