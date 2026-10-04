# Native workspace and local development commands

Prefer `wiki_open`, `wiki_read`, `wiki_write`, `wiki_recall`, and `wiki_link_memory` MCP tools. Initialize `wiki_open` with an explicitly selected private `data_directory`; afterwards `{}` reopens it. Read/write tools accept an explicit project and structured query/body. Do not encode private content into shell commands. `wiki_asset` is UI-only.

The native MCP Apps UI calls these same tools. Explicit AI button clicks send an action to the current Codex conversation with selected page context. The commands below are developer diagnostics and a browser preview, not a substitute for native integration.

Resolve `<skill>` to this installed skill directory. Use a discovered Python 3.9+ executable (`python3` below). `<data>` is the user-approved private application directory, separate from this plugin. Commands return JSON and nonzero on failure.

```sh
python3 <skill>/scripts/wiki.py --data <data> start
python3 <skill>/scripts/wiki.py --data <data> status
python3 <skill>/scripts/wiki.py --data <data> stop
```

`start` returns a private `launch_url`. Open that exact URL. It exchanges the launch token for a SameSite cookie and redirects to a clean URL. The private `.runtime.json` is mode 0600; do not publish it. The optional server runs until stopped, is not installed as a service, and makes no model calls.

Create a JSON file with `{ "name": "Example", "language": "Chinese" }` and call:

```sh
python3 <skill>/scripts/wiki.py --data <data> api /projects --method POST --body-file <json-file>
```

Keep returned `project.path` for later calls. Open an existing wiki with POST `/projects/open-existing` and `{ "path": "<selected-folder>" }`. Generic Markdown import copies files. Existing wiki edits are in place.

```sh
python3 <skill>/scripts/wiki.py --data <data> api /wiki/purpose --project <project>
python3 <skill>/scripts/wiki.py --data <data> api /wiki/schema --project <project>
python3 <skill>/scripts/wiki.py --data <data> api '/search?q=example&limit=8' --project <project>
python3 <skill>/scripts/wiki.py --data <data> api '/wiki/page?path=wiki/concept/example.md' --project <project>
```

URL-encode query values. Write JSON with normal file tools; never interpolate private text into shell code.

POST `/wiki/page` accepts `path`, `content` and either `create: true` or the current `revision`. Creating a child additionally requires `parent_path` or `parent_directory`. Read existing schema/type directories before selecting a page path. Frontmatter includes `title`, `type`, `sources`; internal links omit `wiki/` and `.md`.

POST `/wiki/purpose` and `/wiki/schema` accept `{ "content": "..." }`. Change them only as part of approved schema/purpose work.

Other deterministic routes: GET `/wiki/tree`, `/sources`, `/graph`, `/graph/config`, `/lint`, `/review`, `/sidebar/order`; POST `/wiki/page/metadata`, `/wiki/page/move`, `/sidebar/move`, `/graph/config`, `/sources/upload`, `/activity`; DELETE `/wiki/page` takes a JSON `path` and moves a leaf to trash. GET `/trash` lists receipts; POST `/trash/restore` with `original_path` restores without overwriting an existing file. Inspect bundled `assets/workspace/api/handler.rb` for detailed request fields when needed.

The native editor, tree, search, graph, attachments and trash use these routes. AI buttons call the host's current conversation. The UI refreshes external changes while visible and when no unsaved draft exists. A revision conflict requires rereading and reconciling. Developer browser previews honestly report that AI actions require a native host.

Native agent ingestion retains the old source-hash cache through GET `/ingest/status` (`source_path` query) and POST `/ingest/complete` (`source_path`, initial `source_sha256`, actual `files` array). Both require explicit project selection. Only record completion after saved-page verification. Source changes return 409; missing/unsafe output files are rejected. A cached source whose output was deleted is no longer reported ingested. POST `/review/items` accepts `items` with `title`, `detail`, `type` (`research`, `verify`, `expand`), and optional existing relative `source`; the server creates IDs and deduplicates. POST `/review/resolve` changes status only, so research/repair still runs in the current conversation.

GET/POST `/research/tasks` supplies history and whole-task upserts by ID. Write `{"task":{"id":"…","topic":"…","status":"running",…}}`, retain creation time on retries, and mark done only after cited-page verification. Do not edit its backing JSON directly. Detailed agent recipes are in [native-execution.md](native-execution.md) and the dedicated ingest/research skills.

Global access uses GET/POST `/global-project`; pausing default lookup does not disable explicitly selected project operations. `/recovery/config` sets selected legacy session/snapshot roots; `/projects/recover` restores a candidate as a fresh library. DELETE `/projects` moves a managed library to recoverable project trash. DELETE `/sources` uses recoverable file trash. Sources can also be created via POST `/sources/clip`.

Native attachments use app-only `wiki_asset` in bounded chunks; bytes travel in private tool metadata. Downloads use the host's `downloadFile` capability and show an error if unavailable. Remote URL images can use exact HTTPS origins selected under Settings → External images. Saving changes the resourceDomains declaration for a reopened panel; the host still enforces it. The app-only wiki_image_policy tool persists this list. Default remains empty, with no generic proxy.
