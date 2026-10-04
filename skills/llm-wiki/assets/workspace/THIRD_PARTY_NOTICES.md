# Third-party notices

## Original Wiki and OpenClacky port attribution

The following attribution from the original port is retained. This Codex
distribution further adapts the host integration and local runtime; it does not
remove or replace the upstream copyright or license notices.

The WebUI layout, visual system, navigation model, and interaction patterns are
adapted from **LLM Wiki** by Yong Su (`nashsu/llm_wiki`), version 0.6.x.

- Upstream: https://github.com/nashsu/llm_wiki
- License: GNU General Public License v3.0
- Copyright: 2024–2026 Yong Su

This OpenClacky port replaces Tauri filesystem and store calls with the
extension's HTTP API and is therefore a modified version. The corresponding
source for the WebUI is kept in `web/`; the generated browser bundle is
`panels/wiki-app/view.js`.

The graph physics uses **d3-force** and its D3 module dependencies.

- Upstream: https://github.com/d3/d3-force
- License: ISC
- Copyright: 2010–2026 Mike Bostock

The force parameters and drag/reheat interaction were independently adapted
for this extension after studying the MIT-licensed Quartz graph implementation.
No Quartz source code is bundled.

- Reference: https://github.com/quartz-community/graph
- License: MIT

## Codex distribution changes

The Codex adaptation replaces the OpenClacky-specific model/session integration
with a local deterministic API, stdio MCP tools, an MCP Apps interface, and
Codex skills. Source for these modifications accompanies the package. The
original GPL text remains in `COPYING` and the distribution root `LICENSE`.

The graph copyright line above is retained from the original port. The exact
copyright years and license texts for the versions actually bundled here are
preserved separately in the dependency inventory below.

## Dependencies included in the browser bundle

The [complete inventory](../../../../licenses/INDEX.md) was checked on
2026-10-02 using an in-memory production esbuild build, installed package
metadata, and `package-lock.json`. It records 21 npm packages with code emitted
into `panels/wiki-app/view.js`, including:

- MCP Apps `@modelcontextprotocol/ext-apps` 2.0.3 and TypeScript SDK
  `@modelcontextprotocol/client` / `@modelcontextprotocol/core` 2.2.0.
- DOMPurify 3.4.16, React / React DOM 19.2.7, and scheduler 0.27.0.
- D3 force 3.0.0 and its dispatch/quadtree/timer dependencies, Graphology
  0.26.0 / utilities 2.5.2, Sigma 3.0.3, and events 3.3.0.
- Lucide React 0.468.0, Marked 15.0.12, Turndown 7.2.4, and
  turndown-plugin-gfm 1.0.2.
- Zod 4.6.5 and pkce-challenge 5.0.1.

The MCP packages' shipped `LICENSE` files contain an MIT-to-Apache-2.0
transition notice despite their package metadata declaring MIT. The complete
upstream files are copied without simplifying that distinction. DOMPurify is
used under its offered Apache-2.0 option; its alternative MPL-2.0 text is also
preserved. Other dependency licenses and their copyright attributions are
copied verbatim into the distribution's `licenses/` directory.

Additional MIT notices cover content-type 1.0.5 and @cfworker/json-schema
4.1.1 embedded in the MCP client, and the Babel regenerator helper embedded in
DOMPurify. The cfworker upstream notices also retain attribution for its
punycode.js and ajv-derived functions. The exact helper package
version is not identified by the shipped notice; no separate version is
asserted. The complete Marked license file includes the original Markdown
attribution, and the Lucide license file retains its Feather attribution.

Keep the generated `panels/wiki-app/view.js.LEGAL.txt` alongside `view.js`.
It contains the legal comments extracted from the bundle, including React,
DOMPurify, Lucide, content-type, and regenerator notices. The full license texts
and this notice supplement that generated file; neither replaces it.
