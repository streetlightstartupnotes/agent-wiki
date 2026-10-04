---
name: llm-wiki-onboard
description: Create or refine an LLM Wiki in the current Codex conversation, choosing useful scope, language and content-specific types from the user’s purpose and real materials.
---

# LLM Wiki Onboard

## Native Codex execution

Read and follow [the shared native execution contract](../llm-wiki/references/native-execution.md) for workspace initialization, explicit destination selection, structured MCP calls and revision-safe persistence. Complete the requested outcome in the current conversation; sending a prompt or adding a task is not completion. Preserve current authorization and Session evidence boundaries.

## Workflow

When the request says create_new or explicitly asks for a new knowledge base, create a new independent wiki; do not fall back to editing the default/previous wiki. A retry within the same creation request reuses the returned project instead of creating a duplicate. Refinement requests keep the explicitly selected wiki.

Ask only for the missing name and private destination needed to create the library. Reuse information already supplied. Purpose is optional for an empty library; save a purpose only when supplied or supported by the user’s actual materials, and ask about scope only when it affects the requested work. Do not invent goals. Call `wiki_open` with the approved private application directory, then `/projects` to create a named wiki. Use existing selected wikis directly and do not create empty duplicates on retries. Match the conversation language.

Inspect actual materials before designing the schema. Infer a small set of useful domain-specific types and discuss uncertain boundaries. Save scope, audiences, important questions, inclusion and exclusion criteria through `/wiki/purpose`. Save stable type IDs, localized labels, required metadata and canonical link rules through `/wiki/schema`. Preserve existing types and pages during refinement. Graph configuration uses `types` and `label`, never `labels` or `name` as replacements. Only create knowledge pages backed by actual input; starter index/log scaffolds are not knowledge claims.

Use the same plugin’s [ingest Skill](../llm-wiki-ingest/SKILL.md) for supplied materials and [relink Skill](../llm-wiki-relink/SKILL.md) for meaningful links, then `/lint`. Read these relative entries instead of selecting an independently installed namesake. Verify purpose/schema, saved pages, navigation and graph. Report completed steps and remaining gaps. Do not claim the workspace was populated if only scaffolds were created. Default/global selection is explicit through `/global-project`; installation alone does not enable it.
