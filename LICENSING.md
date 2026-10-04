# Licensing

The LLM Wiki integration in this distribution is licensed under the GNU General Public License, version 3. The full text is in [LICENSE](LICENSE). Third-party components retain their own applicable license terms and copyright notices; this integration's license does not replace them.

## LLM Wiki and Codex modifications

The adapted UI retains the upstream LLM Wiki attribution to Yong Su (`nashsu/llm_wiki`, 0.6.x) and the original OpenClacky port's notices. The workspace [COPYING](skills/llm-wiki/assets/workspace/COPYING) and [THIRD_PARTY_NOTICES.md](skills/llm-wiki/assets/workspace/THIRD_PARTY_NOTICES.md) remain part of the package. The local runtime, native MCP bridge, Codex workflows, and UI adaptations are distributed under GPL-3.0. The source in `skills/llm-wiki/assets/workspace/web/` and `api/`, runtime scripts, build command, and lockfile identify the implementation used for this integration.

## Additional grant for the bundled Session Skill

On 2026-10-02 the copyright holder of [Agent Session Knowledge Base Skill v0.6.0-rc.2](https://github.com/streetlightstartupnotes/agent-session-knowledge-base-skill/releases/tag/v0.6.0-rc.2) confirmed that they may license the relevant code and authorized an additional GPL-3.0 grant for this integrated distribution.

Under that authorization, the copyright holder's code bundled in `skills/agent-knowledge-reader/` and `skills/agent-session-knowledge-rebuilder/` is additionally available under the GNU General Public License, version 3, whose text is supplied in this package's root `LICENSE`. This grant covers those bundled copies and the copyright holder's contributions; it does not grant rights to unrelated third-party material.

The original PolyForm Noncommercial license files are preserved in each bundled skill as provenance. The additional grant does not change the original repository's license. Recipients of the covered bundled code may use the additional GPL-3.0 grant described here.

## JavaScript dependencies and generated notices

[licenses/INDEX.md](licenses/INDEX.md) lists the 21 npm packages whose code is emitted by the current production browser build, plus three components already embedded inside those dependencies. Their complete license texts are preserved under `licenses/`. [licenses/manifest.json](licenses/manifest.json) records installed versions checked against `package-lock.json`, npm integrity values, source locations, and license-file SHA-256 digests.

The installed MCP package manifests declare MIT, while their actual shipped license files contain the project's MIT-to-Apache-2.0 transition statement and both code-license texts. Those files are preserved in full. DOMPurify 3.4.16 is used under its offered Apache-2.0 option; both its Apache-2.0 and MPL-2.0 texts are retained.

The generated `skills/llm-wiki/assets/workspace/panels/wiki-app/view.js.LEGAL.txt` must accompany `view.js`. It preserves the source license comments extracted by esbuild's `--legal-comments=external` setting. Keep those comments and the full dependency licenses when packaging; regenerate the inventory after changing dependencies or bundled imports.

This document records the grants, supplied texts, and provenance for this distribution. Inclusion of this package in a plugin directory does not alter these license terms.
