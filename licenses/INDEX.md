# Third-party license inventory

Verified on 2026-10-02 against the installed packages, `package-lock.json`, and an in-memory production esbuild build. The table includes the **21 npm packages with code actually emitted into the browser bundle**, rather than every installed development or optional dependency. Exact upstream license files are copied without editing. [manifest.json](manifest.json) records versions, lockfile integrity, source locations, and SHA-256 digests of the copied texts.

The original Wiki GPL notice is retained separately in [`../LICENSE`](../LICENSE), [`../skills/llm-wiki/assets/workspace/COPYING`](../skills/llm-wiki/assets/workspace/COPYING), and the [workspace notices](../skills/llm-wiki/assets/workspace/THIRD_PARTY_NOTICES.md). See [LICENSING.md](../LICENSING.md) for the Session Skill additional grant.

| Package | Bundled version | Upstream license information | Preserved text |
| --- | --- | --- | --- |
| @modelcontextprotocol/client | 2.2.0 | MIT in metadata; Apache-2.0/MIT transition in LICENSE | [LICENSE](modelcontextprotocol--client-2.2.0/LICENSE) |
| @modelcontextprotocol/core | 2.2.0 | MIT in metadata; Apache-2.0/MIT transition in LICENSE | [LICENSE](modelcontextprotocol--core-2.2.0/LICENSE) |
| @modelcontextprotocol/ext-apps | 2.0.3 | MIT in metadata; Apache-2.0/MIT transition in LICENSE | [LICENSE](modelcontextprotocol--ext-apps-2.0.3/LICENSE) |
| d3-dispatch | 3.0.1 | ISC | [LICENSE](d3-dispatch-3.0.1/LICENSE) |
| d3-force | 3.0.0 | ISC | [LICENSE](d3-force-3.0.0/LICENSE) |
| d3-quadtree | 3.0.1 | ISC | [LICENSE](d3-quadtree-3.0.1/LICENSE) |
| d3-timer | 3.0.1 | ISC | [LICENSE](d3-timer-3.0.1/LICENSE) |
| dompurify | 3.4.16 | (MPL-2.0 OR Apache-2.0) | [LICENSE](dompurify-3.4.16/LICENSE), [LICENSE-MPL](dompurify-3.4.16/LICENSE-MPL) |
| events | 3.3.0 | MIT | [LICENSE](events-3.3.0/LICENSE) |
| graphology | 0.26.0 | MIT | [LICENSE.txt](graphology-0.26.0/LICENSE.txt) |
| graphology-utils | 2.5.2 | MIT | [LICENSE.txt](graphology-utils-2.5.2/LICENSE.txt) |
| lucide-react | 0.468.0 | ISC | [LICENSE](lucide-react-0.468.0/LICENSE) |
| marked | 15.0.12 | MIT | [LICENSE.md](marked-15.0.12/LICENSE.md) |
| pkce-challenge | 5.0.1 | MIT | [LICENSE](pkce-challenge-5.0.1/LICENSE) |
| react | 19.2.7 | MIT | [LICENSE](react-19.2.7/LICENSE) |
| react-dom | 19.2.7 | MIT | [LICENSE](react-dom-19.2.7/LICENSE) |
| scheduler | 0.27.0 | MIT | [LICENSE](scheduler-0.27.0/LICENSE) |
| sigma | 3.0.3 | MIT | [LICENSE.txt](sigma-3.0.3/LICENSE.txt) |
| turndown | 7.2.4 | MIT | [LICENSE](turndown-7.2.4/LICENSE) |
| turndown-plugin-gfm | 1.0.2 | MIT | [LICENSE](turndown-plugin-gfm-1.0.2/LICENSE) |
| zod | 4.6.5 | MIT | [LICENSE](zod-4.6.5/LICENSE) |

## Upstream license details

- The three MCP package manifests declare MIT, but their shipped `LICENSE` files contain an MIT-to-Apache-2.0 transition statement. Those complete files are preserved, including both code-license texts and the upstream CC-BY-4.0 documentation notice. The table does not replace that statement with an assumed single-license grant.
- DOMPurify offers MPL-2.0 or Apache-2.0. This integrated distribution uses its Apache-2.0 option and retains both upstream license texts. Cure53 and contributor attribution also remains in the generated bundle's external legal comments.
- Lucide's complete ISC file retains its Feather attribution to Cole Bemis and the MIT origin of those portions.
- Marked's complete license file also retains the original Markdown notice attributed to John Gruber.

## Code already embedded inside dependencies

These components are visible in dependency source maps or retained legal comments and therefore need notices even though they are not separate top-level npm installations.

| Embedded component | Evidence | Preserved text and upstream source |
| --- | --- | --- |
| @cfworker/json-schema 4.1.1 (MIT) | Emitted MCP client browser validator source map; includes punycode.js and ajv-derived functions | [LICENSE](embedded-cfworker-json-schema-4.1.1/LICENSE.md), [upstream notices](embedded-cfworker-json-schema-4.1.1/THIRD_PARTY_NOTICES.md), [release source](https://github.com/cfworker/cfworker/tree/5409fdc2bd144f68e8b28c61c71fcb16600000a6) |
| content-type 1.0.5 (MIT) | MCP client 2.2.0 source map and browser legal comments | [LICENSE](embedded-content-type-1.0.5/LICENSE), [upstream version](https://github.com/jshttp/content-type/blob/v1.0.5/LICENSE) |
| Babel regenerator helper (MIT), embedded by DOMPurify 3.4.16 | DOMPurify's retained helper notice; exact helper package version is not identified | [LICENSE](embedded-babel-regenerator/LICENSE), [upstream license referenced by the notice](https://github.com/babel/babel/blob/main/packages/babel-helpers/LICENSE) |

## Generated bundle notices

Keep `skills/llm-wiki/assets/workspace/panels/wiki-app/view.js.LEGAL.txt` adjacent to `view.js`. It is generated with esbuild `--legal-comments=external` and contains the comments carried by the actual bundled source, including React, DOMPurify, Lucide, and embedded helper notices. Rebuilding the bundle must preserve this file; these full license texts supplement it and do not replace it.

Build dependencies such as esbuild and packages that are removed by tree shaking are recorded in `package-lock.json` but are not listed as shipped browser runtime code. `node_modules` is not part of the intended plugin distribution. Re-run the inventory after changing dependencies or imports; the current table is a recorded snapshot, not an assertion about future bundles.
