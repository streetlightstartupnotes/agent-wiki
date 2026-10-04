import React, { useEffect, useId, useMemo, useRef, useState } from "react"
import { ArrowDownLeft, ArrowUpRight, Command, ExternalLink, FilePlus2, FileText, Hash, Link2, List, PanelRightClose, Search, X } from "./icons.jsx"
import { extractMarkdownHeadings, filterPaletteItems, nextPaletteIndex, validWorkspacePagePath, workspacePageConnections, workspacePageTitle } from "./workspace-model.js"

const TEXT = {
  zh: { tabs: "打开的笔记", close: "关闭", unsaved: "未保存", newPage: "新建笔记", quickOpen: "快速打开", commandPalette: "命令面板", searchPages: "搜索笔记名称或路径…", searchCommands: "搜索命令…", noResults: "没有匹配项", results: "项结果", choose: "选择", run: "打开", dismiss: "关闭", outline: "大纲", links: "链接", details: "笔记资料", closeInspector: "收起资料栏", selectPage: "选择笔记查看资料", noHeadings: "此笔记没有标题", incoming: "引用这篇笔记", outgoing: "链接到", sources: "来源", noIncoming: "暂无笔记链接到这里", noOutgoing: "还没有链接到其他笔记", noSources: "未记录来源", graphLoading: "正在读取链接…", graphPending: "链接尚未加载", notIndexed: "这篇笔记还没有连接", unavailable: "页面暂不可用", failed: "操作未完成，请重试", working: "正在打开…" },
  en: { tabs: "Open notes", close: "Close", unsaved: "Unsaved", newPage: "New note", quickOpen: "Quick open", commandPalette: "Command palette", searchPages: "Search note names or paths…", searchCommands: "Search commands…", noResults: "No matches", results: "results", choose: "Select", run: "Open", dismiss: "Close", outline: "Outline", links: "Links", details: "Note details", closeInspector: "Hide details", selectPage: "Open a note to see its details", noHeadings: "No headings in this note", incoming: "Backlinks", outgoing: "Outgoing links", sources: "Sources", noIncoming: "No notes link here", noOutgoing: "No outgoing links", noSources: "No sources recorded", graphLoading: "Loading links…", graphPending: "Links have not loaded", notIndexed: "This note is not in the graph", unavailable: "Page unavailable", failed: "Could not complete the action. Try again", working: "Opening…" },
}
const textFor = lang => TEXT[String(lang || "zh").startsWith("zh") ? "zh" : "en"]
function modifierKey() { return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "") ? "⌘" : "Ctrl+" }

/** Controlled tabs. onSelect/onClose may return false (or resolve false) to cancel a dirty-page transition. */
export function DocumentTabs({ tabs = [], activePath, dirtyPaths = [], dirty = false, onSelect, onClose, onNewPage, onQuickOpen, lang = "zh", editorPanelId }) {
  const tx = textFor(lang), prefix = useId(), buttons = useRef(new Map())
  const [error, setError] = useState("")
  const documents = useMemo(() => {
    const seen = new Set()
    return tabs.flatMap(page => {
      const path = validWorkspacePagePath(typeof page === "string" ? page : page?.path)
      if (!path || seen.has(path)) return []
      seen.add(path); return [{ path, title: workspacePageTitle(page) }]
    })
  }, [tabs])
  const dirtySet = dirtyPaths instanceof Set ? dirtyPaths : new Set(dirtyPaths)
  const currentIndex = documents.findIndex(page => page.path === activePath)
  useEffect(() => { buttons.current.get(activePath)?.scrollIntoView({ block: "nearest", inline: "nearest" }) }, [activePath])
  async function select(path, focus = false) {
    setError("")
    if (path === activePath) { if (focus) buttons.current.get(path)?.focus(); return }
    try { const accepted = await onSelect?.(path); if (accepted !== false && focus) buttons.current.get(path)?.focus() }
    catch (failure) { setError(failure?.message || tx.failed) }
  }
  async function close(path) {
    setError("")
    const restoreFocus = buttons.current.get(path) === document.activeElement
    try {
      if (await onClose?.(path) === false) return
      if (restoreFocus) {
        const index = documents.findIndex(page => page.path === path), remaining = documents.filter(page => page.path !== path)
        const neighbor = remaining[Math.min(index, remaining.length - 1)]
        if (neighbor) requestAnimationFrame(() => buttons.current.get(neighbor.path)?.focus())
      }
    } catch (failure) { setError(failure?.message || tx.failed) }
  }
  function keyDown(event, index) {
    if (event.altKey || event.metaKey || event.ctrlKey || event.isComposing) return
    let next
    if (event.key === "ArrowRight") next = (index + 1) % documents.length
    if (event.key === "ArrowLeft") next = (index - 1 + documents.length) % documents.length
    if (event.key === "Home") next = 0
    if (event.key === "End") next = documents.length - 1
    if (next !== undefined) { event.preventDefault(); select(documents[next].path, true); return }
    if (event.key === "Delete" && onClose) { event.preventDefault(); close(documents[index].path) }
  }
  return <div className="lw-docbar">
    <div className="lw-doctabs" role="tablist" aria-label={tx.tabs}>
      {documents.map((page, index) => {
        const selected = page.path === activePath
        const unsaved = dirtySet.has(page.path) || (selected && dirty)
        return <div className={`lw-doctab ${selected ? "is-active" : ""}`} role="presentation" key={page.path}>
          <button type="button" role="tab" id={`${prefix}-${index}`} aria-selected={selected} aria-controls={selected ? editorPanelId : undefined} aria-label={`${page.title}${unsaved ? ` · ${tx.unsaved}` : ""}`} tabIndex={selected || (currentIndex < 0 && index === 0) ? 0 : -1} ref={node => { if (node) buttons.current.set(page.path, node); else buttons.current.delete(page.path) }} title={page.path} onClick={() => select(page.path)} onKeyDown={event => keyDown(event, index)}><FileText aria-hidden="true" /><span>{page.title}</span>{unsaved && <span className="lw-tab-dirty" aria-hidden="true" />}</button>
          {onClose && <button type="button" className="lw-tab-close" tabIndex={-1} aria-label={`${tx.close} ${page.title}`} title={`${tx.close} ${page.title}`} onClick={() => close(page.path)}><X aria-hidden="true" /></button>}
        </div>
      })}
    </div>
    {error && <span className="lw-docbar-error" role="alert">{error}</span>}
    <div className="lw-docbar-actions">{onNewPage && <button type="button" aria-label={tx.newPage} title={tx.newPage} onClick={onNewPage}><FilePlus2 aria-hidden="true" /></button>}{onQuickOpen && <button type="button" aria-label={tx.quickOpen} title={`${tx.quickOpen} · ${modifierKey()}O`} onClick={onQuickOpen}><Search aria-hidden="true" /></button>}</div>
  </div>
}

/** One modal for page search and commands. onSelect receives the full filterPaletteItems entry. */
export function WorkspacePalette({ open = true, mode = "pages", pages = [], commands = [], onSelect, onClose, lang = "zh", initialQuery = "" }) {
  const tx = textFor(lang), prefix = useId(), dialog = useRef(null), input = useRef(null), options = useRef(new Map())
  const [query, setQuery] = useState(initialQuery), [activeIndex, setActiveIndex] = useState(-1), [pending, setPending] = useState(false), [error, setError] = useState("")
  const results = useMemo(() => filterPaletteItems({ mode, pages, commands, query }), [mode, pages, commands, query])
  const active = results[activeIndex]
  useEffect(() => { setQuery(initialQuery); setError("") }, [mode, open, initialQuery])
  useEffect(() => { setActiveIndex(nextPaletteIndex(results, -1, 1)) }, [results])
  useEffect(() => { options.current.get(activeIndex)?.scrollIntoView({ block: "nearest" }) }, [activeIndex])
  useEffect(() => {
    if (!open || !dialog.current) return undefined
    const previous = document.activeElement, current = dialog.current
    if (!current.open) current.showModal()
    input.current?.focus()
    return () => { if (current.open) current.close(); if (previous?.isConnected) previous.focus() }
  }, [open])
  async function activate(item) {
    if (!item || item.disabled || pending) return
    setPending(true); setError("")
    try { if (await onSelect?.(item) !== false) onClose?.() }
    catch (failure) { setError(failure?.message || tx.failed) }
    finally { setPending(false) }
  }
  function keyDown(event) {
    if (event.isComposing) return
    if (event.key === "Escape") { event.preventDefault(); if (!pending) onClose?.(); return }
    if (pending) return
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActiveIndex(current => nextPaletteIndex(results, current, event.key === "ArrowDown" ? 1 : -1)) }
    if (event.key === "Enter") { event.preventDefault(); activate(active) }
  }
  if (!open) return null
  return <dialog ref={dialog} className="lw-palette" aria-labelledby={`${prefix}-title`} onCancel={event => { event.preventDefault(); if (!pending) onClose?.() }} onKeyDown={keyDown}>
    <h2 id={`${prefix}-title`} className="lw-chrome-sr">{mode === "commands" ? tx.commandPalette : tx.quickOpen}</h2>
    <div className="lw-palette-input">{mode === "commands" ? <Command aria-hidden="true" /> : <Search aria-hidden="true" />}<input ref={input} value={query} onChange={event => { setQuery(event.target.value); setError("") }} disabled={pending} role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls={`${prefix}-list`} aria-activedescendant={active && !active.disabled ? `${prefix}-option-${activeIndex}` : undefined} aria-label={mode === "commands" ? tx.searchCommands : tx.searchPages} placeholder={mode === "commands" ? tx.searchCommands : tx.searchPages} autoComplete="off" spellCheck="false" /><button type="button" className="lw-palette-dismiss" disabled={pending} aria-label={tx.dismiss} onClick={onClose}><kbd>Esc</kbd></button></div>
    {error && <p className="lw-palette-error" role="alert">{error}</p>}
    <ul id={`${prefix}-list`} className="lw-palette-results" role="listbox" aria-label={mode === "commands" ? tx.commandPalette : tx.quickOpen} aria-busy={pending}>
      {results.map((item, index) => <li id={`${prefix}-option-${index}`} key={item.id} role="option" aria-selected={index === activeIndex} aria-disabled={item.disabled || undefined} className={index === activeIndex ? "is-selected" : ""} ref={node => { if (node) options.current.set(index, node); else options.current.delete(index) }} onMouseMove={() => { if (!item.disabled && !pending) setActiveIndex(index) }} onMouseDown={event => event.preventDefault()} onClick={() => activate(item)}>{item.kind === "page" ? <FileText aria-hidden="true" /> : <Command aria-hidden="true" />}<span className="lw-palette-result-text"><strong>{item.label}</strong>{item.detail && <small>{item.detail}</small>}</span>{item.shortcut && <kbd>{item.shortcut}</kbd>}</li>)}
    </ul>
    {!results.length && <p className="lw-palette-empty" role="status">{tx.noResults}</p>}
    <footer><span role="status">{pending ? tx.working : `${results.length} ${tx.results}`}</span><span><kbd>↑↓</kbd> {tx.choose}<kbd>↵</kbd> {tx.run}</span></footer>
  </dialog>
}

/** Obsidian-style shortcuts; Cmd/Ctrl+K and Shift+K remain owned by the existing editor. */
export function useWorkspaceShortcuts({ onQuickOpen, onCommandPalette, enabled = true }) {
  useEffect(() => {
    if (!enabled) return undefined
    function handler(event) {
      if(globalThis.document?.querySelector?.("dialog[open]"))return
      if (event.defaultPrevented || event.repeat || event.isComposing || event.altKey || event.shiftKey || !(event.metaKey || event.ctrlKey)) return
      const key = event.key.toLowerCase()
      const action = key === "o" ? onQuickOpen : key === "p" ? onCommandPalette : null
      if (!action) return
      event.preventDefault(); event.stopPropagation(); action()
    }
    window.addEventListener("keydown", handler, true)
    return () => window.removeEventListener("keydown", handler, true)
  }, [enabled, onQuickOpen, onCommandPalette])
}

export function WorkspaceInspector({ page, graph, pages = [], onOpenPage, onSelectHeading, onOpenSource, onClose, tab, onTabChange, lang = "zh", loadingGraph = false }) {
  const tx = textFor(lang), prefix = useId(), tabButtons = useRef(new Map())
  const [internalTab, setInternalTab] = useState("outline")
  const selectedTab = (tab || internalTab) === "links" ? "links" : "outline"
  const headings = useMemo(() => extractMarkdownHeadings(page?.content), [page?.content])
  const connections = useMemo(() => workspacePageConnections(page, graph, pages), [page, graph, pages])
  function selectTab(value, focus = false) { setInternalTab(value); onTabChange?.(value); if (focus) tabButtons.current.get(value)?.focus() }
  function tabKeyDown(event) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
    event.preventDefault()
    selectTab(event.key === "Home" ? "outline" : event.key === "End" ? "links" : selectedTab === "outline" ? "links" : "outline", true)
  }
  function linksSection(title, entries, empty, Icon) {
    return <section className="lw-inspector-section"><h3><Icon aria-hidden="true" />{title}<span>{entries.length}</span></h3>{entries.length ? <ul>{entries.map(entry => <li key={entry.id}><button type="button" disabled={!entry.path || !onOpenPage} onClick={() => onOpenPage(entry.path)} title={entry.path || tx.unavailable}><FileText aria-hidden="true" /><span>{entry.title}{entry.label && <small>{entry.label}</small>}</span></button></li>)}</ul> : <p className="lw-inspector-empty">{empty}</p>}</section>
  }
  return <aside className="lw-inspector" aria-label={tx.details}>
    <div className="lw-inspector-header"><div role="tablist" aria-label={tx.details}>{[["outline", List, tx.outline], ["links", Link2, tx.links]].map(([value, Icon, label]) => <button type="button" key={value} id={`${prefix}-${value}`} role="tab" aria-selected={selectedTab === value} aria-controls={`${prefix}-content`} tabIndex={selectedTab === value ? 0 : -1} ref={node => { if (node) tabButtons.current.set(value, node); else tabButtons.current.delete(value) }} onClick={() => selectTab(value)} onKeyDown={tabKeyDown}><Icon aria-hidden="true" />{label}</button>)}</div>{onClose && <button type="button" className="lw-inspector-close" aria-label={tx.closeInspector} title={tx.closeInspector} onClick={onClose}><PanelRightClose aria-hidden="true" /></button>}</div>
    <div id={`${prefix}-content`} className="lw-inspector-content" role="tabpanel" aria-labelledby={`${prefix}-${selectedTab}`}>
      {!page ? <p className="lw-inspector-empty">{tx.selectPage}</p> : selectedTab === "outline" ? <>{headings.length ? <ol className="lw-outline">{headings.map(heading => <li key={heading.key}><button type="button" style={{ paddingInlineStart: 12 + (heading.level - 1) * 12 }} onClick={() => onSelectHeading ? onSelectHeading(heading) : onOpenPage?.(page.path, { heading })} title={heading.text}><Hash aria-hidden="true" /><span>{heading.text}</span></button></li>)}</ol> : <p className="lw-inspector-empty">{tx.noHeadings}</p>}</> : <>
        {!connections.available ? <p className="lw-inspector-empty" role="status">{loadingGraph ? tx.graphLoading : tx.graphPending}</p> : <>{!connections.indexed && <p className="lw-inspector-empty">{tx.notIndexed}</p>}{linksSection(tx.incoming, connections.incoming, tx.noIncoming, ArrowDownLeft)}{linksSection(tx.outgoing, connections.outgoing, tx.noOutgoing, ArrowUpRight)}</>}
        <section className="lw-inspector-section"><h3><Link2 aria-hidden="true" />{tx.sources}<span>{connections.sources.length}</span></h3>{connections.sources.length ? <ul>{connections.sources.map(source => <li key={source}>{/^https?:\/\//i.test(source) ? <a href={source} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden="true" /><span>{source}</span></a> : onOpenSource ? <button type="button" onClick={() => onOpenSource(source)}><FileText aria-hidden="true" /><span>{source}</span></button> : <span className="lw-inspector-source"><FileText aria-hidden="true" /><span>{source}</span></span>}</li>)}</ul> : <p className="lw-inspector-empty">{tx.noSources}</p>}</section>
      </>}
    </div>
  </aside>
}
