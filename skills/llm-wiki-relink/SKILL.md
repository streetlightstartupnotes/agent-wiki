---
name: llm-wiki-relink
description: Inspect the current conversation-selected or user-selected global LLM Wiki, infer content-specific page types, and create or repair meaningful bidirectional wiki links. Use when the user asks to organize, connect, classify, or improve the knowledge graph.
---

# LLM Wiki Relink

## Native Codex execution

Read and follow [the shared native execution contract](../llm-wiki/references/native-execution.md) for workspace initialization, explicit destination selection, structured MCP calls and revision-safe persistence. Complete the requested outcome in the current conversation; sending a prompt or adding a task is not completion. Preserve current authorization and Session evidence boundaries.

## Audit

Read page contents and build a compact plan:

- infer each page's most useful type from its subject and role;
- treat existing schema types as examples, not a closed list;
- treat the user's confirmed taxonomy as the starting point and never require a
  page for every type;
- introduce a precise new type when it improves navigation (for example method,
  person, claim, event, decision, tool, dataset, organization, or a domain-specific
  Chinese type);
- identify relationships supported by the pages themselves;
- distinguish true isolated pages from pages that simply should not be linked.

Do not link pages merely because they share a broad type or keyword. If a
relationship is uncertain, report it instead of writing it.

## Apply

1. Add or correct `type` with `/wiki/page/metadata` using the current `revision`, or merge the full Markdown through `/wiki/page`; do not discard unknown fields.
2. Move no files unless the user separately requested it; type and directory may
   differ temporarily.
3. For each supported A–B relationship, add a natural `[[wikilink]]` on both
   pages, normally in a concise `## 相关知识` or `## Related knowledge` section
   matching each page's language. Preserve existing links.
   Use the canonical wiki-relative page id on both sides, including the
   directory, such as `[[cases/vs-liangwenwen-2019]]`; omit the leading `wiki/`
   and trailing `.md`. Never generate a cross-folder bare filename.
4. When helpful, add a short free-form relation label under frontmatter
   `relations`, keyed by the target page id. Relation names are not a fixed enum.
5. Update `/wiki/schema` for genuinely new types. Read then merge new labels/colors through
   `/graph/config` only when useful, preserving all user choices.
6. Keep an existing `wiki/index.md` navigable when the project uses one. Never
   create empty category pages, fabricate evidence, delete prose, or replace the
   user's own type/color settings.

## Verify and report

Use `wiki_read` route `/lint` with the explicit project.

Report the types inferred, pages changed, reciprocal links added, uncertain
relationships left untouched, and remaining lint issues in plain language.
After successful writes, record `graph_organized` through `POST
/activity` with the number of pages and links changed.
