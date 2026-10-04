# Wiki and verified session evidence in one task

This distribution includes the complete Reader/Rebuilder implementation from `v0.6.0-rc.2`. Use the bundled siblings linked here, so the workflow and scripts resolve to the same plugin version:

- [Reader](../../agent-knowledge-reader/SKILL.md): necessary historical recall, read-only publication checks and usage receipts.
- [Rebuilder](../../agent-session-knowledge-rebuilder/SKILL.md): scoped inventory, complete reconstruction, incremental maintenance, lifecycle and rule evolution.

The editable Wiki is the user's synthesis and navigation layer. The separate session library holds source events, semantic reviews, audited claims and a verified publication. Do not open its `knowledge/` folder as an editable Wiki, copy its index into a Wiki, or edit its generated Markdown to make a gate pass. Both destinations stay private and outside this plugin.

## Route by the requested outcome

| User needs | Execution and finish line |
|---|---|
| “What did we decide earlier?” | Reader necessity check → selected Wiki `wiki_recall` → read returned evidence → answer with dates and provenance. No reconstruction. |
| “Connect this existing session library” | Open the selected Wiki → `wiki_link_memory {project,kb}` → require success. The association alone is not a current usability claim. |
| “Turn these sessions into my knowledge base” | Rebuilder reconstruction workflow on the authorized sources → all semantic/publication/retrieval gates → link verified output → synthesize only useful Wiki pages under the requested import scope. |
| “Save today's decisions/results” | Capture from current evidence into the selected Wiki; invoke Rebuilder maintenance only if the separate destination and mode are also authorized. No prerequisite historical scan. |
| “Update/retract/forget an old session-derived fact” | Rebuilder's scoped maintenance or lifecycle workflow → verify new publication → reconcile affected editable Wiki synthesis within the same authorized scope. Preserve corrections; do not delete original sessions. |
| “Improve the Skill from our history” | Rebuilder collaboration-learning workflow; it does not implicitly rebuild or invalidate a linked library. |

## Link and recall through native tools

Initialize the Wiki with `wiki_open`, then call `wiki_link_memory` with the selected `project` and explicitly approved `kb`. It executes the bundled Reader and stores only a private path association. No default registry registration, source discovery or evidence mutation occurs. `/memory/status` reports a saved association, not a freshly verified publication.

For a missing fact call `wiki_recall {project,task:"specific missing decision"}`. It returns `wiki` search candidates and `session_memory` with evidence, `run_id` and `usage_receipt`. Read the full matching Wiki pages and the Reader's evidence rules before applying historical claims. Prefer the selected verified view; `view:"facts"` or `"current"` is appropriate only when supported, and a receipt outside the verified profile must remain explicit. The bridge uses `base_context:none`; if the question genuinely needs identity or collaboration, run the bundled Reader directly according to its retrieval contract with only that needed base context.

Every recall rechecks publication integrity. `no_match` is a bounded retrieval result, not proof that a fact never existed. A failed gate blocks use of session-derived evidence; do not answer from draft files or an old copied synthesis as though it were still validated. Independent Wiki material can still support an answer if its own source is sufficient and the evidence limitation is clear.

When current context suffices, invoke neither tool. If accidentally dispatched, `wiki_recall {task:"…",context_sufficient:true}` skips without opening a workspace, registry or library. CLI diagnostics remain available via `scripts/wiki.py memory-link` / `recall`; native tools are the normal path.

## Execute full reconstruction when requested

Read the Rebuilder [reconstruction contract](../../agent-session-knowledge-rebuilder/references/reconstruction.md), not just this summary. Resolve its script at `../../agent-session-knowledge-rebuilder/scripts/session_kb.py` relative to this file's parent. Run it with Codex's local execution tools in the current conversation. Use exact authorized roots with `--root` or `--source`; do not default to a whole-machine scan for a named session import.

The executable sequence is inventory → freeze → rebuild (dry run first) → review-init → complete review-packet coverage and evidence-bound semantic review → validate-review → distill → verify-retrieval. Read the CLI help and referenced contracts for the chosen mode's arguments. Preserve immutable snapshot hashes, parse/coverage gaps, primary-actor attribution, unresolved states and rejections. Model-authored review is required: a parser result or prefilled template cannot replace it. A complete retrieval suite requires related paraphrases and hard negatives; one successful query does not prove a newly reconstructed library ready.

Only a fully verified publication may be linked. Stop at and report the actual gate if blocked. Do not fabricate review evidence, completion manifests or receipts. For incremental updates, retain reviewed history outside generated output and reuse only hash-valid ranges, then redo affected synthesis and all required publication checks. Rebuild currently invalidates availability while it runs; it does not provide atomic candidate-to-active switching.

## Carry evidence into editable knowledge

When the user asks to import or summarize recalled history into the Wiki, use the ingest/capture workflow to merge a useful, attributed synthesis. Preserve a compact provenance note containing only fields actually returned: run ID, publication manifest hash, relative document paths/project keys, and claim/event IDs when present. Keep path associations and raw sessions out of page prose. A source note may record the cited excerpt and receipt fields, but must not copy unrelated histories or the entire generated library.

Label this as an editable synthesis with an evidence-check date, not as the live authoritative session publication. Record confirmed result versus intent, current versus superseded requirements, and unresolved contradictions. Read current Wiki revisions, save, reread and inspect links. Never promote a model summary to primary human evidence merely because it appears in the Wiki.

## Maintain and reconcile

Read and write decisions are independent. Existing standing authorization for the exact destination covers ordinary task-end maintenance, but linking or installing alone does not create it. For a human-maintained Wiki, use revision-safe capture; the Rebuilder's optional `maintenance-*` queue targets separately configured human-managed pages and must not bypass live Wiki concurrency control. For generated evidence, follow the full incremental review/publication workflow.

After authorized retraction, forgetting or correction, search only the affected Wiki synthesis by its recorded project/document/claim provenance. Show the affected copies in the lifecycle plan. Apply requested corrections/removals within scope and verify both the evidence library's gate and the Wiki result. The current bridge does **not** automatically propagate lifecycle changes into all editable copies, cancel queued work, or run a background daemon. Until reconciliation finishes, report the copied synthesis as pending review rather than current verified evidence.
