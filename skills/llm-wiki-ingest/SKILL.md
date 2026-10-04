---
name: llm-wiki-ingest
description: Ingest attached, imported, pasted, or linked source material into the current conversation-selected or user-selected global LLM Wiki. Use when the user asks to import, ingest, absorb, organize, or turn material into wiki knowledge.
---

# LLM Wiki Ingest

## Native Codex execution

Read and follow [the shared native execution contract](../llm-wiki/references/native-execution.md) for workspace initialization, explicit destination selection, structured MCP calls and revision-safe persistence. Complete the requested outcome in the current conversation; sending a prompt or adding a task is not completion. Preserve current authorization and Session evidence boundaries.

## Resolve input

- For native chat attachments, use the attachment paths supplied by Codex.
- Resolve wiki-relative paths such as `raw/sources/file.pdf` against the explicitly selected knowledgeBase, never the Codex working directory. UI commands supply absolute paths. Resolve other relative user attachments from their explicitly supplied base directory; ask if ambiguous.
- For pasted text, save an accurately named Markdown source through `/sources/upload` before processing.
- For a URL, use native web retrieval/search tools, then `/sources/clip` to save the supplied content, URL and title. Include the retrieval date and avoid storing irrelevant copyrighted full-text material when a cited excerpt suffices.
- Use the native file reader for PDF, DOCX, spreadsheets, images, and other supported formats.

Never overwrite the only copy of a source. Keep original material under `raw/sources/`.

For session history, first read [session integration](../llm-wiki/references/session-memory.md). Raw sessions require the authorized Rebuilder workflow, including actual semantic review; do not ingest serialized messages as ordinary prose. An existing verified publication is accessed through Reader. Import only the requested synthesis with its returned provenance, not a generated index or an unverified draft.

For each preserved `raw/sources/…` file, read `/ingest/status` with `query:{source_path}` and retain its `source_sha256` before analysis. If `ingested:true` and the requested outcome is unchanged, inspect the listed pages and reuse them instead of duplicating work. An explicit reprocess request, changed source, missing output page or changed scope requires analysis again. This cache records source processing; it does not certify that every later user edit still agrees with the source.

## Analyze, then write

First analyze the source against the project purpose and schema:

- identify entities, concepts, claims, events, decisions, evidence, dates, and relationships;
- infer the most useful type for each page from its actual content and the
  user-confirmed taxonomy. When the material clearly needs a new type, explain
  why; if its boundary is uncertain, ask the user before adding it. Never force
  a page into a generic type merely because an old template listed it;
- find related existing pages before creating new ones;
- note contradictions or uncertain claims explicitly;
- plan the smallest useful set of page creates and merges.

Then write or update Markdown under `wiki/` through revision-safe `/wiki/page` calls:

- follow `schema.md` and existing frontmatter conventions;
- read the schema's stable Type ID and write that exact value to frontmatter
  `type`. Never substitute the localized display label. For example, if the
  schema says Type ID `books` and display label `书籍档案`, write `type: books`;
- prefer merging into an established page over making a duplicate;
- add meaningful `[[wikilinks]]` in both directions where appropriate. When A
  links to B, inspect B and add the reciprocal link in a short “相关知识” or
  “Related knowledge” section matching that page's language
  unless that would be misleading. Never create a link merely to make the graph
  denser;
- write every link target as its canonical wiki-relative page id, including its
  directory, for example `[[drafts/argument]]` or `[[evidences/site-inspection]]`.
  Omit the leading `wiki/` and trailing `.md`. Do not reduce a cross-folder link
  to `[[argument]]` merely because the filename is currently unique;
- record a short human-readable relation in frontmatter when useful, for example
  `relations: {"target-page": "使用该方法"}`. Do not restrict relations to a
  fixed vocabulary;
- if a new type is introduced, update `/wiki/schema`; optionally merge its display
  label and color through `/graph/config`, preserving user settings.
  The config shape is `{"types":{"type-id":{"label":"Display label","color":"#2563eb"}}}`;
  never use `labels` or `display` keys;
- preserve useful existing content when updating a page;
- create or update a source summary page that records provenance;
- keep an existing `wiki/index.md` navigable when the project uses one; do not
  create an otherwise unnecessary index page solely to satisfy a template.

Process multiple sources as one coherent batch when they were submitted together.

Separate evidence-backed page changes from suggestions needing research or human judgment. Read `/review` and save actionable unresolved items through `/review/items` with `body:{items:[{type:"verify",title:"specific question",detail:"evidence gap and proposed next step",source:"raw/sources/file.md"}]}`. Types are `research`, `verify`, `expand`; the server assigns IDs and deduplicates identical entries. `source` may also name an existing `wiki/…` page. Keep uncertainty in the page as well. A queued suggestion does not establish a fact or authorize research outside the user's request.

## Verify

Use `wiki_read` route `/lint` with the explicit project.

Fix obvious broken links introduced by this ingest. Confirm that every new
cross-folder link contains its canonical directory. Do not silently rewrite
unrelated pages.

After reading back the successfully saved pages, call `/ingest/complete` for each fully processed source with `body:{source_path,source_sha256,files:["wiki/type/page.md"]}` using the original digest and actual saved paths. Both ingest routes require an explicit `project`, even when a global library is selected. The server checks that pages exist in that Wiki and rejects a changed source with 409. On conflict reread the source and reconcile; never substitute a fresh digest merely to make the receipt succeed. Partial/failed ingest gets no completion receipt. Retain each successful source's receipt during a mixed-result batch and report the remaining sources.

After successful writes, record `ingest_completed` through `POST
/activity` with a concise count of sources and pages changed.

Report in plain language:

- which sources were read;
- which pages were created or updated;
- the most important new connections;
- any uncertainty, contradiction, or remaining lint issue.
