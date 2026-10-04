import {buildGraphRequest, findGraphNodes} from "./graph-actions.js"
import {layoutGraphLabels} from "./graph-labels.js"
import {ProductSignature, AboutProduct, PRODUCT_NAME} from "./product-info.jsx"
import {AppearanceSelect, InterfaceSettingsDialog, GuideDialog, LibraryStart, SearchView, SourceLinkDialog} from "./experience.jsx"
import { LibraryNavigation, CompactNavigation, LibraryHeader, LanguageSelect } from "./library-navigation.jsx"
import { getUiLanguage, uiText } from "./ui-language.js"
import readingStyles from "./reading-workspace.css"
import { ResearchView, HealthView } from "./library-tools.jsx"
import { DocumentTabs, WorkspacePalette, WorkspaceInspector, useWorkspaceShortcuts } from "./workspace-chrome.jsx"
import { loadWorkspaceState, saveWorkspaceState, openWorkspaceTab, closeWorkspaceTab, normalizeWorkspaceState } from "./workspace-model.js"
import chromeStyles from "./workspace-chrome.css"
import { CreateLibraryDialog, TaskHome, MemoryView, Modal, actionKeyDown, useProjectScope } from "./workspace-flows.jsx"
import { ImagePolicySettings } from "./image-policy.jsx"
import { connectHost, isNativeHost, nativeCall, nativeApi, askCodex, updateSelection, nativeAsset } from "./codex-host.js"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import DOMPurify from "dompurify"
import { marked } from "marked"
import Graph from "graphology"
import Sigma from "sigma"
import { createForceLayout } from "./force-layout.js"
import { createEditorHistory, recordEditorValue, redoEditorHistory, undoEditorHistory } from "./editor-history.js"
import { continueMarkdownList, indentMarkdownLines, prefixMarkdownLines, wrapMarkdownSelection } from "./editor-interactions.js"
import { attachmentAssetMarkup, imageAssetMarkup, normalizeImageWidth, relativeWikiAssetReference, resolveWikiAssetReference, wikiAssetFilename } from "./editor-media.js"
import { readGraphThemePalette, graphNodeColor, graphThemePalette } from "./graph-theme.js"
import { calculateVisualImportance, graphNodeVisuals } from "./graph-visuals.js"
import { HOST_SHORTCUTS, hostShortcutLabel, isEditableShortcutTarget, matchesHostShortcut } from "./host-actions.js"
import { editMarkdownTable } from "./markdown-table.js"
import { historyMessagesFromEvents, projectFromPayload, sessionFromPayload, workspaceProjectPath } from "./runtime-contracts.js"
import { encodeProjectPathHeader, PROJECT_PATH_HEADER } from "./project-header.js"
import { resolveWikiPage } from "./wiki-link-resolver.js"
import { sortSidebarItems } from "./sidebar-order.js"
import { buildSidebarTree, canCreateSidebarChild, childPageDirectory, filterSidebarTree, hasSidebarLogicalPathConflict, limitSidebarTree, sidebarDisplayDepth, sidebarTreeDocumentCount, typePageDirectory } from "./sidebar-tree.js"
import llmWikiLogo from "./assets/llm-wiki-logo.png"
import TurndownService from "turndown"
import { gfm } from "turndown-plugin-gfm"
import {
  AlertTriangle, ArrowLeft, ArrowLeftRight, ArrowUp, Bold, BookOpen, Bot, Braces, CheckCircle2,
  ChevronDown, ChevronRight, CircleHelp, ClipboardCheck,
  Code2, Columns2, CornerDownRight, Database, ExternalLink, Eye, File,
  FilePlus2, FileText, FolderOpen, FolderPlus, Globe2, Home, ImagePlus, Info, Languages, Lightbulb, LoaderCircle,
  Heading1, Heading2, Heading3, Highlighter, History, Italic, Link, Link2, List, ListChecks, ListOrdered,
  MessageSquare, Minus, MoreHorizontal, Network, PanelLeftOpen, PanelRightClose, PanelRightOpen, Paperclip, Plus, Quote, Redo2, RefreshCw, Save,
  Search, Send, Settings, Sparkles, Strikethrough, Table2, Trash2, Upload, User,
  Undo2, WandSparkles, X, ZoomIn, ZoomOut,
} from "./icons.jsx"
import styles from "./styles.txt"

const API = "/api/wiki"
const VERSION = "0.2.2"
const BUILD = "agent-wiki-0.2.2-release"
const GLOBAL_ACCESS_EVENT = "llm-wiki:global-access-changed"
const ONBOARDING_REQUEST_KEY = "llm-wiki:onboarding-request-id"
let activeSessionId = null
let activeProjectPath = null
let activeProjectEpoch = 0

function setActiveSessionId(sessionId) {
  activeSessionId = sessionId || null
}

function setActiveProjectPath(path) {
  activeProjectEpoch += 1
  activeProjectPath = path || null
}

const I18N = {
  zh: {
    subtitle: "笔记、资料和会话记录", home: "概览",
    welcomeTitle: "你的知识库",
    welcomeLead: "选择一个知识库，继续上次的工作。",
    createGuided: "新建知识库", existingWiki: "打开文件夹",
    howItWorks: "从这里开始", guideSetup: "给知识库起个名字", guideSource: "添加 PDF、Word 或 Markdown", guideAsk: "打开笔记或提问",
    pathPlaceholder: "输入或选择已有知识库文件夹", openThisProject: "打开知识库",
    chooseFolder: "选择文件夹", folderPickerTitle: "选择知识库文件夹", folderPickerHint: "支持 LLM Wiki、Obsidian、Quartz、Docusaurus 和普通 Markdown 知识库。",
    useThisFolder: "打开这个文件夹", goUp: "上一级", homeFolder: "主目录", recognizingWiki: "正在打开知识库…",
    wikiLoaded: "知识库已打开", wikiImported: "知识库已导入并打开，原文件没有改动", wikiAlreadyLoaded: "知识库已打开",
    gettingStarted: "上手进度", setupPurpose: "确定知识库用途", addFirstSource: "添加第一份资料", organizeKnowledge: "整理成笔记", readyToAsk: "可以开始提问了",
    continueSetup: "继续设置", addMaterial: "添加资料", organizeNow: "开始整理", openNativeChat: "查看当前对话",
    sourceGuideTitle: "添加资料", sourceGuideDesc: "添加 PDF、Word、Markdown、文本或图片，再选择要整理的文件。原文件会保留。",
    sourceNextTitle: "资料已保存", sourceNextDesc: "选择“开始整理”，在当前 Codex 对话查看进展。",
    noKnowledgeYet: "还没有笔记", noKnowledgeDesc: "新建一篇笔记，或导入资料后整理。",
    newProject: "新建知识库", openProject: "打开知识库", recent: "最近的知识库", allProjects: "全部知识库", viewAllProjects: "查看全部知识库", showRecentProjects: "只看最近使用",
    chat: "整理", wiki: "笔记", sources: "资料", search: "搜索",
    graph: "关系图", memory: "会话记录", health: "检查与待办", lint: "检查", review: "审核", research: "研究",
    skills: "工具", settings: "设置", switchProject: "切换知识库",
    knowledge: "目录", files: "文件", selectPage: "打开一篇笔记",
    noPages: "还没有笔记",
    noSources: "还没有资料", importFiles: "添加文件", ingestAll: "全部整理",
    ingest: "整理成笔记", delete: "删除", run: "运行检查", refresh: "刷新",
    ask: "询问你的知识库…", send: "发送", newChat: "新对话",
    emptyChat: "向知识库提问", emptyChatDesc: "回答会检索现有 Wiki 页面，并附上可打开的引用。",
    searchPlaceholder: "搜索笔记内容…", noResults: "没有找到结果",
    graphEmpty: "还没有笔记关联", graphEmptyDesc: "笔记之间建立链接后，就能在这里查看它们的关系。",
    lintReady: "查找失效链接，以及尚未与其他笔记连接的页面。",
    lintClean: "没有发现链接问题", orphan: "没有被引用的笔记", broken: "失效链接", noOutlinks: "未链接其他笔记",
    reviewEmpty: "没有待处理的内容", accept: "接受", dismiss: "忽略", startResearch: "开始研究",
    general: "常规", webSearch: "网络搜索", about: "关于",
    projectInfo: "知识库信息", projectName: "知识库名称", template: "模板",
    provider: "搜索服务", apiKey: "API Key", searxngUrl: "SearXNG 地址",
    outputLanguage: "输出语言", save: "保存", saved: "已保存",
    storageDirectory: "知识库保存目录",
    researchPlaceholder: "想弄清什么？", tasks: "研究任务",
    researchEmpty: "输入主题开始研究", created: "创建于", pages: "篇笔记", pageUnit: "篇笔记", sourceCount: "份资料", sourceUnit: "份资料", resultUnit: "条结果",
    createTitle: "新建知识库", namePlaceholder: "例如：产品笔记",
    required: "必填", language: "笔记语言", chooseLanguage: "请选择语言",
    cancel: "取消", create: "创建", creating: "创建中…",
    sourceDrop: "拖入文件，或点击上方“添加文件”", uploaded: "上传完成",
    saving: "保存中…", preview: "预览", edit: "编辑", close: "关闭",
    confirmDelete: "再次点击确认", loading: "正在加载…", retry: "重试",
    sourceSize: "大小", modified: "修改时间", selected: "已选择",
    sourceOnly: "Markdown", splitView: "双栏", richOnly: "编辑", swapColumns: "交换左右",
    graphOrganize: "整理笔记关联", graphOrganizeHint: "按笔记内容整理分类，并补充有依据的链接",
    graphTypes: "类型与颜色", graphConnections: "连接", graphBidirectional: "双向", graphOpenPage: "打开页面",
    graphSelectHint: "点击节点查看关系，双击直接打开页面", graphSaveTypes: "保存类型设置", graphNoConnections: "暂时没有连接",
    graphCollapsePanel: "收起类型与颜色", graphExpandPanel: "展开类型与颜色", graphDragHint: "拖动任意节点调整位置", graphImportance: "重要度",
    incoming: "指向它", outgoing: "它指向", relation: "关系",
    addType: "添加类型", typeIdPlaceholder: "类型 ID，例如：method",
    you: "你", assistant: "Codex", openClackyChat: "打开 Codex 对话",
    summarySuggestion: "总结一下这个知识库", conceptsSuggestion: "有哪些关键概念？", gapsSuggestion: "目前还有哪些知识缺口？",
    noSession: "连接尚未就绪，请稍后重试", conversationUnavailable: "Codex 对话服务暂不可用",
    loadFailed: "部分数据加载失败", results: "条结果", sourcesUnit: "个来源",
    newPage: "新建笔记", newSubpage: "新建子笔记", newTag: "新建分类", newArticle: "新建笔记", newChildArticle: "在这里新建笔记", newChildCategory: "在这里新建子分类", pageNamePlaceholder: "笔记名称", tagNamePlaceholder: "分类名称", categoryNamePlaceholder: "子分类名称", inlineCreateHint: "回车创建，Esc 取消", movePage: "移动/重命名", movePrompt: "新的页面路径（必须以 wiki/ 开头并以 .md 结尾）",
    openCategoryHome: "打开分类首页", deleteEmptyCategory: "删除空分类", categoryNotEmpty: "分类非空，请先移除其中的内容", pageHasChildren: "文章下还有内容，不能直接删除", confirmTreeDelete: "再次点击确认删除", movedToTrash: "已移入回收站，可在知识库回收站中恢复", categoryDeleted: "空分类已删除",
    trash: "回收站", projectTrash: "知识库回收站", trashEmpty: "回收站是空的", trashLoadFailed: "回收站加载失败", restore: "恢复", restoring: "恢复中…", restored: "文件已恢复", deletedAt: "删除于",
    treeSearch: "筛选笔记…", showMorePages: "再显示 {count} 篇",
    dragPageHint: "长按后自由拖动；上下排序，左右改变层级，放到页面中间成为子页面", dropInside: "放入页面", dropBefore: "移到前面", dropAfter: "移到后面", renameTypePrompt: "新的分类名称", renamePageTitlePrompt: "新的文档标题", pageTypeChanged: "已移动到分类", pageReordered: "页面层级和位置已更新", typeRenamed: "分类名称已更新", pageTitleRenamed: "文档标题已更新", tagCreated: "分类已创建", tagExists: "标签已存在",
    invalidPagePath: "页面路径必须位于 wiki/ 下并以 .md 结尾", pageExists: "页面已存在", pagePathConflict: "同名文章或分类已占用这个位置", unsaved: "未保存", unsavedConfirm: "当前页面还有未保存的修改，确定放弃吗？",
    saveConflict: "页面已有新版本。草稿仍在编辑器中，请比较后再决定如何保存。",
    saveFailed: "保存失败，草稿仍在当前编辑器中。", retrySave: "重试保存", compareVersions: "读取最新版本并比较", copyDraft: "复制草稿", draftCopied: "草稿已复制", copyManually: "自动复制不可用。请选中以下草稿，按 ⌘C 或 Ctrl+C 复制。", conflictTitle: "比较两个版本", localDraft: "我的修改", remoteVersion: "磁盘上的版本", versionChoiceHint: "选择要保留的版本。也可以先复制自己的修改，取消后继续合并。", useRemote: "使用磁盘上的版本", useLocal: "保留我的修改", readLatest: "重新读取最新版本", conflictChangedAgain: "页面又有更新。草稿仍在，请重新读取最新版本后选择。", remoteAccepted: "已载入磁盘上的版本", invalidPageVersion: "无法读取有效的页面版本，请重试。", markDone: "标记已处理",
    replaceSource: "同名来源已经存在，是否覆盖？", uploadTooLarge: "单个文件不能超过 25 MB",
    lintDetail: "问题详情", nativeResearchHint: "在当前对话中查看研究进展，完成后在这里打开笔记。",
    settingsHelp: "想改知识库的名称、用途或分类，直接告诉 Codex。研究结果会附上来源。",
    skillsIntro: "这个知识库可用的工具。", aboutRuntime: "笔记保存在本机。整理和研究在当前 Codex 对话中进行。",
    sourceOrganizeQueued: "已发送到 Codex，整理完成后会出现在笔记中", researchQueued: "已发送研究请求，可在当前对话查看进展",
    hostLoading: "正在读取知识库…", hostUnavailable: "状态暂不可用", hostOpen: "打开知识库", hostOpenFull: "打开完整知识库", hostIngest: "整理附件", hostLint: "检查知识库", hostCapture: "归纳对话", hostCaptureFull: "归纳当前对话进知识库", hostCaptureQueued: "已发送归纳请求，目标知识库：「{name}」", hostCaptureNoProject: "还没有可写入的知识库，请先创建或选择一个", hostCaptureNoSession: "当前没有可归纳的对话", hostSessionActive: "当前对话知识库：{name}", hostPause: "暂停默认查找", hostResume: "恢复默认查找", hostGlobalActive: "默认知识库：{name} · 所有对话可用", hostGlobalPaused: "默认知识库：{name} · 已暂停默认查找", hostGlobalNone: "还没有选择默认知识库", globalAllSessions: "所有对话可用", globalPausedShort: "默认查找已暂停",
    hostNoProject: "还没连接知识库 · 从创建或打开知识库开始", hostStart: "开始", hostContinue: "继续设置", hostAdd: "添加资料", hostOrganize: "开始整理",
    errorTitle: "知识库界面出错",
    zoomIn: "放大", zoomOut: "缩小", resetView: "重置视图", graphReference: "引用", graphTwoWay: "双向关联",
    pageNotFound: "未找到页面", untitled: "未命名", auto: "自动",
    statusPending: "等待中", statusRunning: "进行中", statusCompleted: "已完成", statusError: "失败",
    orphanDetail: "没有其他页面链接到这个页面。", noOutlinksDetail: "这个页面还没有链接到其他知识页。", brokenDetail: "目标页面不存在",
    langChinese: "中文", langEnglish: "英文", linkUrlPrompt: "输入网页地址", wikiLinkPrompt: "输入要链接的页面名称",
    undo: "撤销", redo: "重做", insertImage: "插入图片", insertAttachment: "插入附件", resizeImage: "拖动调整图片大小", attachmentUploaded: "附件已插入", attachmentUploadFailed: "附件载入失败",
    deleteProject: "删除知识库", deleteProjectConfirm: "将“{name}”移到回收站吗？知识页和来源文件会一起保留，可以恢复。", projectDeleted: "知识库已删除",
    openKnowledgeBase: "打开", setGlobal: "设为默认", globalSelected: "默认知识库", globalSetSuccess: "已设为默认知识库，其他知识库保持不变", setGlobalConfirm: "把“{name}”设为默认知识库吗？之后需要历史资料时，会优先查询这里。", finishSetupFirst: "完成新手设置后才能设为默认",
    historicalWiki: "历史知识库", verifiedSnapshot: "可恢复的记录", historicalSessionUnit: "个历史会话", pathReused: "原目录已被其他项目复用", conflictVersions: "个冲突版本已保留", recoverWiki: "恢复并打开", recoveringWiki: "正在恢复历史知识库…", wikiRecovered: "知识库已恢复并打开",
    projectCreateFailed: "知识库未能创建。已完成的部分已保留，请重试。",
    sessionCreateFailed: "知识库助手对话没有创建完成，请重试。",
    backToCodex: "所有知识库",
  },
  en: {
    home: "Overview",
    subtitle: "Notes, sources and conversations in one place",
    welcomeTitle: "Your libraries",
    welcomeLead: "Write notes, keep your sources and revisit past decisions.",
    createGuided: "New library", existingWiki: "Open folder",
    howItWorks: "A few ways to start", guideSetup: "Name your library", guideSource: "Add PDF, Word, or Markdown", guideAsk: "Open a note or ask a question",
    pathPlaceholder: "Choose an existing notes folder", openThisProject: "Open library",
    chooseFolder: "Choose folder", folderPickerTitle: "Open a folder", folderPickerHint: "Open an LLM Wiki folder or import notes from Obsidian, Quartz, Docusaurus or Markdown.",
    useThisFolder: "Open this folder", goUp: "Parent folder", homeFolder: "Home", recognizingWiki: "Opening library…",
    wikiLoaded: "Library opened", wikiImported: "Notes imported. Your originals are unchanged.", wikiAlreadyLoaded: "Library opened",
    gettingStarted: "Getting started", setupPurpose: "Choose a purpose", addFirstSource: "Add your first source", organizeKnowledge: "Make notes", readyToAsk: "Ready for questions",
    continueSetup: "Continue setup", addMaterial: "Add sources", organizeNow: "Organize now", openNativeChat: "View conversation",
    sourceGuideTitle: "Add a source", sourceGuideDesc: "Add a PDF, Word document, Markdown, text or image. Your originals are kept.",
    sourceNextTitle: "Sources saved", sourceNextDesc: "Choose Make notes, then follow progress in this Codex conversation.",
    noKnowledgeYet: "No notes yet", noKnowledgeDesc: "Write a note or start with a source.",
    newProject: "New library", openProject: "Open library", recent: "Recent libraries", allProjects: "Libraries", viewAllProjects: "All libraries", showRecentProjects: "Show recent only",
    chat: "Ask & organize", wiki: "Notes", sources: "Sources", search: "Search",
    graph: "Graph", memory: "History", health: "Checks", lint: "Check links", review: "Review", research: "Research",
    skills: "Tools", settings: "Settings", switchProject: "Switch library",
    knowledge: "Notes", files: "Files", selectPage: "Open a note",
    noPages: "No notes yet", noSources: "No source files yet",
    importFiles: "Add files", ingestAll: "Organize all", ingest: "Make notes", delete: "Delete",
    run: "Check links", refresh: "Refresh", ask: "Ask about your notes…", send: "Send", newChat: "New conversation",
    emptyChat: "Ask about your notes", emptyChatDesc: "Find answers in your notes, with links to their sources.",
    searchPlaceholder: "Search note content…", noResults: "No results found",
    graphEmpty: "No connections yet", graphEmptyDesc: "Link notes to see their connections here.",
    lintReady: "Find broken links and notes with no connections.",
    lintClean: "No link issues found", orphan: "No incoming links", broken: "Broken links", noOutlinks: "No outgoing links",
    reviewEmpty: "Nothing to review", accept: "Accept", dismiss: "Dismiss", startResearch: "Research",
    general: "General", webSearch: "Web Search", about: "About", projectInfo: "Library details",
    projectName: "Library name", template: "Template", provider: "Search Provider", apiKey: "API Key",
    searxngUrl: "SearXNG URL", outputLanguage: "Output Language", save: "Save", saved: "Saved",
    storageDirectory: "Knowledge base folder",
    researchPlaceholder: "What would you like to understand?", tasks: "Research history",
    researchEmpty: "Start with a question", created: "Created", pages: "notes", pageUnit: "note", sourceCount: "sources", sourceUnit: "source", resultUnit: "result",
    createTitle: "New library", namePlaceholder: "Product notes, reading…", required: "required",
    language: "Note language", chooseLanguage: "Choose a language", cancel: "Cancel", create: "Create",
    creating: "Creating…", sourceDrop: "Drop files here or choose Add files", uploaded: "File added",
    saving: "Saving…", preview: "Preview", edit: "Edit", close: "Close", confirmDelete: "Click again to confirm",
    loading: "Loading…", retry: "Retry", sourceSize: "Size", modified: "Modified", selected: "Selected",
    sourceOnly: "Markdown", splitView: "Split", richOnly: "Edit", swapColumns: "Swap sides",
    graphOrganize: "Connect related notes", graphOrganizeHint: "Organize categories and add links supported by the notes.",
    graphTypes: "Types & colors", graphConnections: "Connections", graphBidirectional: "Two-way", graphOpenPage: "Open note",
    graphSelectHint: "Click to see connections. Double-click to open the note.", graphSaveTypes: "Save type settings", graphNoConnections: "No connections yet",
    graphCollapsePanel: "Collapse types & colors", graphExpandPanel: "Expand types & colors", graphDragHint: "Drag any node to reposition it", graphImportance: "Importance",
    incoming: "Links here", outgoing: "Links to", relation: "Relation",
    addType: "Add type", typeIdPlaceholder: "Type id, e.g. method",
    you: "You", assistant: "Codex", openClackyChat: "Open Codex chat",
    summarySuggestion: "Summarize this knowledge base", conceptsSuggestion: "What are the key concepts?", gapsSuggestion: "What knowledge gaps remain?",
    noSession: "Connection is not ready. Try again shortly.", conversationUnavailable: "Codex conversation service is unavailable",
    loadFailed: "Some data failed to load", results: "results", sourcesUnit: "sources",
    newPage: "New note", newSubpage: "New child note", newTag: "New category", newArticle: "New note", newChildArticle: "New note here", newChildCategory: "New child category here", pageNamePlaceholder: "Note name", tagNamePlaceholder: "Category name", categoryNamePlaceholder: "Child category name", inlineCreateHint: "Enter to create, Esc to cancel", movePage: "Move / rename", movePrompt: "New page path (must start with wiki/ and end in .md)",
    openCategoryHome: "Open category home", deleteEmptyCategory: "Delete empty category", categoryNotEmpty: "This category is not empty. Remove its contents first.", pageHasChildren: "Move this note’s children before deleting it.", confirmTreeDelete: "Click again to confirm deletion", movedToTrash: "Moved to Trash. You can restore it from this project's Trash.", categoryDeleted: "Empty category deleted",
    trash: "Trash", projectTrash: "Library Trash", trashEmpty: "Trash is empty", trashLoadFailed: "Could not load Trash", restore: "Restore", restoring: "Restoring…", restored: "File restored", deletedAt: "Deleted",
    treeSearch: "Filter notes…", showMorePages: "Show {count} more",
    dragPageHint: "Press and hold, then drag freely; move vertically to sort, horizontally to change depth, or drop on a page to nest", dropInside: "Move inside", dropBefore: "Move before", dropAfter: "Move after", renameTypePrompt: "New category name", renamePageTitlePrompt: "New note title", pageTypeChanged: "Moved to category", pageReordered: "Note moved", typeRenamed: "Category name updated", pageTitleRenamed: "Note renamed", tagCreated: "Category created", tagExists: "Category already exists",
    invalidPagePath: "Page paths must be under wiki/ and end in .md", pageExists: "A note with this name already exists", pagePathConflict: "An article or category already uses this location", unsaved: "Unsaved", unsavedConfirm: "This note has unsaved changes. Discard them?",
    saveConflict: "A newer version exists. Your draft is preserved; compare versions before saving.",
    saveFailed: "Save failed. Your draft remains in this editor.", retrySave: "Retry save", compareVersions: "Read latest and compare", copyDraft: "Copy local draft", draftCopied: "Local draft copied", copyManually: "Automatic copy is unavailable. Select the draft below and press Cmd+C or Ctrl+C.", conflictTitle: "Compare versions", localDraft: "My changes", remoteVersion: "Saved version", versionChoiceHint: "Choose which version to keep, or copy your changes and continue editing.", useRemote: "Use saved version", useLocal: "Keep my changes", readLatest: "Read latest again", conflictChangedAgain: "The page changed again. Your draft is preserved; read the latest version before choosing.", remoteAccepted: "Saved version loaded", invalidPageVersion: "Could not read a valid page version. Please retry.", markDone: "Mark handled",
    replaceSource: "A source with this filename already exists. Replace it?", uploadTooLarge: "Each file must be 25 MB or smaller",
    lintDetail: "Issue details", nativeResearchHint: "Research runs in the current Codex conversation and writes results back to this wiki.",
    settingsHelp: "Change this library’s name, purpose or structure in your Codex conversation.",
    skillsIntro: "Tools for this library.", aboutRuntime: "Notes stay on your computer. Organization and research run in your Codex conversation.",
    sourceOrganizeQueued: "Sent. Follow progress in your Codex conversation.", researchQueued: "Sent. Follow research in your conversation.",
    hostLoading: "Reading knowledge base…", hostUnavailable: "Status unavailable", hostOpen: "Open knowledge base", hostOpenFull: "Open full knowledge base", hostIngest: "Organize attachments", hostLint: "Check knowledge base", hostCapture: "Save discussion", hostCaptureFull: "Save this discussion to your library", hostCaptureQueued: "Summary request sent for “{name}”", hostCaptureNoProject: "No writable knowledge base is available. Create or select one first.", hostCaptureNoSession: "There is no active conversation to summarize", hostSessionActive: "Conversation wiki: {name}", hostPause: "Pause lookup", hostResume: "Resume lookup", hostGlobalActive: "Default library: {name}", hostGlobalPaused: "Default library: {name} · lookup paused", hostGlobalNone: "No default library", globalAllSessions: "Available in every conversation", globalPausedShort: "Lookup paused",
    hostNoProject: "No knowledge base connected · create or open a project", hostStart: "Start", hostContinue: "Continue setup", hostAdd: "Add sources", hostOrganize: "Organize now",
    errorTitle: "This view could not open",
    zoomIn: "Zoom in", zoomOut: "Zoom out", resetView: "Reset view", graphReference: "Reference", graphTwoWay: "Two-way relation",
    pageNotFound: "Note not found", untitled: "Untitled", auto: "Auto",
    statusPending: "Pending", statusRunning: "Running", statusCompleted: "Completed", statusError: "Failed",
    orphanDetail: "No other pages link to this page.", noOutlinksDetail: "This page has no links to other knowledge pages.", brokenDetail: "Target page does not exist",
    langChinese: "Chinese", langEnglish: "English", linkUrlPrompt: "Enter the web address", wikiLinkPrompt: "Enter the page name to link",
    undo: "Undo", redo: "Redo", insertImage: "Insert image", insertAttachment: "Insert attachment", resizeImage: "Drag to resize image", attachmentUploaded: "Attachment inserted", attachmentUploadFailed: "Attachment upload failed",
    deleteProject: "Delete knowledge base", deleteProjectConfirm: "Move “{name}” to Trash? Its pages and sources remain recoverable.", projectDeleted: "Knowledge base deleted",
    openKnowledgeBase: "Open", setGlobal: "Set as default", globalSelected: "Default library", globalSetSuccess: "Default library saved", setGlobalConfirm: "Use “{name}” when earlier knowledge is needed?", finishSetupFirst: "Finish setting up this library first",
    historicalWiki: "Historical wiki", verifiedSnapshot: "Last verified snapshot", historicalSessionUnit: "historical sessions", pathReused: "original folder was reused", conflictVersions: "conflicting versions preserved", recoverWiki: "Restore & open", recoveringWiki: "Restoring historical wiki…", wikiRecovered: "Historical wiki restored safely and opened",
    projectCreateFailed: "The library could not be created. Completed work is kept. Try again.",
    sessionCreateFailed: "The conversation could not open. Try again.",
    backToCodex: "All libraries",
  },
}

const API_ERRORS_ZH = {
  "A Wiki Assistant session is required": "需要先打开一个知识库助手对话",
  "Current Wiki Assistant is busy": "当前知识库助手正在回答，请等它回答完再新建知识库",
  "Existing wiki could not be loaded": "已有知识库没有加载成功，请重试",
  "A project with this name already exists": "同名项目已经存在",
  "A source with this filename already exists": "同名来源已经存在",
  "Clipped content is larger than 25 MB": "网页剪藏内容不能超过 25 MB",
  "Destination already exists": "目标页面已经存在",
  "A page already uses the same sidebar location": "同名文章或分类已占用这个位置",
  "kind must be page or category": "节点类型只能是文章或分类",
  "Request kind must match frontmatter kind": "请求中的节点类型与页面元数据不一致",
  "Categories must use an index.md landing page": "分类必须使用 index.md 作为分类首页",
  "Choose either a parent page or a parent directory, not both": "只能选择一个父文章或父分类",
  "New items can only be created within the three-level knowledge tree": "最多只能新建到三级目录；旧知识库中已有的更深内容仍可正常打开和编辑",
  "Child items must be created below their selected parent": "子项必须创建在所选父页面下面",
  "New items must be created exactly one level beneath their selected parent": "新内容必须紧接在所选父页面的下一层",
  "Child items must be created at the second visible content level": "子项必须创建在所选父项的下一层",
  "Items without a parent must be created at the first visible content level": "未选择父项时只能在分类根层创建",
  "New items can only be created beneath a first-level parent": "只能在一级文章或分类下面继续创建",
  "Parent page not found": "所选父文章不存在，请刷新后重试",
  "Parent directory not found": "所选父分类不存在，请刷新后重试",
  "Invalid parent directory": "父分类路径无效",
  "Parent and child must use the same category": "父项和子项必须属于同一个分类",
  "A page cannot be moved inside itself": "页面不能移动到自己或自己的后代下面",
  "Pages can only be moved within three page levels": "页面最多只能形成父、子、孙三级结构",
  "Drop target is not in the selected parent": "目标位置已经变化，请刷新后重试拖动",
  "Invalid parent path": "父页面路径无效",
  "Invalid sidebar subtree": "页面子树结构无效，无法移动",
  "New item must be created beneath the selected parent": "新内容必须创建在所点击的父项下面",
  "Remove or move child items before deleting this parent": "该项下面还有内容，请先移动或删除子项",
  "Move child items before moving this parent": "该项下面还有内容，请先移动子项再移动父项",
  "Moves beyond the three-level tree must preserve or reduce an existing legacy depth": "不能把页面移动到新的四级目录；旧深层页面只能保持或减少原有深度",
  "Move or delete the articles in this category first": "该分类中还有文章，请先移动或删除它们",
  "Category not found": "分类不存在",
  "type is required": "缺少分类",
  "File not found": "文件不存在",
  "Invalid base64 content": "文件内容损坏，无法上传",
  "Invalid filename": "文件名无效",
  "Invalid onboarding request": "新手建库请求无效，请重新开始",
  "Invalid page type": "页面分类无效",
  "Invalid path": "路径无效",
  "Invalid source path": "来源路径无效",
  "Invalid wiki page path": "知识页路径无效",
  "Not a file": "目标不是文件",
  "Not an LLM Wiki project": "这个目录不是完整的 LLM Wiki 项目",
  "No global knowledge base is selected": "还没有选择默认知识库",
  "No Markdown wiki found": "这个文件夹里没有找到 Markdown 知识页",
  "Only managed projects can be deleted": "只能删除由此扩展创建的项目",
  "Project name is required": "请输入知识库名称",
  "Project not found": "项目不存在",
  "Project path is required": "请输入项目路径",
  "Wiki contains too many files": "这个知识库文件太多，暂时无法一次加载",
  "Session agent is unavailable": "当前对话助手暂不可用",
  "Session not found": "找不到当前对话",
  "Session id is required": "当前没有可归纳的对话",
  "session is busy": "当前对话正在回复，请等它完成后再归纳",
  "Finish onboarding before summarizing this conversation": "请先完成这个知识库的新手设置，再归纳对话",
  "Recovery id is required": "缺少历史知识库恢复标识",
  "Historical knowledge base is no longer recoverable": "这个历史知识库当前无法恢复，可能已恢复或恢复来源已移动",
  "Recovery destination already exists": "这个历史知识库已经恢复，请刷新列表后重新打开",
  "Untrusted request origin": "请求来源不受信任",
  "Wiki Assistant project binding failed": "知识库助手没有正确绑定到知识库",
  "Wiki Assistant working directory is incorrect": "知识库助手连接到了错误的目录",
  "Wiki Assistant could not be started": "知识库助手没有启动成功，请确认 Codex 已更新到最新版后重试",
  "Knowledge base was created, but the Wiki Assistant session could not be created": "知识库已经创建并保留，但助手对话没有创建成功。请重试，系统会从原进度继续。",
  "Knowledge base and conversation were created, but the Wiki Assistant could not be started": "知识库和助手对话已经创建并保留，但助手暂时没有启动。可以进入对话后重新开始引导。",
  "Working directory does not exist": "当前工作目录不存在",
  "Working directory is not writable": "当前工作目录不能写入",
  "Working directory is required": "缺少当前工作目录",
  "Source file not found": "来源文件不存在",
  "Source is larger than 25 MB": "单个来源文件不能超过 25 MB",
  "Source not found": "来源文件不存在",
  "Symbolic links are not allowed in managed paths": "知识库路径中不能使用符号链接",
  "This Codex conversation is not connected to an LLM Wiki project yet. Create or open one first.": "当前 Codex 对话还没有连接知识库，请先创建或打开一个项目",
  "This page changed after you opened it. Reload before saving so newer changes are not overwritten.": "页面已被其他操作修改，请重新加载后再编辑，避免覆盖新内容",
  "filename is required": "缺少文件名",
  "Finish onboarding before setting this knowledge base as global": "完成新手设置后才能设为默认知识库",
  "from and to are required": "缺少原路径或目标路径",
  "id and action are required": "缺少审核项目或操作",
  "node is required": "请选择图谱节点",
  "path is required": "缺少文件路径",
  "q is required": "请输入搜索内容",
  "settings must be an object": "设置格式无效",
  "source_path is required": "请选择来源文件",
  "source_paths array is required": "请选择要整理成笔记的来源文件",
  "topic is required": "请输入研究主题",
  "url and content are required": "网页地址和内容不能为空",
  "action is required": "缺少操作类型",
  "target_type is required": "请选择目标分类",
  "title is required": "请输入标题",
  "title or type is required": "请修改标题或分类",
  "Invalid action. Use: complete, dismiss, research": "审核操作无效",
  "Item not found": "审核项目不存在",
}

function localizedError(message) {
  return language() === "zh" ? API_ERRORS_ZH[message] || message : message
}

const TYPE_META = {
  index: { zh: "首页", en: "Index", color: "#0f766e", order: 0 },
  entity: { zh: "实体", en: "Entities", color: "#3b82f6", order: 1 },
  concept: { zh: "概念", en: "Concepts", color: "#a855f7", order: 2 },
  source: { zh: "来源摘要", en: "Source Notes", color: "#f97316", order: 3 },
  query: { zh: "研究", en: "Queries", color: "#22c55e", order: 4 },
  synthesis: { zh: "综合", en: "Synthesis", color: "#ef4444", order: 5 },
  feature: { zh: "功能", en: "Features", color: "#ca8a04", order: 10 },
  troubleshooting: { zh: "故障排查", en: "Troubleshooting", color: "#2563eb", order: 11 },
  extension: { zh: "扩展", en: "Extensions", color: "#0f766e", order: 12 },
  integration: { zh: "集成", en: "Integrations", color: "#d97706", order: 13 },
  "getting-started": { zh: "入门", en: "Getting Started", color: "#ca8a04", order: 14 },
  skill: { zh: "工具", en: "Tools", color: "#ea580c", order: 15 },
  community: { zh: "社区", en: "Community", color: "#c026d3", order: 16 },
  overview: { zh: "概览", en: "Overview", color: "#9333ea", order: 17 },
  "best-practice": { zh: "最佳实践", en: "Best Practices", color: "#ca8a04", order: 18 },
  method: { zh: "方法", en: "Methods", color: "#0891b2", order: 20 },
  person: { zh: "人物", en: "People", color: "#7c3aed", order: 21 },
  claim: { zh: "观点", en: "Claims", color: "#db2777", order: 22 },
  event: { zh: "事件", en: "Events", color: "#ea580c", order: 23 },
  decision: { zh: "决策", en: "Decisions", color: "#16a34a", order: 24 },
  tool: { zh: "工具", en: "Tools", color: "#4f46e5", order: 25 },
  dataset: { zh: "数据集", en: "Datasets", color: "#0f766e", order: 26 },
  organization: { zh: "组织", en: "Organizations", color: "#c026d3", order: 27 },
  log: { zh: "更新日志", en: "Change Log", color: "#64748b", order: 98 },
  other: { zh: "其他", en: "Other", color: "#94a3b8", order: 99 },
}

function language() { return getUiLanguage() }

function useHostLanguage() {
  const [lang, setLang] = useState(language)
  useEffect(() => {
    const update = () => setLang(language())
    document.addEventListener("langchange", update)
    window.addEventListener("storage", update)
    return () => { document.removeEventListener("langchange", update); window.removeEventListener("storage", update) }
  }, [])
  return lang
}

async function api(path, options = {}) {
  if (isNativeHost()) {
    try { return await nativeApi(path, options, options.projectPath === undefined ? activeProjectPath : options.projectPath) }
    catch (error) { error.apiMessage = error.message; error.message = localizedError(error.message); error.stage = error.data?.stage; throw error }
  }
  const headers = { ...(options.headers || {}) }
  headers["Accept-Language"] ||= language()
  if (options.body) headers["Content-Type"] = "application/json"
  const requestSessionId = options.sessionId === undefined ? activeSessionId : options.sessionId
  const requestProjectPath = options.projectPath === undefined ? activeProjectPath : options.projectPath

  if (requestProjectPath && !headers[PROJECT_PATH_HEADER] && !headers["X-LLM-Wiki-Project"]) {
    headers[PROJECT_PATH_HEADER] = encodeProjectPathHeader(requestProjectPath)
  }
  const response = await fetch(`${API}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : {} } catch { data = { error: text } }
  if (!response.ok) {
    const message = data?.error || data?.message || `HTTP ${response.status}`
    const error = new Error(localizedError(message))
    error.status = response.status
    error.apiMessage = message
    error.data = data
    error.stage = data?.stage
    error.requestId = data?.request_id
    throw error
  }
  return data
}

async function selectHostSession(_unused, message) {
  if (message) return showCodexRequest(message)
}
async function showCodexRequest(message, projectPath=activeProjectPath, context={}) {
  const prompt = `$llm-wiki ${uiText("请处理知识库", "Use library")} ${projectPath || uiText("当前知识库", "current library")}\n${message.replace(/\/llm-wiki-/g, "$llm-wiki-")}`
  await askCodex(prompt, {selectedPage:null,revision:null,...context,knowledgeBase:projectPath})
}


function formatBytes(bytes = 0) {
  if (!Number.isFinite(Number(bytes)) || Number(bytes) <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const index = Math.min(Math.floor(Math.log(Number(bytes)) / Math.log(1024)), units.length - 1)
  return `${(Number(bytes) / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`
}

function fileToPayload(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve({ filename: file.name, content: String(reader.result).split(",")[1] || "", encoding: "base64" })
    reader.onerror = () => reject(reader.error || new Error(`Failed to read ${file.name}`))
    reader.readAsDataURL(file)
  })
}

async function preferredImageWidth(file) {
  try {
    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(file)
      const width = bitmap.width
      bitmap.close?.()
      return normalizeImageWidth(Math.min(width, 720))
    }
  } catch {}
  return 720
}

function wikiAssetUrl(path, { download = false } = {}) {
  const params = new URLSearchParams({ path })
  if (activeSessionId) params.set("session_id", activeSessionId)
  if (activeProjectPath) params.set("project", activeProjectPath)
  if (download) params.set("download", "1")
  return `${API}/wiki/asset?${params.toString()}`
}

function flattenTree(nodes, parentType = "other") {
  const out = []
  for (const node of nodes || []) {
    const guessed = node.is_dir ? singularType(node.name) : (node.type || parentType)
    if (node.is_dir) out.push(...flattenTree(node.children || [], guessed))
    else if (String(node.name || "").toLowerCase().endsWith(".md")) {
      out.push({
        ...node,
        type: node.type || guessed,
        title: node.title || String(node.name).replace(/\.md$/i, "").replace(/[-_]+/g, " "),
      })
    }
  }
  return out
}

function singularType(name = "") {
  const n = String(name).toLowerCase()
  if (n === "entities") return "entity"
  if (n === "concepts") return "concept"
  if (n === "sources") return "source"
  if (n === "queries") return "query"
  if (n === "synthesis") return "synthesis"
  if (!n) return "other"
  return n.replace(/ies$/, "y").replace(/s$/, "")
}

function pageSlug(text = "") {
  return String(text).toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/[\s_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || `untitled-${Date.now()}`
}

function pageTitle(page) {
  return page?.frontmatter?.title || page?.title || String(page?.path || "").split("/").pop()?.replace(/\.md$/i, "") || I18N[language()].untitled
}

function countUnit(count, singular, plural) {
  return Number(count) === 1 ? singular : plural
}

function localizedProjectLanguage(value, tx) {
  const normalized = String(value || "").toLowerCase()
  if (normalized.startsWith("zh") || normalized.startsWith("chinese")) return tx.langChinese
  if (normalized.startsWith("en") || normalized.startsWith("english")) return tx.langEnglish
  return tx.auto
}

function visibleAssistantContent(content = "") {
  return String(content)
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "")
    .replace(/<think(?:ing)?>[\s\S]*$/gi, "")
    .trim()
}

function Empty({ icon: Icon = FileText, title, description, action }) {
  return <div className="lw-empty"><Icon /><h3>{title}</h3>{description && <p>{description}</p>}{action}</div>
}

function LlmWikiLogo({ className = "" }) {
  return <img src={llmWikiLogo} className={`lw-brand-icon ${className}`} alt="" aria-hidden="true" draggable="false" />
}

function Loading({ text }) {
  return <div className="lw-empty"><div className="lw-spinner" /><p>{text}</p></div>
}

function workspaceDialog(message, initialValue=null) {
  return new Promise(resolve=>{
    const previous=document.activeElement
    const selection=window.getSelection()
    const range=selection?.rangeCount?selection.getRangeAt(0).cloneRange():null
    const dialog=document.createElement("dialog")
    dialog.className="lw-native-dialog"
    const title=document.createElement("p");title.textContent=message;dialog.append(title)
    let input=null
    if(initialValue!==null){input=document.createElement("input");input.value=initialValue;input.setAttribute("aria-label",message);dialog.append(input)}
    const controls=document.createElement("div");controls.className="lw-native-actions"
    const cancel=document.createElement("button");cancel.textContent=language()==="zh"?"取消":"Cancel"
    const accept=document.createElement("button");accept.textContent=language()==="zh"?"确定":"Continue"
    function finish(value){dialog.close();dialog.remove();previous?.focus();if(range){selection.removeAllRanges();selection.addRange(range)}resolve(value)}
    cancel.onclick=()=>finish(input?null:false);accept.onclick=()=>finish(input?input.value:true)
    dialog.addEventListener("cancel",event=>{event.preventDefault();finish(input?null:false)})
    dialog.addEventListener("keydown",event=>{if(event.key==="Enter" && event.target===input){event.preventDefault();finish(input.value)}})
    controls.append(cancel,accept);dialog.append(controls);document.body.append(dialog);dialog.showModal();(input || cancel).focus()
  })
}
const confirmAction=message=>workspaceDialog(message)
const promptValue=(message,value="")=>workspaceDialog(message,value)

function FolderPicker({tx,onChoose,onClose,initialPath=""}) {
 const [path,setPath]=useState(initialPath),[listing,setListing]=useState(null),[error,setError]=useState(""),[loading,setLoading]=useState(false)
 const zh=language()==="zh"
 async function browse(value){setLoading(true);setError("");try{const data=await api("/folders?"+new URLSearchParams({path:value}));setPath(data.path);setListing(data)}catch(e){setError(e.message)}finally{setLoading(false)}}
 return <Modal title={zh?"打开文件夹":"Open folder"} onClose={onClose} busy={loading}><form onSubmit={e=>{e.preventDefault();if(path.trim())onChoose(path.trim())}}><div className="lw-flow-body"><label htmlFor="existing-folder">{zh?"知识库文件夹":"Library folder"}</label><input autoFocus onKeyDown={e=>{if(e.key==="Enter"&&!e.isComposing&&path.trim()&&!loading){e.preventDefault();onChoose(path.trim())}}} id="existing-folder" className="lw-input" value={path} onChange={e=>{setPath(e.target.value);setListing(null)}} placeholder={zh?"粘贴文件夹的完整路径":"Paste the full folder path"}/><p className="lw-help">{zh?"可打开 LLM Wiki、Obsidian 或 Markdown 文件夹。导入普通文件夹时会创建副本。":"Open an LLM Wiki, Obsidian or Markdown folder. Other folders are imported as a copy."}</p><button type="button" className="lw-btn" disabled={!path.trim()||loading} onClick={()=>browse(path)}><FolderOpen/>{zh?"查看子文件夹":"Browse subfolders"}</button>{listing&&<div className="lw-folder-list"><button type="button" className="lw-btn ghost" disabled={listing.parent===listing.path||loading} onClick={()=>browse(listing.parent)}><ArrowUp/>{tx.goUp}</button>{listing.folders.map(folder=><button type="button" className="lw-folder-option" disabled={loading} key={folder.path} onClick={()=>browse(folder.path)}><FolderOpen/>{folder.name}<ChevronRight/></button>)}</div>}{error&&<p className="lw-form-error" role="alert">{error}</p>}</div><footer><span/><button type="button" className="lw-btn" disabled={loading} onClick={onClose}>{tx.cancel}</button><button type="button" className="lw-btn primary" disabled={!path.trim()||loading} onClick={()=>onChoose(path.trim())}>{tx.openProject}</button></footer></form></Modal>
}

function TrashDialog({ project, tx, toast, onClose, onRestored }) {
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [restoringPath, setRestoringPath] = useState("")

  useEffect(() => {
    let active = true
    setLoading(true)
    api("/trash", {projectPath:project.path})
      .then((data) => {
        if (!active) return
        const wikiRoot = `${String(project.path).replace(/\/+$/, "")}/wiki/`
        setFiles((data.files || []).filter((file) => String(file.original_path || "").startsWith(wikiRoot) || String(file.original_path || "").startsWith(`${project.path}/raw/sources/`)))
      })
      .catch((error) => { if (active) toast(`${tx.trashLoadFailed}: ${error.message}`, "error") })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [project.path, toast, tx.trashLoadFailed])

  async function restore(file) {
    const originalPath = String(file.original_path || "")
    if (!originalPath || restoringPath) return
    setRestoringPath(originalPath)
    try {
      await api("/trash/restore", {
        projectPath:project.path,
        method: "POST",
        body: { project_root: project.path, original_path: originalPath },
      })
      setFiles((items) => items.filter((item) => item.original_path !== originalPath))
      await onRestored(originalPath)
      toast(tx.restored)
    } catch (error) {
      toast(error.message, "error")
    } finally {
      setRestoringPath("")
    }
  }

  const wikiRoot = `${String(project.path).replace(/\/+$/, "")}/wiki/`
  return <div className="lw-overlay" role="dialog" aria-modal="true" aria-label={tx.projectTrash}>
    <div className="lw-dialog lw-trash-dialog">
      <div className="lw-dialog-head"><Trash2 />{tx.projectTrash}<button className="lw-btn ghost icon" onClick={onClose} title={tx.close}><X /></button></div>
      <div className="lw-dialog-body lw-trash-body">
        {loading
          ? <Loading text={tx.loading} />
          : files.length
            ? <div className="lw-trash-list">{files.map((file) => {
              const originalPath = String(file.original_path || "")
              const relative = originalPath.startsWith(wikiRoot) ? originalPath.slice(wikiRoot.length) : originalPath
              const restoring = restoringPath === originalPath
              const deletedAt = file.deleted_at ? new Date(file.deleted_at).toLocaleString() : "—"
              return <div className="lw-trash-row" key={`${originalPath}-${file.trash_file || file.deleted_at}`}>
                <FileText />
                <div className="lw-trash-main"><strong title={originalPath}>{relative}</strong><small>{tx.deletedAt} {deletedAt} · {formatBytes(file.file_size)}</small></div>
                <button className="lw-btn sm" disabled={Boolean(restoringPath)} onClick={() => restore(file)}>{restoring ? <LoaderCircle className="lw-spin" /> : <RefreshCw />}{restoring ? tx.restoring : tx.restore}</button>
              </div>
            })}</div>
            : <div className="lw-trash-empty"><Trash2 /><span>{tx.trashEmpty}</span></div>}
      </div>
      <div className="lw-dialog-foot"><button className="lw-btn" onClick={onClose}>{tx.close}</button></div>
    </div>
  </div>
}

function RecentProjectRow({ project, tx, onOpen, onSetGlobal, onDelete }) {
  const menu=useRef(null)
  useEffect(()=>{const dismiss=e=>{if(menu.current?.open&&!menu.current.contains(e.target))menu.current.open=false};const escape=e=>{if(e.key==='Escape'&&menu.current?.open){menu.current.open=false;menu.current.querySelector('summary')?.focus()}};document.addEventListener('pointerdown',dismiss);document.addEventListener('keydown',escape);return()=>{document.removeEventListener('pointerdown',dismiss);document.removeEventListener('keydown',escape)}},[])

  const globalLabel = project.global_enabled ? tx.globalSelected : `${tx.globalSelected} · ${tx.globalPausedShort}`
  const recoveryDetails = project.recoverable
    ? [
        tx.verifiedSnapshot,
        `${project.source_session_count || 1} ${tx.historicalSessionUnit}`,
        project.path_reused ? tx.pathReused : null,
        project.conflict_count ? `${project.conflict_count} ${tx.conflictVersions}` : null,
      ].filter(Boolean).join(" · ")
    : null
  const recoveryPaths = Array(project.original_paths || [project.original_path || project.path]).filter(Boolean).join("\n")
  return <div className="lw-recent">
    <button className="lw-recent-open" onClick={() => onOpen(project)}>
      {project.recoverable ? <RefreshCw size={18} className="lw-muted" /> : <BookOpen size={18} className="lw-muted" />}
      <span className="lw-recent-main"><span className="lw-recent-title-line"><span className="lw-recent-name">{project.name}</span>{project.recoverable && <span className="lw-recent-badge">{tx.historicalWiki}</span>}</span><span className="lw-recent-path" title={project.recoverable ? recoveryPaths : (project.original_path || project.path)}>{recoveryDetails || (project.global_selected ? globalLabel : tx.openThisProject)}</span></span>
      <span className="lw-recent-meta">{project.page_count || 0} {countUnit(project.page_count, tx.pageUnit, tx.pages)} · {project.source_count || 0} {countUnit(project.source_count, tx.sourceUnit, tx.sourceCount)}</span>
    </button>
    <details className="lw-library-options" ref={menu}><summary aria-label={`${uiText("知识库选项","Library options")}: ${project.name}`} title={uiText("知识库选项","Library options")}><MoreHorizontal/></summary><div className="lw-library-options-menu">
      {project.recoverable?<button onClick={()=>{menu.current.open=false;onOpen(project)}}><RefreshCw/>{tx.recoverWiki}</button>:project.global_selected?<span><CheckCircle2/>{globalLabel}</span>:<button onClick={()=>{menu.current.open=false;onSetGlobal(project)}}><CheckCircle2/>{tx.setGlobal}</button>}
      {!project.recoverable&&project.managed!==false&&<button className="lw-destructive" onClick={()=>{menu.current.open=false;onDelete(project)}}><Trash2/>{tx.deleteProject}</button>}
    </div></details>
  </div>
}

function Welcome({ projects, lang, tx, onSelect, onSetGlobal, onNew, onOpenPath, toast, creating }) {
  const [showPicker, setShowPicker] = useState(false)
  const [path, setPath] = useState("")
  const [opening, setOpening] = useState(false)
  const [deletedPaths, setDeletedPaths] = useState(() => new Set())
  const availableProjects = projects.filter((project) => !deletedPaths.has(project.path))

  async function openPathValue(value) {
    const selectedPath = value.trim()
    if (!selectedPath || opening) return
    setOpening(true)
    try { await onOpenPath(selectedPath) } catch (error) { toast(error.message, "error") } finally { setOpening(false) }
  }

  async function onDelete(item) {
    const message = tx.deleteProjectConfirm.replace("{name}", item.name || item.path)
    if (!(await confirmAction(message))) return
    try {
      await api("/projects", { method: "DELETE", body: { path: item.path } })
      setDeletedPaths((before) => new Set([...before, item.path]))
      if (item.global_selected) window.dispatchEvent(new CustomEvent(GLOBAL_ACCESS_EVENT, { detail: { project: null, enabled: false } }))
      toast(tx.projectDeleted)
      window.dispatchEvent(new CustomEvent(WORKSPACE_OPEN_EVENT,{detail:{mode:"home"}}))
    } catch (error) { toast(error.message, "error") }
  }

  return <div className="lw-welcome"><div className="lw-welcome-inner">

    <div className="lw-welcome-copy"><ProductSignature lang={lang}/><h1>{tx.welcomeTitle}</h1><p>{tx.welcomeLead}</p></div>

    <div className="lw-welcome-actions"><button className="lw-btn primary" disabled={creating || opening} onClick={onNew}>{creating ? <LoaderCircle className="lw-spin" /> : <Plus />}{creating ? tx.creating : tx.createGuided}</button><button className="lw-btn" disabled={creating || opening} onClick={() => setShowPicker(true)}>{opening ? <LoaderCircle className="lw-spin" /> : <FolderOpen />}{opening ? tx.recognizingWiki : tx.existingWiki}</button></div>
    {availableProjects.length > 0 && <div className="lw-recents"><div className="lw-recents-title"><span className="lw-recents-title-label"><BookOpen />{tx.allProjects}</span><span>{availableProjects.length}</span></div><div className="lw-recent-list">{availableProjects.map((project) => <RecentProjectRow key={project.recoverable ? project.recovery_id : project.path} project={project} tx={tx} onOpen={onSelect} onSetGlobal={onSetGlobal} onDelete={onDelete} />)}</div></div>}
    {showPicker && <FolderPicker initialPath={path} tx={tx} onClose={() => setShowPicker(false)} onChoose={(selectedPath) => { setPath(selectedPath); setShowPicker(false); openPathValue(selectedPath) }} />}
  </div></div>
}

const NAV = [
  ["home", Home], ["wiki", FileText], ["search", Search], ["sources", FolderOpen], ["graph", Network], ["memory", History], ["research", Globe2], ["health", ClipboardCheck], ["chat", MessageSquare],
]

function IconRail({ view, setView, tx, switchProject }) {
  return <div className="lw-rail">
    
    <div className="lw-rail-main">{NAV.map(([id, Icon]) => <button title={tx[id]} aria-label={tx[id]} key={id} className={`lw-icon-btn ${view === id ? "active" : ""}`} onClick={() => setView(id)}><Icon /><span className="lw-rail-label">{tx[id]}</span></button>)}

    </div>
    <div className="lw-rail-bottom"><button aria-label={tx.settings} title={tx.settings} className={`lw-icon-btn ${view === "settings" ? "active" : ""}`} onClick={() => setView("settings")}><Settings /></button><button aria-label={tx.switchProject} title={tx.switchProject} className="lw-icon-btn" onClick={switchProject}><ArrowLeftRight /></button></div>
  </div>
}

const LARGE_TREE_THRESHOLD = 800
const TREE_BATCH_SIZE = 160

function InlineTreeCreate({ kind, depth = 0, value, setValue, busy, tx, onSubmit, onCancel }) {
  const category = kind === "type" || kind === "category"
  const Icon = category ? FolderPlus : CornerDownRight
  function submit() { if (!busy && value.trim()) return onSubmit() }
  function keyDown(event) {
    if (event.defaultPrevented || event.repeat || event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229) return
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!busy) onCancel() }
    else if (event.key === "Enter" && !event.altKey && !event.shiftKey) { event.preventDefault(); event.stopPropagation(); return submit() }
  }
  return <form className="lw-tree-create" style={{ "--tree-depth": depth }} onSubmit={(event) => event.preventDefault()}>
    <Icon />
    <input autoFocus value={value} disabled={busy} onChange={(event) => setValue(event.target.value)} onKeyDown={keyDown} placeholder={kind === "type" ? tx.tagNamePlaceholder : kind === "category" ? tx.categoryNamePlaceholder : tx.pageNamePlaceholder} aria-label={category ? tx.newChildCategory : tx.newArticle} title={tx.inlineCreateHint} />
    <button type="button" disabled={busy || !value.trim()} onClick={submit} title={tx.create} aria-label={tx.create}><CheckCircle2 /></button>
    <button type="button" disabled={busy} onClick={onCancel} title={tx.cancel} aria-label={tx.cancel}><X /></button>
  </form>
}

function InlineTreeTitleInput({ value, ariaLabel, onCommit, onCancel }) {
  const [draft, setDraft] = useState(value || "")
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)
  const finishedRef = useRef(false)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  async function commit() {
    if (finishedRef.current || busy) return
    const title = draft.trim()
    if (!title || title === String(value || "").trim()) { finishedRef.current = true; onCancel(); return }
    finishedRef.current = true
    setBusy(true)
    const saved = await onCommit(title)
    if (saved) { onCancel(); return }
    finishedRef.current = false
    setBusy(false)
    requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select() })
  }

  return <input ref={inputRef} className="lw-tree-title-input" value={draft} disabled={busy} aria-label={ariaLabel} onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finishedRef.current = true; onCancel() }
    else if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur() }
  }} />
}

function sidebarNodeKey(node) {
  return node?.key || node?.page?.path || node?.directory || ""
}

function sidebarNodeTrail(nodes, pagePath, before = []) {
  for (const node of nodes || []) {
    const trail = [...before, sidebarNodeKey(node)]
    if (node.page?.path === pagePath) return trail
    const nested = sidebarNodeTrail(node.children, pagePath, trail)
    if (nested.length) return nested
  }
  return []
}

function Sidebar({ projectPath, pages, selectedPath, tx, lang, openPage, leftWidth, typeConfig, sidebarOrder, newPageRequest, onConsumeNewPageRequest, onCreatePage, onCreateType, onDeleteNode, onMovePageTree, onRenameType, onRenamePage, onOpenTrash, onCloseMobile }) {
  const [expanded, setExpanded] = useState(() => new Set(["entity", "concept", "source", "query", "other"]))
  const [expandedNodes, setExpandedNodes] = useState(() => new Set())
  const [treeQuery, setTreeQuery] = useState("")
  const [visibleLimits, setVisibleLimits] = useState({})
  const [creation, setCreation] = useState(null)
  const [creationValue, setCreationValue] = useState("")
  const [creating, setCreating] = useState(false)
  const [creationError, setCreationError] = useState("")
  const [renaming, setRenaming] = useState(null)
  const [deleteArmedKey, setDeleteArmedKey] = useState(null)
  const [draggingPath, setDraggingPath] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)
  const [dragVisual, setDragVisual] = useState(null)
  const deleteTimerRef = useRef(null)
  const manualDragRef = useRef(null)
  const hoverExpandTimerRef = useRef(null)
  const suppressClickRef = useRef(null)
  const treeRef = useRef(null)
  const creatingRef = useRef(false)
  const visiblePages = useMemo(() => knowledgePages(pages), [pages])
  const allGrouped = useMemo(() => {
    const map = new Map()
    for (const page of visiblePages) {
      if (!map.has(page.type)) map.set(page.type, [])
      map.get(page.type).push(page)
    }
    for (const type of typeConfig || []) if (type?.id && !map.has(type.id)) map.set(type.id, [])
    return [...map.entries()]
      .sort(([a], [b]) => (TYPE_META[a]?.order ?? 99) - (TYPE_META[b]?.order ?? 99))
      .map(([type, items]) => [type, sortSidebarItems(items, type, sidebarOrder)])
  }, [visiblePages, sidebarOrder, typeConfig])
  const normalizedTreeQuery = treeQuery.trim().toLocaleLowerCase()
  const pageTypeKey = allGrouped.map(([type]) => type).join("\0")
  useEffect(() => {
    if (visiblePages.length > LARGE_TREE_THRESHOLD) setExpanded(new Set())
    else setExpanded(new Set(allGrouped.map(([type]) => type)))
    setVisibleLimits({})
  }, [pageTypeKey, visiblePages.length > LARGE_TREE_THRESHOLD])
  useEffect(() => {
    function clearHoverTimer() {
      if (hoverExpandTimerRef.current) window.clearTimeout(hoverExpandTimerRef.current.id)
      hoverExpandTimerRef.current = null
    }
    function scheduleExpand(key) {
      if (!key || hoverExpandTimerRef.current?.key === key) return
      clearHoverTimer()
      const id = window.setTimeout(() => {
        setExpandedNodes((before) => before.has(key) ? before : new Set([...before, key]))
        hoverExpandTimerRef.current = null
      }, 420)
      hoverExpandTimerRef.current = { id, key }
    }
    function move(event) {
      const drag = manualDragRef.current
      if (!drag || event.pointerId !== drag.pointerId) return
      drag.lastX = event.clientX
      drag.lastY = event.clientY
      if (!drag.active) return
      event.preventDefault()
      const element = document.elementFromPoint(event.clientX, event.clientY)
      const item = element?.closest?.("[data-page-path]")
      const group = item ? null : element?.closest?.("[data-type-id]")
      const tree = treeRef.current
      let target = null
      if (item && item.dataset.pagePath !== drag.page.path) {
        const rect = item.getBoundingClientRect()
        const treeRect = tree?.getBoundingClientRect()
        const rowDepth = Math.max(0, Number(item.dataset.treeDepth || 0))
        const relativeY = (event.clientY - rect.top) / Math.max(rect.height, 1)
        const titleStart = (treeRect?.left || rect.left) + 28 + rowDepth * 17
        const canNest = item.dataset.canHaveChildren === "true"
        const wantsInside = canNest && relativeY >= .24 && relativeY <= .76 && event.clientX >= titleStart
        if (wantsInside) {
          target = {
            type: item.dataset.pageType,
            path: null,
            parent: item.dataset.pagePath,
            position: "inside",
            mode: "inside",
            depth: rowDepth + 1,
            key: item.dataset.treeKey,
          }
        } else {
          const rawDepth = treeRect ? Math.round((event.clientX - treeRect.left - 28) / 17) : rowDepth
          const desiredDepth = Math.max(0, Math.min(rowDepth, rawDepth))
          const ancestors = String(item.dataset.pageAncestors || "").split("\u001f").filter(Boolean)
          const lineage = [...ancestors, item.dataset.pagePath]
          const targetPath = lineage[desiredDepth] || item.dataset.pagePath
          const targetElement = tree?.querySelector?.(`[data-page-path="${CSS.escape(targetPath)}"]`)
          target = {
            type: targetElement?.dataset.pageType || item.dataset.pageType,
            path: targetPath,
            parent: desiredDepth > 0 ? lineage[desiredDepth - 1] : null,
            position: relativeY < .5 ? "before" : "after",
            mode: relativeY < .5 ? "before" : "after",
            depth: desiredDepth,
            key: targetElement?.dataset.treeKey || item.dataset.treeKey,
          }
        }
      } else if (group) {
        target = { type: group.dataset.typeId, path: null, parent: null, position: "end", mode: "root", depth: 0 }
      }
      const draggedRoot = childPageDirectory(drag.page.path)
      if (target?.parent) {
        const parentStem = String(target.parent).replace(/^wiki\//, "").replace(/\.md$/i, "").replace(/\/index$/i, "")
        target.invalid = target.parent === drag.page.path || parentStem === draggedRoot || parentStem.startsWith(`${draggedRoot}/`)
      }
      drag.target = target
      if (target?.type) setExpanded((before) => before.has(target.type) ? before : new Set([...before, target.type]))
      if (target?.mode === "inside" && !target.invalid) scheduleExpand(target.key)
      else clearHoverTimer()
      setDropTarget(target)
      if (drag.frame) cancelAnimationFrame(drag.frame)
      drag.frame = requestAnimationFrame(() => setDragVisual({ title: drag.page.title || pageTitle(drag.page), x: event.clientX, y: event.clientY, mode: target?.mode, invalid: target?.invalid }))
      if (tree) {
        const rect = tree.getBoundingClientRect()
        if (event.clientY < rect.top + 34) tree.scrollTop -= 12
        else if (event.clientY > rect.bottom - 34) tree.scrollTop += 12
      }
    }
    function finish(event) {
      const drag = manualDragRef.current
      if (!drag || (event.pointerId != null && event.pointerId !== drag.pointerId)) return
      manualDragRef.current = null
      if (drag.holdTimer) window.clearTimeout(drag.holdTimer)
      if (drag.frame) cancelAnimationFrame(drag.frame)
      clearHoverTimer()
      document.body.style.userSelect = ""
      document.body.style.cursor = ""
      setDraggingPath(null)
      setDropTarget(null)
      setDragVisual(null)
      if (!drag.active) return
      suppressClickRef.current = drag.page.path
      window.setTimeout(() => { if (suppressClickRef.current === drag.page.path) suppressClickRef.current = null }, 0)
      if (!drag.target?.type || drag.target.invalid) return
      onMovePageTree(drag.page, drag.target)
    }
    function cancel(event) {
      if (event.key === "Escape" && manualDragRef.current) {
        manualDragRef.current.target = null
        finish({ pointerId: manualDragRef.current.pointerId })
      }
    }
    window.addEventListener("pointermove", move, { passive: false })
    window.addEventListener("pointerup", finish)
    window.addEventListener("pointercancel", finish)
    window.addEventListener("keydown", cancel)
    return () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", finish)
      window.removeEventListener("pointercancel", finish)
      window.removeEventListener("keydown", cancel)
      clearHoverTimer()
      if (manualDragRef.current?.holdTimer) window.clearTimeout(manualDragRef.current.holdTimer)
      document.body.style.userSelect = ""
      document.body.style.cursor = ""
    }
  }, [onMovePageTree])

  useEffect(() => {
    if (!newPageRequest?.key || !projectPath || newPageRequest.projectPath !== projectPath || creatingRef.current) return
    beginCreation("page", newPageRequest.parentNode || newPageRequest.parentPage || null, newPageRequest.type || null)
    onConsumeNewPageRequest?.(newPageRequest.key, projectPath)
  }, [newPageRequest?.key, newPageRequest?.projectPath, projectPath, creating])
  useEffect(() => {
    if (!selectedPath) return
    for (const [type, items] of allGrouped) {
      const trail = sidebarNodeTrail(buildSidebarTree(items, type, sidebarOrder), selectedPath)
      if (!trail.length) continue
      setExpanded((before) => new Set([...before, type]))
      setExpandedNodes((before) => new Set([...before, ...trail.slice(0, -1)]))
      break
    }
  }, [selectedPath, allGrouped, sidebarOrder])
  useEffect(() => () => { if (deleteTimerRef.current) window.clearTimeout(deleteTimerRef.current) }, [])

  function toggle(type) {
    setExpanded((before) => { const next = new Set(before); next.has(type) ? next.delete(type) : next.add(type); return next })
  }

  function beginManualDrag(event, page) {
    if (!event.isPrimary || event.button !== 0) return
    const drag = { page, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, active: false, target: null, frame: null, holdTimer: null }
    drag.holdTimer = window.setTimeout(() => {
      if (manualDragRef.current !== drag) return
      drag.active = true
      document.body.style.userSelect = "none"
      document.body.style.cursor = "grabbing"
      setDraggingPath(page.path)
      setDragVisual({ title: page.title || pageTitle(page), x: drag.lastX, y: drag.lastY, mode: null, invalid: false })
    }, 220)
    manualDragRef.current = drag
  }

  function showMore(type, itemCount) {
    setVisibleLimits((before) => ({ ...before, [type]: Math.min(itemCount, (before[type] || TREE_BATCH_SIZE) + TREE_BATCH_SIZE) }))
  }

  function beginCreation(kind, parentNode = null, requestedType = null, parentLevel = 1) {
    if (creatingRef.current) return
    const selectedPage = visiblePages.find((page) => page.path === selectedPath)
    const parentPage = parentNode?.page || (parentNode?.path ? parentNode : null)
    const type = requestedType || parentPage?.type || parentNode?.type || selectedPage?.type || allGrouped[0]?.[0] || "other"
    if (parentNode && parentNode.kind !== "type" && !canCreateSidebarChild(parentNode, parentLevel)) return
    setExpanded((before) => new Set([...before, type]))
    const parentKey = sidebarNodeKey(parentNode)
    if (parentKey && parentNode?.kind !== "type") setExpandedNodes((before) => new Set([...before, parentKey]))
    setTreeQuery("")
    setCreation({ kind, type, parentNode, parentKey })
    setCreationValue("")
    setCreationError("")
  }

  function beginTypeCreate() {
    if (creatingRef.current) return
    setTreeQuery("")
    setCreation({ kind: "type" })
    setCreationValue("")
    setCreationError("")
  }

  async function submitCreation() {
    const title = creationValue.trim()
    if (!title || !creation || creatingRef.current) return
    creatingRef.current = true
    setCreating(true)
    setCreationError("")
    try {
      const created = creation.kind === "type"
        ? await onCreateType(title)
        : await onCreatePage({ title, type: creation.type, parentNode: creation.parentNode, kind: creation.kind })
      if (!created) return
      if (creation.kind === "type") setExpanded((before) => new Set([...before, created]))
      setCreation(null)
      setCreationValue("")
    } catch (error) {
      setCreationError(error?.message || (lang === "zh" ? "创建未完成，请重试。" : "Could not create this item. Try again."))
    } finally {
      creatingRef.current = false
      setCreating(false)
    }
  }

  async function confirmDelete(node) {
    const key = sidebarNodeKey(node)
    if (!key || node.children?.length) return
    if (deleteArmedKey !== key) {
      setDeleteArmedKey(key)
      if (deleteTimerRef.current) window.clearTimeout(deleteTimerRef.current)
      deleteTimerRef.current = window.setTimeout(() => setDeleteArmedKey(null), 4000)
      return
    }
    await onDeleteNode(node)
    setDeleteArmedKey(null)
  }

  function beginPageRename(event, page, key) {
    if (!page) return
    event.preventDefault()
    event.stopPropagation()
    setRenaming({ kind: "page", key })
  }

  function beginTypeRename(event, type) {
    event.preventDefault()
    event.stopPropagation()
    setRenaming({ kind: "type", key: `type:${type}` })
  }

  function renderTreeNode(node, parentLevel = 1, parentPath = null, ancestorPaths = []) {
    const key = sidebarNodeKey(node)
    const level = parentLevel + 1
    const depth = sidebarDisplayDepth(node, parentLevel)
    const page = node.page
    const hasChildren = node.children.length > 0
    const container = node.kind === "category" || node.kind === "node"
    const open = Boolean(normalizedTreeQuery) || expandedNodes.has(key)
    const canCreateChild = canCreateSidebarChild(node, parentLevel)
    const rowClasses = [
      "lw-tree-node",
      container ? "category" : "page",
      selectedPath === page?.path ? "active" : "",
      draggingPath === page?.path ? "dragging" : "",
      dropTarget && dropTarget.path === page?.path ? `drop-${dropTarget.position}` : "",
      dropTarget?.mode === "inside" && dropTarget.parent === page?.path ? "drop-inside" : "",
      dropTarget?.invalid && (dropTarget?.path === page?.path || dropTarget?.parent === page?.path) ? "drop-invalid" : "",
    ].filter(Boolean).join(" ")
    const canDelete = !hasChildren && Boolean(page)
    const deleteTitle = hasChildren ? (container ? tx.categoryNotEmpty : tx.pageHasChildren) : !page ? tx.categoryNotEmpty : deleteArmedKey === key ? tx.confirmTreeDelete : container ? tx.deleteEmptyCategory : tx.delete
    return <React.Fragment key={key}>
      <div {...(page?.path ? { "data-page-path": page.path, "data-page-type": page.type, "data-page-parent": parentPath || "", "data-page-ancestors": ancestorPaths.join("\u001f"), "data-can-have-children": String(canCreateChild) } : {})} data-tree-depth={depth} data-tree-key={key} data-tree-kind={node.kind} className={rowClasses} style={{ "--tree-depth": depth, "--drop-depth": dropTarget?.depth ?? depth }}>
        <button className="lw-tree-chevron" disabled={!hasChildren} title={hasChildren ? tx.selected : undefined} onClick={() => setExpandedNodes((before) => { const next = new Set(before); next.has(key) ? next.delete(key) : next.add(key); return next })}>{hasChildren ? (open ? <ChevronDown /> : <ChevronRight />) : null}</button>
        {renaming?.kind === "page" && renaming.key === key
          ? <span className={`lw-tree-item lw-tree-title-edit ${container ? "lw-tree-category-label" : ""}`}>{container && <FolderOpen />}<InlineTreeTitleInput value={node.title || pageTitle(page)} ariaLabel={tx.renamePageTitlePrompt} onCommit={(title) => onRenamePage(page, title)} onCancel={() => setRenaming(null)} /></span>
          : container
            ? <button title={`${page?.path || node.directory || node.title}${page?.path ? ` · ${tx.dragPageHint}` : ""}`} className="lw-tree-item lw-tree-category-label" onPointerDown={(event) => page && beginManualDrag(event, page)} onClick={() => { if (page && suppressClickRef.current === page.path) { suppressClickRef.current = null; return } setExpandedNodes((before) => { const next = new Set(before); next.has(key) ? next.delete(key) : next.add(key); return next }) }} onDoubleClick={(event) => beginPageRename(event, page, key)}><FolderOpen />{node.title}</button>
            : <button title={`${page?.path || ""} · ${tx.dragPageHint}`} className="lw-tree-item" onPointerDown={(event) => page && beginManualDrag(event, page)} onClick={() => { if (!page) return; if (suppressClickRef.current === page.path) { suppressClickRef.current = null; return } openPage(page.path) }} onDoubleClick={(event) => beginPageRename(event, page, key)}>{node.title || page?.title}</button>}
        <span className="lw-tree-row-actions">
          {container && page?.path && <button className="lw-tree-action" title={tx.openCategoryHome} aria-label={tx.openCategoryHome} onClick={() => openPage(page.path)}><FileText /></button>}
          {container && canCreateChild && <button className="lw-tree-action" title={tx.newChildCategory} aria-label={tx.newChildCategory} onClick={() => beginCreation("category", node, page?.type, level)}><FolderPlus /></button>}
          {canCreateChild && <button className="lw-tree-action" title={container ? tx.newChildArticle : tx.newChildArticle} aria-label={tx.newChildArticle} onClick={() => beginCreation("page", node, page?.type, level)}><FilePlus2 /></button>}
          <button className={`lw-tree-action delete ${deleteArmedKey === key ? "armed" : ""}`} disabled={!canDelete} title={deleteTitle} aria-label={deleteTitle} onClick={() => confirmDelete(node)}><Trash2 /></button>
        </span>
      </div>
      {creation?.parentKey === key && <InlineTreeCreate kind={creation.kind} depth={depth + 1} value={creationValue} setValue={setCreationValue} busy={creating} tx={tx} onSubmit={submitCreation} onCancel={() => setCreation(null)} />}
      {hasChildren && open && node.children.map((child) => renderTreeNode(child, level, page?.path || parentPath, page?.path ? [...ancestorPaths, page.path] : ancestorPaths))}
    </React.Fragment>
  }

  return <div className="lw-sidebar" style={{ "--left-width": `${leftWidth}px` }}>
    <div className="lw-side-heading"><span>{tx.knowledge}</span><div className="lw-side-actions"><button className="lw-side-add" title={tx.newArticle} aria-label={tx.newArticle} onClick={() => beginCreation("page")}><FilePlus2 /></button><button className="lw-side-add" title={tx.newTag} aria-label={tx.newTag} onClick={beginTypeCreate}><FolderPlus /></button><button className="lw-side-add" title={tx.projectTrash} aria-label={tx.projectTrash} onClick={onOpenTrash}><Trash2 /></button><button className="lw-side-add lw-side-close" title={tx.close} aria-label={tx.close} onClick={onCloseMobile}><X /></button></div></div>
    {visiblePages.length > LARGE_TREE_THRESHOLD && <div className="lw-tree-search"><Search /><input value={treeQuery} onChange={(event) => setTreeQuery(event.target.value)} placeholder={tx.treeSearch} />{treeQuery && <button title={tx.close} onClick={() => setTreeQuery("")}><X /></button>}</div>}
    <div className="lw-tree" ref={treeRef}>
      {creation && creationError && <p className="lw-form-error" role="alert">{creationError}</p>}
      {creation?.kind === "type" && <InlineTreeCreate kind="type" value={creationValue} setValue={setCreationValue} busy={creating} tx={tx} onSubmit={submitCreation} onCancel={() => setCreation(null)} />}
      {creation && creation.kind !== "type" && !creation.parentKey && !allGrouped.some(([type]) => type === creation.type) && <InlineTreeCreate kind={creation.kind} value={creationValue} setValue={setCreationValue} busy={creating} tx={tx} onSubmit={submitCreation} onCancel={() => setCreation(null)} />}
      {allGrouped.length ? allGrouped.map(([type, items]) => {
        const meta = graphTypeMeta(type, typeConfig)
        const open = Boolean(normalizedTreeQuery) || expanded.has(type)
        const limit = visibleLimits[type] || TREE_BATCH_SIZE
        const fullTree = buildSidebarTree(items, type, sidebarOrder)
        const pageTree = normalizedTreeQuery ? filterSidebarTree(fullTree, normalizedTreeQuery) : limitSidebarTree(fullTree, limit)
        const remaining = normalizedTreeQuery ? 0 : sidebarTreeDocumentCount(fullTree) - sidebarTreeDocumentCount(pageTree)
        const typeNode = { key: `type:${type}`, kind: "type", type, title: meta.label || TYPE_META[type]?.[lang] || type, directory: typePageDirectory(items, type) || type, page: null, children: fullTree }
        const typeDeleteTitle = fullTree.length ? tx.categoryNotEmpty : deleteArmedKey === typeNode.key ? tx.confirmTreeDelete : tx.deleteEmptyCategory
        if (normalizedTreeQuery && !pageTree.length) return null
        return <React.Fragment key={type}>
          <div data-type-id={type} className={`lw-tree-group-row ${dropTarget?.type === type && dropTarget?.mode === "root" ? "drop-target" : ""}`}>{renaming?.kind === "type" && renaming.key === typeNode.key ? <span className="lw-tree-group lw-tree-group-editing">{open ? <ChevronDown /> : <ChevronRight />}<span className="lw-dot" style={{ "--type-color": meta.color }} /><InlineTreeTitleInput value={typeNode.title} ariaLabel={tx.renameTypePrompt} onCommit={(title) => onRenameType(type, meta, title)} onCancel={() => setRenaming(null)} /><span className="lw-count">{items.filter((item) => item.kind !== "category").length}</span></span> : <button className="lw-tree-group" onClick={() => toggle(type)} onDoubleClick={(event) => beginTypeRename(event, type)}>{open ? <ChevronDown /> : <ChevronRight />}<span className="lw-dot" style={{ "--type-color": meta.color }} /><span>{typeNode.title}</span><span className="lw-count">{items.filter((item) => item.kind !== "category").length}</span></button>}<span className="lw-tree-row-actions"><button className="lw-tree-action" title={tx.newChildCategory} aria-label={tx.newChildCategory} onClick={() => beginCreation("category", typeNode, type)}><FolderPlus /></button><button className="lw-tree-action" title={tx.newChildArticle} aria-label={tx.newChildArticle} onClick={() => beginCreation("page", typeNode, type)}><FilePlus2 /></button><button className={`lw-tree-action delete ${deleteArmedKey === typeNode.key ? "armed" : ""}`} disabled={fullTree.length > 0} title={typeDeleteTitle} aria-label={typeDeleteTitle} onClick={() => confirmDelete(typeNode)}><Trash2 /></button></span></div>
          {open && creation && creation.kind !== "type" && (creation.parentKey === typeNode.key || (!creation.parentKey && creation.type === type)) && <InlineTreeCreate kind={creation.kind} depth={0} value={creationValue} setValue={setCreationValue} busy={creating} tx={tx} onSubmit={submitCreation} onCancel={() => setCreation(null)} />}
          {open && pageTree.map((node) => renderTreeNode(node))}
          {open && remaining > 0 && <button className="lw-tree-more" onClick={() => showMore(type, items.length)}>{tx.showMorePages.replace("{count}", String(Math.min(TREE_BATCH_SIZE, remaining)))}</button>}
        </React.Fragment>
      }) : !creation && <Empty icon={BookOpen} title={tx.noPages} />}
      {normalizedTreeQuery && !allGrouped.some(([type, items]) => filterSidebarTree(buildSidebarTree(items, type, sidebarOrder), normalizedTreeQuery).length) && <Empty icon={Search} title={tx.noResults} />}
    </div>
    {dragVisual && <div className={`lw-tree-drag-ghost ${dragVisual.invalid ? "invalid" : ""}`} style={{ transform: `translate3d(${dragVisual.x + 12}px, ${dragVisual.y + 12}px, 0)` }}><span>{dragVisual.mode === "inside" ? tx.dropInside : dragVisual.mode === "before" ? tx.dropBefore : dragVisual.mode === "after" ? tx.dropAfter : ""}</span>{dragVisual.title}</div>}
  </div>
}

function DragHandle({ side, onWidth }) {
  const [dragging, setDragging] = useState(false)
  function down(event) {
    event.preventDefault(); setDragging(true)
    const start = event.clientX
    const startWidth = onWidth()
    document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none"
    const move = (e) => onWidth(startWidth + (e.clientX - start) * (side === "left" ? 1 : -1))
    const up = () => { setDragging(false); document.body.style.cursor = ""; document.body.style.userSelect = ""; window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up) }
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up)
  }
  return <div className={`lw-resizer ${dragging ? "dragging" : ""}`} onMouseDown={down} />
}

function knowledgePages(pages) {
  const starters = new Set(["wiki/index.md", "wiki/overview.md", "wiki/log.md"])
  return (pages || []).filter((page) => !starters.has(page.path))
}

function handleRenderedMarkdownClick(event, pages, openPage, toast, fromPath = null, missingLabel = I18N[language()].pageNotFound) {
  const anchor = event.target.closest("a")
  if (!anchor) return
  const href = anchor.getAttribute("href") || ""
  if (href.startsWith("#wiki:")) {
    event.preventDefault()
    const target = decodeURIComponent(href.slice(6))
    const found = resolveWikiPage(target, pages, fromPath)
    if (found) openPage(found.path); else toast(`${missingLabel}: ${target}`, "error")
  } else if (/^https?:/i.test(href)) {
    anchor.target = "_blank"
    anchor.rel = "noopener noreferrer"
  }
}


const HIGHLIGHT_COLORS = [
  { id: "yellow", value: "#fff0a8", rgb: "rgb(255, 240, 168)", zh: "黄色", en: "Yellow" },
  { id: "green", value: "#c7f3d4", rgb: "rgb(199, 243, 212)", zh: "绿色", en: "Green" },
  { id: "blue", value: "#cce7ff", rgb: "rgb(204, 231, 255)", zh: "蓝色", en: "Blue" },
  { id: "pink", value: "#ffd6e7", rgb: "rgb(255, 214, 231)", zh: "粉色", en: "Pink" },
  { id: "purple", value: "#e4d7ff", rgb: "rgb(228, 215, 255)", zh: "紫色", en: "Purple" },
]

function highlightColor(colorId = "yellow") {
  return HIGHLIGHT_COLORS.find((color) => color.id === colorId) || HIGHLIGHT_COLORS[0]
}

function highlightColorIdForNode(node) {
  if (!node) return null
  const stored = node.getAttribute?.("data-highlight-color")
  if (HIGHLIGHT_COLORS.some((color) => color.id === stored)) return stored
  const background = String(node.style?.backgroundColor || node.style?.background || "").toLowerCase().replace(/\s+/g, " ").trim()
  const matched = HIGHLIGHT_COLORS.find((color) => background === color.value || background === color.rgb)
  if (matched) return matched.id
  return node.nodeName === "MARK" ? "yellow" : null
}

const highlightExtension = {
  name: "highlight",
  level: "inline",
  start(source) { return source.indexOf("==") },
  tokenizer(source) {
    const match = /^==(?:\{(yellow|green|blue|pink|purple)\})?(?![=\s])([^\n]*?[^=\s])==(?![=])/.exec(source)
    if (!match) return undefined
    return { type: "highlight", raw: match[0], color: match[1] || "yellow", text: match[2], tokens: this.lexer.inlineTokens(match[2]) }
  },
  renderer(token) {
    const color = highlightColor(token.color)
    return `<mark data-highlight-color="${color.id}" style="background-color:${color.value}">${this.parser.parseInline(token.tokens)}</mark>`
  },
}
marked.use({ extensions: [highlightExtension] })

function renderMarkdown(markdown = "", pagePath = null) {
  const body = String(markdown).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")
  const withWikiLinks = body.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => `[${label || target}](#wiki:${encodeURIComponent(target)})`)
  const clean = DOMPurify.sanitize(marked.parse(withWikiLinks, { gfm: true, breaks: false }), { ADD_ATTR: ["target", "width", "height", "download", "data-highlight-color", "style"] })
  if (typeof document === "undefined") return clean
  const template = document.createElement("template")
  template.innerHTML = clean
  template.content.querySelectorAll("mark[data-highlight-color]").forEach((mark) => {
    const color = highlightColor(mark.getAttribute("data-highlight-color"))
    mark.setAttribute("data-highlight-color", color.id)
    mark.style.backgroundColor = color.value
  })
  template.content.querySelectorAll("img[src]").forEach((image) => {
    const reference = image.getAttribute("src") || ""
    const assetPath = resolveWikiAssetReference(pagePath, reference)
    if (!assetPath) return
    image.setAttribute("data-asset-path", reference)
    image.setAttribute("src", isNativeHost() ? "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" : wikiAssetUrl(assetPath))
    if (isNativeHost()) { image.dataset.nativeAsset=assetPath; image.dataset.nativeProject=activeProjectPath }
    image.setAttribute("loading", "lazy")
    image.setAttribute("draggable", "false")
  })
  template.content.querySelectorAll("a[href]").forEach((anchor) => {
    const reference = anchor.getAttribute("href") || ""
    const assetPath = resolveWikiAssetReference(pagePath, reference)
    if (!assetPath) return
    anchor.setAttribute("data-attachment-path", reference)
    anchor.setAttribute("href", isNativeHost() ? "#" : wikiAssetUrl(assetPath, { download: true }))
    if (isNativeHost()) { anchor.dataset.nativeAsset=assetPath; anchor.dataset.nativeProject=activeProjectPath }
    anchor.setAttribute("download", wikiAssetFilename(assetPath))
  })
  return template.innerHTML
}

function renderEditorMarkdown(markdown = "", pagePath = null, documentTitle = "") {
  if (typeof document === "undefined") return renderMarkdown(markdown, pagePath)
  const template = document.createElement("template")
  template.innerHTML = renderMarkdown(markdown, pagePath)
  let heading = template.content.querySelector("h1")
  if (!heading) {
    heading = document.createElement("h1")
    heading.textContent = documentTitle || ""
    template.content.prepend(heading)
  }
  heading.setAttribute("data-document-title", "true")
  heading.setAttribute("data-placeholder", documentTitle || "Untitled")
  return template.innerHTML
}

const turndown = new TurndownService({ headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced" })
turndown.use(gfm)
turndown.addRule("wikiAssetImage", {
  filter: (node) => node.nodeName === "IMG" && node.hasAttribute("data-asset-path"),
  replacement: (_content, node) => imageAssetMarkup(
    node.getAttribute("data-asset-path"),
    node.getAttribute("alt") || wikiAssetFilename(node.getAttribute("data-asset-path")),
    node.getAttribute("width") || node.getBoundingClientRect?.().width || 720,
  ),
})
turndown.addRule("wikiAttachment", {
  filter: (node) => node.nodeName === "A" && node.hasAttribute("data-attachment-path"),
  replacement: (content, node) => attachmentAssetMarkup(node.getAttribute("data-attachment-path"), content || wikiAssetFilename(node.getAttribute("data-attachment-path"))),
})
turndown.addRule("wikiLink", {
  filter: (node) => node.nodeName === "A" && String(node.getAttribute("href") || "").startsWith("#wiki:"),
  replacement: (content, node) => {
    const target = decodeURIComponent(String(node.getAttribute("href") || "").slice(6))
    return content && content !== target ? `[[${target}|${content}]]` : `[[${target}]]`
  },
})
turndown.addRule("highlight", {
  filter: (node) => {
    if (node.nodeName === "MARK") return true
    if (node.nodeName !== "SPAN") return false
    const background = String(node.style?.backgroundColor || node.style?.background || "").toLowerCase()
    return Boolean(background && background !== "transparent" && background !== "rgba(0, 0, 0, 0)")
  },
  replacement: (content, node) => {
    const clean = String(content || "").replace(/\u200b/g, "")
    if (!clean) return ""
    const colorId = highlightColorIdForNode(node) || "yellow"
    return colorId === "yellow" ? `==${clean}==` : `=={${colorId}}${clean}==`
  },
})

function markdownFrontmatter(markdown = "") {
  return String(markdown).match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)?.[0] || ""
}

function RichMarkdownSurface({ value, onChange, onKeyDown, richRef, onTableCellSelect, onLinkClick, pagePath, documentTitle, onDocumentTitleChange, tx }) {
  const selectedImageRef = useRef(null)
  const [imageBox, setImageBox] = useState(null)

  const updateImageBox = useCallback(() => {
    const image = selectedImageRef.current
    const surface = richRef.current
    const host = surface?.parentElement
    if (!image?.isConnected || !host) { selectedImageRef.current = null; setImageBox(null); return }
    const imageRect = image.getBoundingClientRect()
    const hostRect = host.getBoundingClientRect()
    setImageBox({
      left: imageRect.left - hostRect.left + host.scrollLeft,
      top: imageRect.top - hostRect.top + host.scrollTop,
      width: imageRect.width,
      height: imageRect.height,
    })
  }, [richRef])

  useEffect(() => {
    const surface = richRef.current
    if (!surface || document.activeElement === surface || surface.contains(document.activeElement)) return
    const html = renderEditorMarkdown(value, pagePath, documentTitle)
    if (surface.innerHTML !== html) surface.innerHTML = html
    selectedImageRef.current = null
    setImageBox(null)
  }, [value, richRef, pagePath, documentTitle])

  useEffect(() => {
    window.addEventListener("resize", updateImageBox)
    return () => window.removeEventListener("resize", updateImageBox)
  }, [updateImageBox])

  function sync() {
    const surface = richRef.current
    if (!surface) return
    const heading = surface.querySelector('h1[data-document-title="true"]')
    if (heading) {
      const nextTitle = String(heading.textContent || "").replace(/\u200b/g, "").trim()
      if (nextTitle !== documentTitle) onDocumentTitleChange?.(nextTitle)
    }
    const body = turndown.turndown(surface.innerHTML).trim()
    onChange(`${markdownFrontmatter(value)}${body}${body ? "\n" : ""}`)
  }

  function handleRichKeyDown(event) {
    const selection = window.getSelection()
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null
    const start = range?.startContainer?.nodeType === Node.ELEMENT_NODE ? range.startContainer : range?.startContainer?.parentElement
    const listItem = start?.closest?.("li")
    if (event.key === "Tab" && listItem && richRef.current?.contains(listItem)) {
      event.preventDefault()
      event.stopPropagation()
      document.execCommand(event.shiftKey ? "outdent" : "indent", false)
      sync()
      return
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") event.stopPropagation()
    onKeyDown?.(event)
  }

  function selectImage(image) {
    selectedImageRef.current = image
    requestAnimationFrame(updateImageBox)
  }

  function setSelectedImageWidth(width, commit = false) {
    const image = selectedImageRef.current
    const surface = richRef.current
    if (!image || !surface) return
    const imageRect = image.getBoundingClientRect()
    const surfaceRect = surface.getBoundingClientRect()
    const maxWidth = Math.max(80, surfaceRect.right - imageRect.left)
    image.setAttribute("width", String(normalizeImageWidth(Math.min(width, maxWidth))))
    image.removeAttribute("height")
    updateImageBox()
    if (commit) sync()
  }

  function beginImageResize(event) {
    const image = selectedImageRef.current
    if (!image) return
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startWidth = image.getBoundingClientRect().width
    const move = (pointerEvent) => setSelectedImageWidth(startWidth + pointerEvent.clientX - startX)
    const finish = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", finish)
      sync()
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", finish, { once: true })
  }

  function resizeImageWithKeyboard(event) {
    if (!["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp"].includes(event.key)) return
    event.preventDefault()
    const current = selectedImageRef.current?.getBoundingClientRect().width || 720
    const direction = ["ArrowRight", "ArrowUp"].includes(event.key) ? 1 : -1
    setSelectedImageWidth(current + direction * (event.shiftKey ? 50 : 10), true)
  }

  return <><article ref={richRef} className="lw-markdown lw-md-rich" contentEditable suppressContentEditableWarning spellCheck="true" onInput={sync} onKeyDown={handleRichKeyDown} onClick={(event) => {
    const image = event.target.closest("img[data-asset-path]")
    if (image) { event.preventDefault(); selectImage(image) }
    else { selectedImageRef.current = null; setImageBox(null) }
    const cell = event.target.closest("th,td")
    onTableCellSelect?.(cell || null)
    if (event.target.closest("a")) onLinkClick?.(event)
  }} />{imageBox && <div className="lw-image-resize-ui" style={{ left: imageBox.left, top: imageBox.top, width: imageBox.width, height: imageBox.height }} contentEditable={false}><span className="lw-image-size-label">{Math.round(imageBox.width)} px</span><button type="button" className="lw-image-resize-handle" title={tx.resizeImage} aria-label={tx.resizeImage} onPointerDown={beginImageResize} onKeyDown={resizeImageWithKeyboard} /></div>}</>
}

function MarkdownEditor({ projectPath, value, saveAcknowledgement, onChange, onSave, dirty, saving, pagePath, pageTitle: documentTitle, onTitleChange, onLinkClick, onOpenSidebar, toast, tx }) {
  const [formatting,setFormatting] = useState(false)
  const ref = useRef(null)
  const mediaMountedRef=useRef(true)
  const liveValueRef=useRef(value)
  liveValueRef.current=value
  useEffect(()=>()=>{mediaMountedRef.current=false},[])
  const richRef = useRef(null)
  const toolbarRef = useRef(null)
  const richTableCellRef = useRef(null)
  const imageInputRef = useRef(null)
  const attachmentInputRef = useRef(null)
  const mediaTargetRef = useRef("rich")
  const richSelectionRef = useRef(null)
  const historyRef = useRef(createEditorHistory(value))
  const tableHintTimerRef = useRef(null)
  const [, setHistoryVersion] = useState(0)
  const [layout, setLayout] = useState("rich")
  const [swapped, setSwapped] = useState(false)
  const [tableContext, setTableContext] = useState(false)
  const [tableHint, setTableHint] = useState("")
  const [assetUploading, setAssetUploading] = useState("")
  const [activeFormats, setActiveFormats] = useState(new Set())
  const [highlightColorId, setHighlightColorId] = useState("yellow")
  const [highlightPalette, setHighlightPalette] = useState(null)
  const zh = language() === "zh"

  useEffect(() => {
    if (historyRef.current.present === value) return
    // The server can normalize the title/frontmatter of the draft just saved.
    // That acknowledgement is still the same edit, not a new history baseline.
    if (saveAcknowledgement?.before === historyRef.current.present && saveAcknowledgement.after === value) {
      historyRef.current = { ...historyRef.current, present: value, lastKind: null, lastAt: 0 }
    } else historyRef.current = createEditorHistory(value)
    setHistoryVersion((version) => version + 1)
  }, [value, saveAcknowledgement])

  useEffect(() => () => clearTimeout(tableHintTimerRef.current), [])

  useEffect(() => {
    document.addEventListener("selectionchange", updateRichFormatState)
    return () => document.removeEventListener("selectionchange", updateRichFormatState)
  }, [])

  useEffect(() => {
    if (!highlightPalette) return undefined
    const close = (event) => {
      if (!event.target.closest?.(".lw-md-highlight-palette,[data-highlight-trigger]")) setHighlightPalette(null)
    }
    const closeWithEscape = (event) => { if (event.key === "Escape") setHighlightPalette(null) }
    document.addEventListener("pointerdown", close)
    document.addEventListener("keydown", closeWithEscape)
    return () => {
      document.removeEventListener("pointerdown", close)
      document.removeEventListener("keydown", closeWithEscape)
    }
  }, [highlightPalette])

  function updateRichFormatState() {
    const surface = richRef.current
    const selection = window.getSelection()
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null
    if (!surface || !range || !surface.contains(range.commonAncestorContainer)) {
      setActiveFormats(new Set())
      return
    }
    const node = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement
    const next = new Set()
    const block = node?.closest?.("h1,h2,h3,blockquote,pre,li")
    if (block?.matches("h1,h2,h3")) next.add(block.tagName.toLowerCase())
    if (block?.matches("blockquote")) next.add("blockquote")
    if (block?.matches("pre")) next.add("pre")
    if (node?.closest?.("strong,b") || document.queryCommandState("bold")) next.add("bold")
    if (node?.closest?.("em,i") || document.queryCommandState("italic")) next.add("italic")
    if (node?.closest?.("del,s,strike") || document.queryCommandState("strikeThrough")) next.add("strike")
    if (node?.closest?.("a")) next.add("link")
    const highlighted = node?.closest?.("mark,span[style*='background']")
    const background = String(highlighted?.style?.backgroundColor || highlighted?.style?.background || "").toLowerCase()
    if (highlighted?.tagName === "MARK" || (background && background !== "transparent" && background !== "rgba(0, 0, 0, 0)")) {
      next.add("highlight")
      const selectedColor = highlightColorIdForNode(highlighted)
      if (selectedColor) setHighlightColorId(selectedColor)
    }
    const list = node?.closest?.("ul,ol")
    if (list?.tagName === "UL") next.add("ul")
    if (list?.tagName === "OL") next.add("ol")
    setActiveFormats(next)
  }

  function showTableHint(reason) {
    const messages = zh ? {
      "not-in-table": "先把光标放到要调整的表格里",
      "minimum-column": "表格至少要保留一列",
      "minimum-row": "这个表格已经没有可删除的内容行",
    } : {
      "not-in-table": "Place the cursor inside the table first",
      "minimum-column": "A table must keep at least one column",
      "minimum-row": "This table has no content row to remove",
    }
    setTableHint(messages[reason] || (zh ? "无法调整这个表格" : "This table cannot be changed"))
    clearTimeout(tableHintTimerRef.current)
    tableHintTimerRef.current = setTimeout(() => setTableHint(""), 2400)
  }

  function changeValue(next, kind = "command") {
    const updated = recordEditorValue(historyRef.current, next, kind)
    if (updated === historyRef.current) return
    historyRef.current = updated
    setHistoryVersion((version) => version + 1)
    onChange(updated.present)
  }

  function focusAfterHistory(next, preferRich) {
    requestAnimationFrame(() => {
      if (preferRich && richRef.current) {
        richRef.current.innerHTML = renderEditorMarkdown(next, pagePath, documentTitle)
        richRef.current.focus()
        const range = document.createRange()
        range.selectNodeContents(richRef.current)
        range.collapse(false)
        const selection = window.getSelection()
        selection.removeAllRanges()
        selection.addRange(range)
      } else if (ref.current) {
        ref.current.focus()
        ref.current.setSelectionRange(next.length, next.length)
      }
    })
  }

  function applyHistory(direction) {
    const current = historyRef.current
    const updated = direction === "redo" ? redoEditorHistory(current) : undoEditorHistory(current)
    if (updated === current) return
    const richFocused = richRef.current && (document.activeElement === richRef.current || richRef.current.contains(document.activeElement))
    historyRef.current = updated
    setHistoryVersion((version) => version + 1)
    onChange(updated.present)
    focusAfterHistory(updated.present, layout === "rich" || (layout === "split" && richFocused))
  }

  function handleHistoryShortcut(event) {
    const command = event.metaKey || event.ctrlKey
    if (!command) return false
    const key = event.key.toLowerCase()
    if (key === "z") {
      event.preventDefault()
      applyHistory(event.shiftKey ? "redo" : "undo")
      return true
    }
    if (key === "y" && !event.metaKey) {
      event.preventDefault()
      applyHistory("redo")
      return true
    }
    return false
  }

  function handleEditorShortcut(event) {
    const command = event.metaKey || event.ctrlKey
    const key = event.key.toLowerCase()
    if (command && event.altKey && key === "i") {
      event.preventDefault()
      openMediaPicker("image")
      return true
    }
    if (command && event.altKey && key === "a") {
      event.preventDefault()
      openMediaPicker("attachment")
      return true
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault()
      onSave?.()
      return true
    }
    return handleHistoryShortcut(event)
  }

  function replaceSelection(transform) {
    const textarea = ref.current
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const currentValue=textarea.value
    const selected = currentValue.slice(start, end)
    const result = transform(selected, start, end)
    const text = typeof result === "string" ? result : result.text
    const next = currentValue.slice(0, start) + text + currentValue.slice(end)
    const selectionStart = start + (result.selectionStart ?? 0)
    const selectionEnd = start + (result.selectionEnd ?? text.length)
    changeValue(next, "command")
    requestAnimationFrame(() => { textarea.focus(); textarea.setSelectionRange(selectionStart, selectionEnd) })
  }

  function applySourceEdit(result, kind = "command") {
    const textarea = ref.current
    if (!textarea || !result) return
    changeValue(result.value, kind)
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(result.selectionStart, result.selectionEnd)
    })
  }

  function wrap(before, after = before) {
    const textarea = ref.current
    if (!textarea) return
    applySourceEdit(wrapMarkdownSelection(value, textarea.selectionStart, textarea.selectionEnd, before, after))
  }

  function sourceHighlight(colorId = highlightColorId) {
    const color = highlightColor(colorId)
    wrap(color.id === "yellow" ? "==" : `=={${color.id}}`, "==")
  }

  function prefixLines(prefix) {
    const textarea = ref.current
    if (!textarea) return
    applySourceEdit(prefixMarkdownLines(value, textarea.selectionStart, textarea.selectionEnd, prefix))
  }

  function heading(level) {
    replaceSelection((selected) => {
      const marker = `${"#".repeat(level)} `
      if (!selected) return { text: marker, selectionStart: marker.length, selectionEnd: marker.length }
      const text = selected.split("\n").map((line) => `${marker}${line.replace(/^#{1,6}\s+/, "")}`).join("\n")
      return { text, selectionStart: marker.length, selectionEnd: text.length }
    })
  }

  function onKeyDown(event) {
    if (handleEditorShortcut(event)) return
    const textarea = ref.current
    if (event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.altKey && textarea) {
      const result = continueMarkdownList(value, textarea.selectionStart, textarea.selectionEnd)
      if (result) { event.preventDefault(); applySourceEdit(result, "input"); return }
    }
    if (event.key === "Tab" && textarea) {
      event.preventDefault()
      applySourceEdit(indentMarkdownLines(value, textarea.selectionStart, textarea.selectionEnd, event.shiftKey), "input")
      return
    }
    const command = event.metaKey || event.ctrlKey
    if (!command) return
    const key = event.key.toLowerCase()
    if (key === "k") event.stopPropagation()
    if (key === "b") { event.preventDefault(); wrap("**", "**") }
    else if (key === "i") { event.preventDefault(); wrap("*", "*") }
    else if (key === "k" && event.shiftKey) { event.preventDefault(); wrap("[[", "]]") }
    else if (key === "k") { event.preventDefault(); wrap("[", "](https://)") }
    else if (event.altKey && ["1", "2", "3"].includes(key)) { event.preventDefault(); heading(Number(key)) }
  }

  function sourceTableAction(action) {
    const textarea = ref.current
    if (!textarea) { showTableHint("not-in-table"); return }
    const result = editMarkdownTable(value, textarea.selectionStart, action, {
      column: zh ? "新列" : "New column",
      cell: "",
    })
    if (!result.changed) { showTableHint(result.reason); return }
    changeValue(result.value, "command")
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(result.selectionStart, result.selectionEnd)
    })
  }

  function updateSourceTableContext() {
    const textarea = ref.current
    if (!textarea) return
    const probe = editMarkdownTable(value, textarea.selectionStart, "probe")
    setTableContext(probe.reason !== "not-in-table")
  }

  async function richCommand(command, argument = null) {
    const surface = richRef.current
    if (!surface) return
    surface.focus()
    const selection = window.getSelection()
    let range = selection?.rangeCount ? selection.getRangeAt(0) : null
    if (!range || !surface.contains(range.commonAncestorContainer)) {
      range = document.createRange()
      range.selectNodeContents(surface)
      range.collapse(false)
    }
    const setCaretAfter = (node) => {
      range.setStartAfter(node); range.collapse(true)
      selection.removeAllRanges(); selection.addRange(range)
    }
    const insertHtml = (html) => {
      range.deleteContents()
      const fragment = range.createContextualFragment(html)
      const last = fragment.lastChild
      range.insertNode(fragment)
      if (last) setCaretAfter(last)
    }
    const insertLink = (href, text) => {
      if (!range.collapsed) {
        document.execCommand("createLink", false, href)
        return
      }
      const anchor = document.createElement("a")
      anchor.setAttribute("href", href)
      anchor.textContent = text
      range.insertNode(anchor)
      setCaretAfter(anchor)
    }
    const tableCell = () => {
      const start = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement
      const cell = start?.closest?.("th,td")
      if (cell && surface.contains(cell)) return cell
      return richTableCellRef.current && surface.contains(richTableCellRef.current) ? richTableCellRef.current : null
    }
    const setCaretInside = (element) => {
      if (!element) return
      const caret = document.createRange()
      caret.selectNodeContents(element)
      caret.collapse(false)
      selection.removeAllRanges()
      selection.addRange(caret)
    }
    const editTable = (action) => {
      const cell = tableCell()
      const table = cell?.closest("table")
      if (!cell || !table) { showTableHint("not-in-table"); return false }
      const columnIndex = cell.cellIndex
      const currentRow = cell.closest("tr")
      let focusCell = cell

      if (action === "add-row") {
        let body = table.tBodies[0]
        if (!body) { body = document.createElement("tbody"); table.append(body) }
        const row = document.createElement("tr")
        const width = table.rows[0]?.cells.length || 1
        for (let index = 0; index < width; index += 1) {
          const nextCell = document.createElement("td")
          nextCell.append(document.createElement("br"))
          row.append(nextCell)
        }
        if (currentRow?.parentElement === body) currentRow.after(row)
        else body.prepend(row)
        focusCell = row.cells[Math.min(columnIndex, width - 1)]
      } else if (action === "remove-row") {
        const bodyRows = Array.from(table.tBodies).flatMap((body) => Array.from(body.rows))
        if (!bodyRows.length) { showTableHint("minimum-row"); return false }
        const row = bodyRows.includes(currentRow) ? currentRow : bodyRows[bodyRows.length - 1]
        const fallback = row.previousElementSibling || row.nextElementSibling || table.tHead?.rows[0]
        row.remove()
        focusCell = fallback?.cells[Math.min(columnIndex, (fallback?.cells.length || 1) - 1)] || null
      } else if (action === "add-column") {
        for (const row of Array.from(table.rows)) {
          const reference = row.cells[Math.min(columnIndex, row.cells.length - 1)]
          const nextCell = document.createElement(reference?.tagName?.toLowerCase() === "th" ? "th" : "td")
          nextCell.append(document.createElement("br"))
          reference?.after(nextCell)
          if (row === currentRow) focusCell = nextCell
        }
      } else if (action === "remove-column") {
        const width = table.rows[0]?.cells.length || 0
        if (width <= 1) { showTableHint("minimum-column"); return false }
        for (const row of Array.from(table.rows)) row.cells[Math.min(columnIndex, row.cells.length - 1)]?.remove()
        focusCell = currentRow?.cells[Math.min(columnIndex, width - 2)] || null
      }
      richTableCellRef.current = focusCell
      setCaretInside(focusCell)
      return true
    }

    if (command === "wikiLink") {
      const selected = range.toString().trim()
      const target = await promptValue(tx.wikiLinkPrompt, selected)
      if (!target) return
      insertLink(`#wiki:${encodeURIComponent(target)}`, selected || target)
    }
    else if (command === "task") insertHtml("<ul><li><input type=\"checkbox\"> </li></ul><p><br></p>")
    else if (command === "table") insertHtml("<table><thead><tr><th><br></th><th><br></th></tr></thead><tbody><tr><td><br></td><td><br></td></tr></tbody></table><p><br></p>")
    else if (command === "highlight") {
      const color = highlightColor(argument || highlightColorId)
      const start = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement
      const highlighted = start?.closest?.("mark,span[style*='background']")
      const currentColorId = highlightColorIdForNode(highlighted)
      if (range.collapsed && !highlighted) {
        const mark = document.createElement("mark")
        mark.setAttribute("data-pending-format", "highlight")
        mark.setAttribute("data-highlight-color", color.id)
        mark.style.backgroundColor = color.value
        mark.textContent = "\u200b"
        range.insertNode(mark)
        range.selectNodeContents(mark)
        range.collapse(false)
        selection.removeAllRanges()
        selection.addRange(range)
      } else if (range.collapsed && highlighted?.getAttribute("data-pending-format") === "highlight" && !String(highlighted.textContent || "").replace(/\u200b/g, "")) {
        if (currentColorId === color.id) {
          const caret = document.createTextNode("")
          highlighted.replaceWith(caret)
          range.setStart(caret, 0)
          range.collapse(true)
          selection.removeAllRanges()
          selection.addRange(range)
        } else {
          highlighted.setAttribute("data-highlight-color", color.id)
          highlighted.style.backgroundColor = color.value
        }
      } else {
        document.execCommand("styleWithCSS", false, true)
        document.execCommand("hiliteColor", false, currentColorId === color.id ? "transparent" : color.value)
        document.execCommand("styleWithCSS", false, false)
      }
    }
    else if (command === "createLink") {
      const url = await promptValue(tx.linkUrlPrompt, argument || "https://")
      if (!url) return
      insertLink(url, range.toString().trim() || url)
    }
    else if (command === "formatBlock") document.execCommand("formatBlock", false, argument || "p")
    else if (["bold", "italic", "strikeThrough", "insertUnorderedList", "insertOrderedList", "insertHorizontalRule"].includes(command)) document.execCommand(command, false)
    else if (["add-row", "remove-row", "add-column", "remove-column"].includes(command) && !editTable(command)) return
    const body = turndown.turndown(surface.innerHTML).trim()
    changeValue(`${markdownFrontmatter(value)}${body}${body ? "\n" : ""}`, "command")
    requestAnimationFrame(updateRichFormatState)
  }

  function runTool(sourceAction, richAction) {
    const richFocused = richRef.current && (document.activeElement === richRef.current || richRef.current.contains(document.activeElement))
    if (layout === "rich" || (layout === "split" && richFocused)) richAction()
    else sourceAction()
  }

  function openHighlightPalette(event) {
    const toolbar = toolbarRef.current
    const buttonRect = event.currentTarget.getBoundingClientRect()
    const toolbarRect = toolbar?.getBoundingClientRect()
    const left = toolbarRect ? Math.max(76, Math.min(toolbarRect.width - 76, buttonRect.left - toolbarRect.left + buttonRect.width / 2)) : 180
    setHighlightPalette((current) => current ? null : { left })
  }

  function applyHighlightColor(colorId) {
    setHighlightColorId(colorId)
    setHighlightPalette(null)
    runTool(() => sourceHighlight(colorId), () => richCommand("highlight", colorId))
  }

  function rememberMediaTarget() {
    const surface = richRef.current
    const selection = window.getSelection()
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null
    const richSelected = Boolean(range && surface?.contains(range.commonAncestorContainer))
    mediaTargetRef.current = layout === "rich" || (layout === "split" && richSelected) ? "rich" : "source"
    richSelectionRef.current = richSelected ? range.cloneRange() : null
  }

  function openMediaPicker(kind) {
    rememberMediaTarget()
    const input = kind === "image" ? imageInputRef.current : attachmentInputRef.current
    input?.click()
  }

  function insertRichMedia(markdown) {
    const surface = richRef.current
    if (!surface) return
    surface.focus()
    const selection = window.getSelection()
    let range = richSelectionRef.current
    if (!range || !surface.contains(range.commonAncestorContainer)) {
      range = document.createRange()
      range.selectNodeContents(surface)
      range.collapse(false)
    }
    const template = document.createElement("template")
    template.innerHTML = renderMarkdown(markdown, pagePath)
    const node = template.content.querySelector("img[data-asset-path], a[data-attachment-path]")
    if (!node) return
    const spacer = document.createTextNode(node.nodeName === "IMG" ? "\n" : " ")
    range.deleteContents()
    range.insertNode(spacer)
    range.insertNode(node)
    range.setStartAfter(spacer)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
    const body = turndown.turndown(surface.innerHTML).trim()
    changeValue(`${markdownFrontmatter(liveValueRef.current)}${body}${body ? "\n" : ""}`, "command")
  }

  function insertMedia(markdown) {
    if (mediaTargetRef.current === "rich") insertRichMedia(markdown)
    else replaceSelection(() => ({ text: `\n${markdown}\n`, selectionStart: markdown.length + 2 }))
  }

  async function uploadMedia(file, kind) {
    if (!file || assetUploading) return
    if (file.size > 25 * 1024 * 1024) { toast?.(`${file.name}: ${tx.uploadTooLarge}`, "error"); return }
    setAssetUploading(kind)
    try {
      const imageWidth = kind === "image" ? await preferredImageWidth(file) : null
      const payload = await fileToPayload(file)
      if(!mediaMountedRef.current)return
      const uploaded = await api("/wiki/asset", { method: "POST", projectPath, body: payload })
      if(!mediaMountedRef.current)return
      if (kind === "image" && !uploaded.image) throw new Error(zh ? "请选择 PNG、JPG、GIF 或 WebP 图片" : "Choose a PNG, JPG, GIF, or WebP image")
      const reference = relativeWikiAssetReference(pagePath, uploaded.path)
      const markdown = kind === "image"
        ? imageAssetMarkup(reference, file.name.replace(/\.[^.]+$/, ""), imageWidth)
        : attachmentAssetMarkup(reference, uploaded.name || file.name)
      insertMedia(markdown)
      toast?.(`${tx.attachmentUploaded}: ${uploaded.name || file.name}`)
    } catch (error) {
      if(mediaMountedRef.current)toast?.(`${tx.attachmentUploadFailed}: ${error.message}`, "error")
    } finally {
      if(mediaMountedRef.current)setAssetUploading("")
      if (imageInputRef.current) imageInputRef.current.value = ""
      if (attachmentInputRef.current) attachmentInputRef.current.value = ""
    }
  }

  const toolGroups = [
    ["headings", [[Heading1, `${zh ? "一级标题：将当前段落设为主标题" : "Heading 1: format the current block as a primary heading"} · ⌘⌥1`, () => heading(1), () => richCommand("formatBlock", "h1"), "h1"], [Heading2, `${zh ? "二级标题：将当前段落设为章节标题" : "Heading 2: format the current block as a section heading"} · ⌘⌥2`, () => heading(2), () => richCommand("formatBlock", "h2"), "h2"], [Heading3, `${zh ? "三级标题：将当前段落设为小节标题" : "Heading 3: format the current block as a subsection heading"} · ⌘⌥3`, () => heading(3), () => richCommand("formatBlock", "h3"), "h3"]]],
    ["text", [[Bold, `${zh ? "粗体：加粗选中文字；未选择时切换后续输入" : "Bold: format selected text or toggle future typing"} · ⌘B`, () => wrap("**", "**"), () => richCommand("bold"), "bold"], [Italic, `${zh ? "斜体：倾斜选中文字；未选择时切换后续输入" : "Italic: format selected text or toggle future typing"} · ⌘I`, () => wrap("*", "*"), () => richCommand("italic"), "italic"], [Highlighter, zh ? "高亮：选择颜色后，为选中文字着色或直接输入高亮内容" : "Highlight: choose a color, then format a selection or type highlighted text", () => sourceHighlight(), () => richCommand("highlight", highlightColorId), "highlight"], [Strikethrough, zh ? "删除线：标记已删除或不再适用的内容" : "Strikethrough: mark deleted or outdated content", () => wrap("~~", "~~"), () => richCommand("strikeThrough"), "strike"]]],
    ["links", [[Link, `${zh ? "网页链接：为选中文字添加网址；未选择时使用网址作为文字" : "Web link: add a URL to selected text, or use the URL as its label"} · ⌘K`, () => wrap("[", "](https://)"), () => richCommand("createLink", "https://"), "link"], [Braces, `${zh ? "知识库双链：链接到另一个知识页面" : "Wiki link: connect this text to another knowledge page"} · ⌘⇧K`, () => wrap("[[", "]]"), () => richCommand("wikiLink"), "link"]]],
    ["lists", [[List, zh ? "项目列表：创建无序列表；回车新增项目，Tab 调整子项" : "Bullet list: Enter adds items; Tab changes nesting", () => prefixLines("- "), () => richCommand("insertUnorderedList"), "ul"], [ListOrdered, zh ? "编号列表：自动连续编号；回车新增项目，Tab 调整子项" : "Numbered list: continues numbering; Enter adds items; Tab changes nesting", () => prefixLines((index) => `${index + 1}. `), () => richCommand("insertOrderedList"), "ol"], [ListChecks, zh ? "任务列表：创建可勾选的待办项目" : "Task list: create a checklist item", () => prefixLines("- [ ] "), () => richCommand("task")]]],
    ["blocks", [[Quote, zh ? "引用：将当前段落设为引用内容" : "Quote: format the current block as a quotation", () => prefixLines("> "), () => richCommand("formatBlock", "blockquote"), "blockquote"], [Code2, zh ? "代码块：以等宽格式显示多行代码" : "Code block: display multiple lines as code", () => wrap("```\n", "\n```"), () => richCommand("formatBlock", "pre"), "pre"], [Minus, zh ? "分隔线：在当前位置插入章节分隔线" : "Divider: insert a section separator", () => replaceSelection(() => "\n---\n"), () => richCommand("insertHorizontalRule")]]],
  ]

  const tableActions = [
    ["add-row", zh ? "增加一行" : "Add row", zh ? "行+" : "Row+"],
    ["remove-row", zh ? "减少一行" : "Remove row", zh ? "行−" : "Row−"],
    ["add-column", zh ? "增加一列" : "Add column", zh ? "列+" : "Col+"],
    ["remove-column", zh ? "减少一列" : "Remove column", zh ? "列−" : "Col−"],
  ]

  const insertSourceTable = () => replaceSelection(() => ({ text: "|  |  |\n| --- | --- |\n|  |  |\n", selectionStart: 2, selectionEnd: 2 }))
  return <div className={`lw-md-editor ${formatting?"formatting-open":""}`}>
    <div className="lw-writing-bar"><span className={`lw-save-indicator ${dirty?"is-dirty":""}`} role="status">{saving?tx.saving:dirty?tx.unsaved:tx.saved}</span><button type="button" className={`lw-format-toggle ${formatting?"active":""}`} aria-expanded={formatting} onMouseDown={event=>event.preventDefault()} onClick={()=>setFormatting(value=>!value)}><Bold/>{zh?"格式与插入":"Format & insert"}<ChevronDown/></button><div className="lw-writing-modes"><button className={layout==="rich"?"active":""} onClick={()=>{setLayout("rich");setTableContext(false)}}>{tx.richOnly}</button><button className={layout==="source"?"active":""} onClick={()=>{setLayout("source");setTableContext(false)}}>{tx.sourceOnly}</button><button className={layout==="split"?"active":""} onClick={()=>{setLayout("split");setTableContext(false)}}>{tx.splitView}</button></div></div>
    <div ref={toolbarRef} className="lw-md-toolbar">{onOpenSidebar && <button type="button" className="lw-md-sidebar-toggle" title={zh ? "打开知识侧栏" : "Open knowledge sidebar"} aria-label={tx.knowledge} onClick={onOpenSidebar}><PanelLeftOpen /></button>}<div className="lw-md-actions"><span className="lw-md-history"><button type="button" disabled={!historyRef.current.past.length} title={`${zh ? "撤销：返回上一步编辑" : "Undo the previous edit"} · ⌘Z / Ctrl+Z`} aria-label={tx.undo} onMouseDown={(event) => event.preventDefault()} onClick={() => applyHistory("undo")}><Undo2 /></button><button type="button" disabled={!historyRef.current.future.length} title={`${zh ? "重做：恢复刚刚撤销的编辑" : "Redo the last undone edit"} · ⌘⇧Z / Ctrl+Y`} aria-label={tx.redo} onMouseDown={(event) => event.preventDefault()} onClick={() => applyHistory("redo")}><Redo2 /></button></span>{toolGroups.map(([group, groupTools]) => <span className="lw-md-tool-group" data-tool-group={group} key={group}>{groupTools.map(([Icon, title, sourceAction, richAction, format], index) => <button type="button" className={format && activeFormats.has(format) ? "active" : ""} data-highlight-trigger={format === "highlight" ? "true" : undefined} data-highlight-color={format === "highlight" ? highlightColorId : undefined} style={format === "highlight" ? { "--highlight-color": highlightColor(highlightColorId).value } : undefined} key={`${title}-${index}`} title={title} aria-label={title} onMouseDown={(event) => event.preventDefault()} onClick={(event) => format === "highlight" ? openHighlightPalette(event) : runTool(sourceAction, richAction)}><Icon /></button>)}</span>)}<span className="lw-md-table-tools"><button type="button" title={zh ? "表格：在当前位置插入一个可编辑表格" : "Table: insert an editable table here"} aria-label={zh ? "新建表格" : "Insert table"} onMouseDown={(event) => event.preventDefault()} onClick={() => runTool(insertSourceTable, () => richCommand("table"))}><Table2 /></button>{tableContext && tableActions.map(([action, title, label]) => <button type="button" className="lw-md-table-action" key={action} title={title} aria-label={title} onMouseDown={(event) => event.preventDefault()} onClick={() => runTool(() => sourceTableAction(action), () => richCommand(action))}>{label}</button>)}</span><span className="lw-md-media-tools"><input ref={imageInputRef} hidden type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(event) => uploadMedia(event.target.files?.[0], "image")} /><input ref={attachmentInputRef} hidden type="file" accept=".pdf,.txt,.md,.markdown,.csv,.json,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.mp3,.m4a,.wav,.mp4,.mov,.png,.jpg,.jpeg,.gif,.webp" onChange={(event) => uploadMedia(event.target.files?.[0], "attachment")} /><button type="button" disabled={Boolean(assetUploading)} title={`${zh ? "图片：上传图片并插入文章，插入后可拖动调整显示大小" : "Image: upload and insert an image, then drag to resize it"} · ⌘⌥I / Ctrl+Alt+I`} aria-label={tx.insertImage} onMouseDown={(event) => { event.preventDefault(); rememberMediaTarget() }} onClick={() => openMediaPicker("image")}>{assetUploading === "image" ? <LoaderCircle /> : <ImagePlus />}</button><button type="button" disabled={Boolean(assetUploading)} title={`${zh ? "附件：上传文件并在文章中插入下载链接" : "Attachment: upload a file and insert its download link"} · ⌘⌥A / Ctrl+Alt+A`} aria-label={tx.insertAttachment} onMouseDown={(event) => { event.preventDefault(); rememberMediaTarget() }} onClick={() => openMediaPicker("attachment")}>{assetUploading === "attachment" ? <LoaderCircle /> : <Paperclip />}</button></span></div><div className="lw-md-layout-switch"><button type="button" className={`lw-md-save ${dirty ? "active" : ""}`} disabled={!dirty || saving} title={`${saving ? tx.saving : zh ? "保存：立即保存当前文章" : "Save the current article now"} · ⌘S / Ctrl+S`} aria-label={tx.save} onMouseDown={(event) => event.preventDefault()} onClick={() => onSave?.()}><Save /></button><button type="button" className={layout === "rich" ? "active" : ""} title={zh ? "文稿模式：直接编辑排版后的文章" : "Document mode: edit the formatted article directly"} onClick={() => { setLayout("rich"); setTableContext(false) }}><Eye />{tx.richOnly}</button><button type="button" className={layout === "source" ? "active" : ""} title={zh ? "Markdown 模式：编辑原始 Markdown 文本" : "Markdown mode: edit the raw Markdown source"} onClick={() => { setLayout("source"); setTableContext(false) }}><Code2 />{tx.sourceOnly}</button><button type="button" className={layout === "split" ? "active" : ""} title={zh ? "双栏模式：同时查看 Markdown 和排版结果" : "Split mode: view Markdown and formatted content together"} onClick={() => { setLayout("split"); setTableContext(false) }}><Columns2 />{tx.splitView}</button>{layout === "split" && <button type="button" className="lw-swap-columns" title={zh ? "交换双栏左右位置" : "Swap the split columns"} aria-label={tx.swapColumns} onClick={() => setSwapped((value) => !value)}><ArrowLeftRight /></button>}</div>{highlightPalette && <div className="lw-md-highlight-palette" style={{ left: highlightPalette.left }} role="menu" aria-label={zh ? "选择高亮颜色" : "Choose highlight color"} onPointerDown={(event) => event.stopPropagation()}>{HIGHLIGHT_COLORS.map((color) => <button type="button" role="menuitem" className={color.id === highlightColorId ? "selected" : ""} key={color.id} title={`${zh ? color.zh : color.en}${zh ? "高亮：选择后立即应用" : " highlight: choose and apply"}`} aria-label={zh ? color.zh : color.en} onMouseDown={(event) => event.preventDefault()} onClick={() => applyHighlightColor(color.id)}><span data-highlight-color={color.id} style={{ backgroundColor: color.value }} />{color.id === highlightColorId && <CheckCircle2 />}</button>)}</div>}</div>
    {tableHint && <div className="lw-md-table-hint" role="status">{tableHint}</div>}
    <div className={`lw-md-workspace layout-${layout} ${swapped ? "swapped" : ""}`}>{layout !== "rich" && <textarea ref={ref} className="lw-md-source" value={value} onChange={(event) => changeValue(event.target.value, "input")} onKeyDown={onKeyDown} onClick={updateSourceTableContext} onKeyUp={updateSourceTableContext} onSelect={updateSourceTableContext} spellCheck="false" aria-label={tx.sourceOnly} />}{layout !== "source" && <div className="lw-md-rich-column"><RichMarkdownSurface value={value} onChange={(next) => changeValue(next, "input")} onKeyDown={handleEditorShortcut} richRef={richRef} onTableCellSelect={(cell) => { richTableCellRef.current = cell; setTableContext(Boolean(cell)) }} onLinkClick={onLinkClick} pagePath={pagePath} documentTitle={documentTitle} onDocumentTitleChange={onTitleChange} tx={tx} /></div>}</div>
  </div>
}

function SaveConflictDialog({ state, busy, copyFallback, tx, onCancel, onCompare, onCopy, onResolve }) {
  const ref = useRef(null)
  useEffect(() => {
    const previous = document.activeElement
    ref.current?.showModal()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [])
  useEffect(() => {
    if (copyFallback !== null) { const field = ref.current?.querySelector("[data-local-draft]"); field?.focus(); field?.select() }
  }, [copyFallback])
  return <dialog ref={ref} className="lw-dialog lw-conflict-dialog" aria-labelledby="lw-conflict-title" onCancel={event => { event.preventDefault(); if (!busy) onCancel() }}>
    <div className="lw-dialog-head"><h2 id="lw-conflict-title">{tx.conflictTitle}</h2><span>{state.path}</span></div>
    <div className="lw-dialog-body"><p className="lw-conflict-hint">{tx.versionChoiceHint}</p>
      {state.error && <p className="lw-conflict-error" role="alert">{state.error}</p>}
      {copyFallback !== null && <p className="lw-conflict-hint" role="status">{tx.copyManually}</p>}
      <div className="lw-conflict-versions"><label>{tx.localDraft}<textarea data-local-draft readOnly value={state.localContent} aria-label={tx.localDraft} /></label><label>{tx.remoteVersion}<textarea readOnly value={state.remote?.content || ""} placeholder={state.loading ? tx.loading : tx.readLatest} aria-label={tx.remoteVersion} /></label></div>
    </div>
    <div className="lw-dialog-foot"><button type="button" className="lw-btn" onClick={onCopy}>{tx.copyDraft}</button><button type="button" className="lw-btn" disabled={busy || state.loading} onClick={onCompare}>{tx.readLatest}</button><span className="lw-conflict-spacer" /><button type="button" className="lw-btn" disabled={busy} onClick={onCancel}>{tx.cancel}</button><button type="button" className="lw-btn" disabled={busy || state.loading || !state.remote} onClick={() => onResolve("remote")}>{tx.useRemote}</button><button type="button" className="lw-btn primary" disabled={busy || state.loading || !state.remote} onClick={() => onResolve("local")}>{busy ? tx.saving : tx.useLocal}</button></div>
  </dialog>
}

function WikiView({ projectPath, onEdit, tx, page, pages, openPage, refresh, toast, onDirtyChange, onNewPage, onOpenSidebar, onPageResolved }) {
  const [draft, setDraft] = useState(page?.content || "")
  const [saving, setSaving] = useState(false)
  const [autoSaveBlocked, setAutoSaveBlocked] = useState(null)
  const [titleDraft, setTitleDraft] = useState(pageTitle(page))
  const [comparison, setComparison] = useState(null)
  const [copyFallback, setCopyFallback] = useState(null)
  const comparisonRequestRef = useRef(0)
  const pageSourceRef = useRef({ path: page?.path || null, content: page?.content || "" })
  const pagePathRef = useRef(page?.path || null)
  const draftRef = useRef(draft)
  const saveAcknowledgementRef = useRef(null)
  const mountedRef = useRef(true)
  pagePathRef.current = page?.path || null
  draftRef.current = draft
  useEffect(() => () => { mountedRef.current = false }, [])
  useEffect(() => {
    const next = { path: page?.path || null, content: page?.content || "" }
    const previous = pageSourceRef.current
    const editingSamePage = previous.path === next.path && draft !== previous.content
    pageSourceRef.current = next
    if (previous.path !== next.path || !editingSamePage || draft === next.content) setDraft(next.content)
  }, [page?.path, page?.content])
  useEffect(() => { setTitleDraft(pageTitle(page)) }, [page?.path, page?.frontmatter?.title, page?.title])
  useEffect(() => {
    setAutoSaveBlocked(null); setComparison(null); setCopyFallback(null)
    comparisonRequestRef.current += 1
  }, [page?.path])
  const dirty = Boolean(page) && draft !== page.content
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false) }, [dirty, onDirtyChange])
  useEffect(() => {
    const preventLoss = (event) => { if (dirty) { event.preventDefault(); event.returnValue = "" } }
    window.addEventListener("beforeunload", preventLoss)
    return () => window.removeEventListener("beforeunload", preventLoss)
  }, [dirty])

  useEffect(() => {
    if (!page || !dirty || saving || autoSaveBlocked) return undefined
    const timer = window.setTimeout(() => save({ silent: true }), 800)
    return () => window.clearTimeout(timer)
  }, [dirty, draft, page?.path, page?.revision, saving, autoSaveBlocked])

  async function save({ silent = false, force = false } = {}) {
    if (!page || saving || !dirty || (autoSaveBlocked && !force)) return false
    if (autoSaveBlocked?.conflict) { if (force) await compareVersions(); return false }
    const path = page.path
    const content = draft
    const revision = page.revision
    const title = titleDraft.trim() || pageTitle(page)
    const hasStoredTitle = Object.prototype.hasOwnProperty.call(page.frontmatter || {}, "title")
    const submitTitle = hasStoredTitle || title !== pageTitle(page)
    setSaving(true)
    const request = (async () => {
      const body = { path, content, revision }
      if (submitTitle) body.title = title
      const updated = await api("/wiki/page", { method: "POST", projectPath, body })
      if (pagePathRef.current === path && draftRef.current === content && typeof updated.content === "string") {
        saveAcknowledgementRef.current = { before: content, after: updated.content }
        draftRef.current = updated.content
        setDraft(updated.content)
      }
      if (mountedRef.current && pagePathRef.current === path && onPageResolved) onPageResolved(updated)
      await refresh()
    })()
    try {
      await request
      if (!silent) toast(tx.saved)
      if (mountedRef.current && pagePathRef.current === path) setAutoSaveBlocked(null)
      return true
    } catch (error) {
      if (mountedRef.current && pagePathRef.current === path) setAutoSaveBlocked({ revision, content, conflict: error.status === 409, message: error.message })
      toast(error.status === 409 ? tx.saveConflict : error.message, "error")
      return false
    } finally {
      if (mountedRef.current) setSaving(false)
    }
  }

  function changeDraft(next) {
    onEdit?.()
    draftRef.current=next
    setDraft(next)
  }

  async function copyLocalDraft(content = draftRef.current) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable")
      await navigator.clipboard.writeText(content)
      if (mountedRef.current) setCopyFallback(null)
      toast(tx.draftCopied)
      return true
    } catch {
      if (mountedRef.current) setCopyFallback(content)
      return false
    }
  }

  function closeComparison() {
    comparisonRequestRef.current += 1
    setComparison(null)
  }

  async function compareVersions() {
    if (!page || saving) return false
    const snapshot = { path: page.path, localContent: draftRef.current, localTitle: titleDraft.trim() || pageTitle(page), remote: null, loading: true, error: "" }
    const requestId = ++comparisonRequestRef.current
    setComparison(snapshot)
    try {
      const remote = await api("/wiki/page?" + new URLSearchParams({ path: snapshot.path }))
      if (!remote || remote.path !== snapshot.path || typeof remote.content !== "string" || !remote.revision) throw new Error(tx.invalidPageVersion)
      if (!mountedRef.current || pagePathRef.current !== snapshot.path || comparisonRequestRef.current !== requestId) return false
      setComparison({ ...snapshot, remote, loading: false })
      return true
    } catch (error) {
      if (mountedRef.current && pagePathRef.current === snapshot.path && comparisonRequestRef.current === requestId) setComparison({ ...snapshot, loading: false, error: error.message })
      return false
    }
  }

  async function resolveComparison(choice) {
    const snapshot = comparison
    if (!snapshot?.remote || snapshot.loading || saving || !["local", "remote"].includes(choice)) return false
    if (pagePathRef.current !== snapshot.path) return false
    setSaving(true)
    try {
      let resolved = snapshot.remote
      if (choice === "local") {
        // This is a normal conditional save against the version the user just
        // reviewed. A second conflict must return to comparison, never force.
        const body = { path: snapshot.path, content: snapshot.localContent, title: snapshot.localTitle, revision: snapshot.remote.revision }
        resolved = await api("/wiki/page", { method: "POST", projectPath, body })
      }
      if (!resolved || resolved.path !== snapshot.path || typeof resolved.content !== "string" || !resolved.revision) throw new Error(tx.invalidPageVersion)
      if (!mountedRef.current || pagePathRef.current !== snapshot.path) return false
      if (onPageResolved?.(resolved) === false) return false
      pageSourceRef.current = { path: resolved.path, content: resolved.content }
      draftRef.current = resolved.content
      setDraft(resolved.content); setTitleDraft(pageTitle(resolved)); setAutoSaveBlocked(null); setCopyFallback(null)
      closeComparison()
      onDirtyChange(false)
      await refresh().catch(error => toast(error.message, "error"))
      toast(choice === "local" ? tx.saved : tx.remoteAccepted)
      return true
    } catch (error) {
      if (mountedRef.current && pagePathRef.current === snapshot.path) {
        const conflict = error.status === 409
        setAutoSaveBlocked({ revision: snapshot.remote.revision, content: snapshot.localContent, conflict, message: error.message })
        setComparison({ ...snapshot, remote: conflict ? null : snapshot.remote, loading: false, error: conflict ? tx.conflictChangedAgain : error.message })
      }
      return false
    } finally {
      if (mountedRef.current) setSaving(false)
    }
  }

  if (!page) return <Empty icon={BookOpen} title={tx.selectPage} description={pages.length ? undefined : tx.noPages} action={<button className="lw-btn primary" onClick={onNewPage}><Plus />{tx.newPage}</button>} />
  return <div className="lw-preview">
    {autoSaveBlocked && <section className="lw-save-status" role="status" aria-live="polite">
      <AlertTriangle aria-hidden="true" /><div className="lw-save-status-copy"><strong>{autoSaveBlocked.conflict ? tx.saveConflict : tx.saveFailed}</strong>{!autoSaveBlocked.conflict && autoSaveBlocked.message && <span>{autoSaveBlocked.message}</span>}</div>
      <div className="lw-save-status-actions"><button type="button" className="lw-btn sm" onClick={() => copyLocalDraft()}>{tx.copyDraft}</button><button type="button" className="lw-btn sm primary" disabled={saving} onClick={() => autoSaveBlocked.conflict ? compareVersions() : save({ force: true })}>{autoSaveBlocked.conflict ? tx.compareVersions : tx.retrySave}</button></div>
    </section>}
    {copyFallback !== null && !comparison && <label className="lw-draft-copy">{tx.copyManually}<textarea readOnly autoFocus value={copyFallback} onFocus={event => event.currentTarget.select()} aria-label={tx.localDraft} /></label>}
    <MarkdownEditor key={`${projectPath}:${page.path}`} projectPath={projectPath} saveAcknowledgement={saveAcknowledgementRef.current} value={draft} onChange={changeDraft} onSave={() => save({ force: true })} dirty={dirty} saving={saving} pagePath={page.path} pageTitle={titleDraft} onTitleChange={value=>{onEdit?.();setTitleDraft(value)}} onLinkClick={(event) => handleRenderedMarkdownClick(event, pages, openPage, toast, page.path, tx.pageNotFound)} onOpenSidebar={onOpenSidebar} toast={toast} tx={tx} />
    {comparison && <SaveConflictDialog state={comparison} busy={saving} copyFallback={copyFallback} tx={tx} onCancel={closeComparison} onCompare={compareVersions} onCopy={() => copyLocalDraft(comparison.localContent)} onResolve={resolveComparison} />}
  </div>
}

function SourcesView({ project, tx, sources, refresh, toast, sessionId, ensureSession }) {
  const projectPath=project.path
  const [busy, setBusy] = useState({})
  const inflight=useRef(new Set())
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef(null)
  const [linkOpen,setLinkOpen]=useState(false)

  async function uploadFiles(files) {
    if(inflight.current.has("upload"))return
    inflight.current.add("upload")
    setBusy(b=>({...b,upload:true}))
    try {
    for (const file of Array.from(files || [])) {
      if (file.size > 25 * 1024 * 1024) { toast(`${file.name}: ${tx.uploadTooLarge}`, "error"); continue }
      setBusy((b) => ({ ...b, [`upload:${file.name}`]: true }))
      try {
        const payload = await fileToPayload(file)
        try { await api("/sources/upload", { method: "POST", projectPath, body: payload }) }
        catch (error) {
          if (error.status !== 409 || !(await confirmAction(tx.replaceSource))) throw error
          await api("/sources/upload", { method: "POST", projectPath, body: { ...payload, overwrite: true } })
        }
        toast(`${tx.uploaded}: ${file.name}`)
      } catch (error) { toast(`${file.name}: ${error.message}`, "error") } finally { setBusy((b) => ({ ...b, [`upload:${file.name}`]: false })) }
    }
    await refresh()
    } finally {inflight.current.delete("upload");setBusy(b=>({...b,upload:false}));if(fileRef.current)fileRef.current.value=""}
  }

  async function ingest(source) {
    if(inflight.current.has(source.path)||inflight.current.has("all"))return
    inflight.current.add(source.path);setBusy(b=>({...b,[source.path]:true}))
    try {
      const targetSessionId = sessionId || await ensureSession()
      if (!targetSessionId) throw new Error(tx.noSession)
      await showCodexRequest(`$llm-wiki-ingest ${JSON.stringify(`${projectPath}/${source.path}`)}`,projectPath)
      toast(tx.sourceOrganizeQueued)
    } catch (error) { toast(error.message, "error") } finally {inflight.current.delete(source.path);setBusy(b=>({...b,[source.path]:false}))}
  }

  async function ingestAll() {
    const paths = sources.map((source) => source.path)
    if (!paths.length||inflight.current.size) return
    inflight.current.add("all");setBusy(b=>({...b,all:true}))
    try {
      const targetSessionId = sessionId || await ensureSession()
      if (!targetSessionId) throw new Error(tx.noSession)
      await showCodexRequest(`$llm-wiki-ingest ${paths.map((path) => JSON.stringify(`${projectPath}/${path}`)).join(" ")}`,projectPath)
      toast(tx.sourceOrganizeQueued)
    } catch (error) { toast(error.message, "error") } finally {inflight.current.delete("all");setBusy(b=>({...b,all:false}))}
  }

  async function remove(source) {
    if (!(await confirmAction(`${tx.delete}: ${source.name}?`))) return
    try { await api("/sources", { method: "DELETE", projectPath, body: { path: source.path } }); await refresh() } catch (error) { toast(error.message, "error") }
  }

  const zh=language()==="zh"
  return <div className="lw-view lw-sources-view"><div className="lw-sources-heading"><div><h1>{tx.sources}</h1><p>{zh?"保留原文，把需要的内容整理成笔记。":"Keep the original. Make notes from what matters."}</p></div><div className="lw-native-actions"><button className="lw-btn" onClick={()=>setLinkOpen(true)}><Link2/>{zh?"添加网页":"Add web page"}</button>{sources.length>0&&<button className="lw-btn primary" disabled={busy.upload} onClick={()=>fileRef.current?.click()}><Plus/>{tx.importFiles}</button>}</div></div>
    {linkOpen&&<SourceLinkDialog lang={language()} onClose={()=>setLinkOpen(false)} onImport={async url=>{await showCodexRequest(zh?`$llm-wiki-ingest 读取这个网页 ${JSON.stringify(url)}，保存原始资料和来源链接，再整理成笔记。`:`$llm-wiki-ingest Read this web page ${JSON.stringify(url)}, preserve its original content and source URL, then make notes.`,projectPath);toast(tx.sourceOrganizeQueued)}}/>}
    <input ref={fileRef} hidden type="file" multiple disabled={busy.upload} onChange={e=>uploadFiles(e.target.files)}/>
    <div className={`lw-view-body ${dragging?"is-dragging":""}`} onDragEnter={e=>{e.preventDefault();setDragging(true)}} onDragOver={e=>e.preventDefault()} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget))setDragging(false)}} onDrop={e=>{e.preventDefault();setDragging(false);uploadFiles(e.dataTransfer.files)}}>
      {!sources.length?<div className="lw-source-empty"><FolderOpen/><h2>{zh?"放入第一份资料":"Add your first source"}</h2><p>{zh?"拖入文件，或从电脑中选择。":"Drop a file here, or choose one from your computer."}</p><button className="lw-btn primary" disabled={busy.upload} onClick={()=>fileRef.current?.click()}><Plus/>{busy.upload?(zh?"正在添加…":"Adding…"):tx.importFiles}</button><small>PDF · Word · Markdown · {zh?"文本与图片":"Text & images"}</small></div>:<><div className="lw-source-list-heading"><span>{sources.length} {zh?"份资料":"sources"}</span><button className="lw-btn sm" disabled={Object.values(busy).some(Boolean)} onClick={ingestAll}>{busy.all?<LoaderCircle/>:<BookOpen/>}{tx.ingestAll}</button></div><div className="lw-source-list">{sources.map(source=><div className="lw-source-row" key={source.path}><div className="lw-source-icon"><FileText/></div><div className="lw-source-main"><div className="lw-source-name" title={source.path}>{source.name}</div><div className="lw-source-meta">{formatBytes(source.size)} · {source.modified?new Date(source.modified).toLocaleDateString(zh?'zh-CN':'en-US'):source.extension}</div></div><div className="lw-source-actions"><button className="lw-btn sm" disabled={busy[source.path]||busy.all||busy.upload} onClick={()=>ingest(source)}>{busy[source.path]?<LoaderCircle/>:<BookOpen/>}{tx.ingest}</button><button className="lw-btn sm danger" title={tx.delete} aria-label={`${tx.delete}: ${source.name}`} disabled={busy[source.path]||busy.all||busy.upload} onClick={()=>remove(source)}><Trash2/></button></div></div>)}</div><p className="lw-source-footnote">{zh?"整理会在当前 Codex 对话中执行，原文件不变。":"Organization runs in your current Codex conversation. Originals stay unchanged."}</p></>}
    </div></div>
}


const GRAPH_COLORS = ["#2563eb", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#0891b2", "#4f46e5", "#c026d3", "#ca8a04", "#0f766e"]

function graphTypeMeta(type, types = []) {
  const configured = types.find((item) => item.id === type)
  const known = TYPE_META[type]
  if (configured) {
    const generated = String(type).replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
    const legacyDefaults = type === "source" ? ["来源", "Source"] : []
    const defaultLabel = known && [known.zh, known.en, generated, ...legacyDefaults].includes(configured.label) ? known[language()] : configured.label
    return { ...configured, label: defaultLabel }
  }
  if (known) return { id: type, label: known[language()], color: known.color }
  const hash = Array.from(String(type)).reduce((sum, char) => sum + char.charCodeAt(0), 0)
  const readable = String(type).replace(/[-_]/g, " ")
  const label = /^[a-z0-9 ]+$/i.test(readable) ? readable.replace(/\b\w/g, (char) => char.toUpperCase()) : readable
  return { id: type, label, color: GRAPH_COLORS[hash % GRAPH_COLORS.length] }
}

function GraphCanvas({ data, openNode, selectNode, selectedId, hiddenTypes, controllerRef, projectPath }) {
  const ref = useRef(null)
  const callbacks=useRef({openNode,selectNode})
  callbacks.current={openNode,selectNode}
  useEffect(() => {
    if (!ref.current || !data?.nodes?.length) return
    let themePalette = readGraphThemePalette(ref.current)
    const graph = new Graph({ type: "mixed" })
    const visibleNodes = (data.nodes || []).filter((node) => !hiddenTypes.has(node.type))
    const visualImportance = calculateVisualImportance(visibleNodes)
    const nodes = visibleNodes.map((node) => {
      const score = visualImportance.get(String(node.id)) || 0
      return { ...node, visualImportance: score, finalSize: graphNodeVisuals(score).size }
    })
    const visibleNodeIds = new Set(nodes.map((node) => String(node.id)))
    const edges = (data.edges || []).filter((edge) => visibleNodeIds.has(String(edge.source)) && visibleNodeIds.has(String(edge.target)))
    const positionStorageKey = `llm-wiki:graph-positions:${projectPath || "default"}`
    let savedPositions = {}
    try {
      savedPositions = JSON.parse(window.localStorage.getItem(positionStorageKey) || "{}")
    } catch {}
    const { simulation, nodeById, extent, resizeViewport } = createForceLayout(nodes, edges, savedPositions, ref.current.getBoundingClientRect())
    nodes.forEach((node) => {
      const meta = graphTypeMeta(node.type, data.types)
      const position = nodeById.get(String(node.id)) || { x: 0, y: 0 }
      const importance = Math.max(0, Math.min(1, Number(node.importance || 0)))
      const score = Math.max(0, Math.min(1, Number(node.visualImportance || 0)))
      graph.addNode(String(node.id), { label: node.title || node.id, x: position.x, y: position.y, size: .7, finalSize: node.finalSize, labelSize: graphNodeVisuals(score).labelSize, importance, visualImportance: score, color: graphNodeColor(meta.color,themePalette), baseColor:meta.color, pagePath: node.path, nodeType: node.type, zIndex: Math.round(score * 1000) })
    })
    edges.forEach((edge, index) => {
      const source = String(edge.source), target = String(edge.target)
      try {
        const attrs = { label: edge.label || (edge.bidirectional ? "↔" : "→"), size: Math.max(1.15, Math.min(2.15, 1.02 + Number(edge.weight || 1) / 10)), color: edge.bidirectional ? themePalette.bidirectionalEdge : themePalette.edge, type: edge.bidirectional ? "line" : "arrow", relation: edge.label, bidirectional: Boolean(edge.bidirectional) }
        if (edge.bidirectional) graph.addUndirectedEdgeWithKey(`e${index}`, source, target, attrs)
        else graph.addDirectedEdgeWithKey(`e${index}`, source, target, attrs)
      } catch {}
    })
    let hovered = null
    let focusedNode = null
    let draggedNode = null
    let dragMoved = false
    let suppressClickUntil = 0
    let persistTimer = null
    let focusFrame = null
    const revealOrder = new Map([...nodes].sort((a, b) => Number(b.visualImportance || 0) - Number(a.visualImportance || 0)).map((node, index) => [String(node.id), index]))
    const revealStartedAt = performance.now()
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
    const drawNodeHover = (context, displayData) => {context.save();context.strokeStyle=displayData.color;context.lineWidth=2;context.beginPath();context.arc(displayData.x,displayData.y,displayData.size+4,0,Math.PI*2);context.stroke();context.restore()}
    const renderer = new Sigma(graph, ref.current, {
      renderLabels: false, renderEdgeLabels: false,
      edgeLabelSize: 9, defaultEdgeType: "line", zIndex: true, allowInvalidContainer: true,
      defaultDrawNodeHover: drawNodeHover,
      labelColor: { color: themePalette.text }, edgeLabelColor: { color: themePalette.muted },
      nodeReducer: (node, attrs) => {
        const attentionNode = hovered || focusedNode
        if (!attentionNode) return attrs
        if (node === attentionNode) return { ...attrs, forceLabel: true, attentionLabel: true, highlighted: true, size: Number(attrs.size || 1) * 1.18, zIndex: 3 }
        if (graph.hasNode(attentionNode) && graph.neighbors(attentionNode).includes(node)) return { ...attrs, forceLabel: true, zIndex: 2 }
        return { ...attrs, color: `${attrs.color}80`, forceLabel: false, zIndex: 0 }
      },
      edgeReducer: (edge, attrs) => (hovered || focusedNode) && !graph.extremities(edge).includes(hovered || focusedNode)
        ? { ...attrs, hidden: true }
        : (hovered || focusedNode) ? { ...attrs, size: Number(attrs.size || 1) * 1.65, color: themePalette.focusedEdge, forceLabel: true }
          : { ...attrs, color: attrs.bidirectional ? themePalette.bidirectionalEdge : themePalette.edge, label: "" },
    })
    renderer.on("resize", () => { resizeViewport(renderer.getDimensions()); simulation.alpha(Math.max(simulation.alpha(), .35)).restart(); controllerRef.current.ensureVisible?.() })
    renderer.setCustomBBox({ x: [-extent, extent], y: [-extent, extent] })
    const labelContext=renderer.getCanvases().labels.getContext("2d")
    const measured=new Map()
    const measureText=(text,size)=>{const key=`${size}:${text}`;if(!measured.has(key)){labelContext.font=`500 ${size}px -apple-system, BlinkMacSystemFont, sans-serif`;measured.set(key,labelContext.measureText(text).width)}return measured.get(key)}
    renderer.on("afterRender",()=>{
      const {width,height}=renderer.getDimensions()
      labelContext.clearRect(0,0,width,height)
      const attention=hovered||focusedNode
      const neighbors=new Set(attention&&graph.hasNode(attention)?graph.neighbors(attention):[])
      const entries=graph.nodes().map(id=>{const attrs=graph.getNodeAttributes(id),point=renderer.graphToViewport(attrs);return {id,...point,size:renderer.scaleSize(attrs.size)*(id===attention?1.18:1),fontSize:attrs.labelSize,label:attrs.label,importance:attrs.visualImportance,priority:id===attention?3:neighbors.has(id)?2:0}})
      const outer=ref.current.getBoundingClientRect()
      const obstacles=[...ref.current.parentElement.querySelectorAll('.lw-graph-tools,.lw-graph-panel:not([aria-hidden="true"]),.lw-graph-panel-expand')].map(el=>{const rect=el.getBoundingClientRect();return {x:rect.left-outer.left-5,y:rect.top-outer.top-5,width:rect.width+10,height:rect.height+10}})
      const labels=layoutGraphLabels(entries,{width,height,measureText,obstacles,maxLabels:Math.min(60,Math.max(3,Math.floor(width*height/6500)))})
      labelContext.save()
      for(const label of labels){labelContext.font=`500 ${label.fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;labelContext.lineWidth=4;labelContext.lineJoin="round";labelContext.strokeStyle=themePalette.background;labelContext.strokeText(label.text,label.x+4,label.y+label.fontSize+1);labelContext.fillStyle=themePalette.text;labelContext.fillText(label.text,label.x+4,label.y+label.fontSize+1)}
      labelContext.restore()
    })


    let themeRefreshFrame = null
    const refreshTheme = () => {
      if (themeRefreshFrame) window.cancelAnimationFrame(themeRefreshFrame)
      themeRefreshFrame = window.requestAnimationFrame(() => {
        themeRefreshFrame = null
        themePalette = readGraphThemePalette(ref.current)
        graph.updateEachNodeAttributes((node,attrs)=>({...attrs,color:graphNodeColor(attrs.baseColor,themePalette)}))
        // Read edge theme colors in the reducer so a theme change cannot request
        // a partial repaint while Sigma is rebuilding its program indices.
        renderer.refresh()
      })
    }
    const themeObserver = new MutationObserver(refreshTheme)
    for (let target = ref.current.parentElement; target; target = target.parentElement) {
      themeObserver.observe(target, { attributes: true, attributeFilter: ["class", "data-theme", "style"] })
    }
    const colorScheme = window.matchMedia?.("(prefers-color-scheme: dark)")
    colorScheme?.addEventListener?.("change", refreshTheme)
    document.addEventListener("themechange", refreshTheme)
    document.addEventListener("appearancechange", refreshTheme)

    function persistPositions() {
      let saved = {}
      try {const current=JSON.parse(window.localStorage.getItem(positionStorageKey)||"{}");if(current&&typeof current==="object"&&!Array.isArray(current))saved=current}catch{}
      nodeById.forEach((node, id) => { saved[id] = { x: node.x, y: node.y } })
      try { window.localStorage.setItem(positionStorageKey, JSON.stringify(saved)) } catch {}
    }
    function schedulePersist(delay = 900) {
      if (persistTimer) window.clearTimeout(persistTimer)
      persistTimer = window.setTimeout(persistPositions, delay)
    }
    function syncGraph() {
      const now = performance.now()
      graph.updateEachNodeAttributes((node, attrs) => {
        const physics = nodeById.get(node)
        const delay = Math.min((revealOrder.get(node) || 0) * 18, 620)
        const progress = reducedMotion ? 1 : Math.max(0, Math.min(1, (now - revealStartedAt - delay) / 260))
        const eased = 1 - Math.pow(1 - progress, 3)
        return physics ? { ...attrs, x: physics.x, y: physics.y, size: .7 + (attrs.finalSize - .7) * eased } : attrs
      })
    }

    simulation.on("tick", syncGraph).on("end", () => { syncGraph(); schedulePersist(0) })
    syncGraph()
    simulation.restart()

    renderer.on("clickNode", ({ node }) => { if (Date.now() < suppressClickUntil) return; focusedNode = node; callbacks.current.selectNode(node); renderer.refresh() })
    renderer.on("doubleClickNode", ({ node }) => { if (Date.now() < suppressClickUntil) return; const attrs = graph.getNodeAttributes(node); callbacks.current.openNode(attrs.pagePath || node) })
    renderer.on("clickStage", () => { focusedNode = null; callbacks.current.selectNode(null); renderer.refresh() })
    renderer.on("enterNode", ({ node }) => { hovered = node; ref.current.style.cursor = "grab"; renderer.refresh() })
    renderer.on("leaveNode", () => { hovered = null; ref.current.style.cursor = "default"; renderer.refresh() })
    const camera = renderer.getCamera()
    const mouse = renderer.getMouseCaptor()
    renderer.on("downNode", ({ node }) => {
      draggedNode = node
      dragMoved = false
      const physics = nodeById.get(node)
      if (physics) { physics.fx = physics.x; physics.fy = physics.y }
      simulation.alphaTarget(.22).alpha(Math.max(simulation.alpha(), .5)).restart()
      camera.disable()
      ref.current.style.cursor = "grabbing"
    })
    mouse.on("mousemovebody", (event) => {
      if (!draggedNode) return
      dragMoved = true
      const position = renderer.viewportToGraph(event)
      const physics = nodeById.get(draggedNode)
      if (physics) { physics.fx = position.x; physics.fy = position.y; physics.x = position.x; physics.y = position.y }
      syncGraph()
    })
    mouse.on("mouseup", () => {
      if (!draggedNode) return
      if (dragMoved) {
        suppressClickUntil = Date.now() + 250
      }
      const physics = nodeById.get(draggedNode)
      if (physics) { physics.fx = null; physics.fy = null }
      draggedNode = null
      dragMoved = false
      simulation.alphaTarget(0).alpha(Math.max(simulation.alpha(), .32)).restart()
      schedulePersist(1400)
      camera.enable()
      ref.current.style.cursor = hovered ? "grab" : "default"
    })
    function ensureFocusedNodeVisible() {
      if(focusFrame)window.cancelAnimationFrame(focusFrame)
      if(!focusedNode)return
      focusFrame=window.requestAnimationFrame(()=>{
        focusFrame=null
        if(!focusedNode||!graph.hasNode(focusedNode))return
        const {width,height}=renderer.getDimensions(),outer=ref.current.getBoundingClientRect()
        const panel=ref.current.parentElement.querySelector('.lw-graph-panel:not([aria-hidden="true"])')
        const panelRect=panel?.getBoundingClientRect()
        const usableHeight=panelRect && panelRect.width>width*.7 ? Math.max(100,Math.min(height,panelRect.top-outer.top-12)) : height
        const point=renderer.graphToViewport(graph.getNodeAttributes(focusedNode))
        if(point.x>=56&&point.x<=width-40&&point.y>=40&&point.y<=usableHeight-32)return
        const node=renderer.getNodeDisplayData(focusedNode)
        const target=renderer.viewportToFramedGraph({x:width/2,y:usableHeight/2}),state=camera.getState()
        camera.animate({x:state.x+node.x-target.x,y:state.y+node.y-target.y},{duration:reducedMotion?0:180})
      })
    }
    controllerRef.current = { ensureVisible:ensureFocusedNodeVisible, select: (id) => { focusedNode = id != null && graph.hasNode(String(id)) ? String(id) : null; renderer.refresh(); ensureFocusedNodeVisible() }, zoomIn: () => camera.animatedZoom({ duration: 180 }), zoomOut: () => camera.animatedUnzoom({ duration: 180 }), reset: () => camera.animatedReset({ duration: 250 }) }
    return () => {
      simulation.stop()
      persistPositions()
      if (persistTimer) window.clearTimeout(persistTimer)
      if (focusFrame) window.cancelAnimationFrame(focusFrame)
      if (themeRefreshFrame) window.cancelAnimationFrame(themeRefreshFrame)
      themeObserver.disconnect()
      colorScheme?.removeEventListener?.("change", refreshTheme)
      document.removeEventListener("themechange", refreshTheme)
      document.removeEventListener("appearancechange", refreshTheme)
      controllerRef.current = {}
      renderer.kill()
    }
  }, [data, hiddenTypes, controllerRef, projectPath])
  useEffect(() => { controllerRef.current.select?.(selectedId) }, [selectedId, data, hiddenTypes, controllerRef])
  return <div ref={ref} className="lw-graph-canvas" />
}

function GraphView({ tx, graphData, graphError, loadGraph, openGraphNode, toast, projectPath }) {
  const [selectedId, setSelectedId] = useState(null)
  const [nodeQuery, setNodeQuery] = useState("")
  const [graphBusy, setGraphBusy] = useState(false)
  const graphBusyRef = useRef(false)
  const [hiddenTypes, setHiddenTypes] = useState(() => new Set())
  const [editingTypes, setEditingTypes] = useState(false)
  const [typeDraft, setTypeDraft] = useState({})
  const typeDraftDirty = useRef(false)
  const typeSavingRef = useRef(false)
  const [typeSaving, setTypeSaving] = useState(false)
  const [newType, setNewType] = useState("")
  const [panelCollapsed, setPanelCollapsed] = useState(true)
  const controllerRef = useRef({})
  const graphRoot=useRef(null),[displayPalette,setDisplayPalette]=useState(()=>graphThemePalette(null))
  useEffect(()=>{const refresh=()=>{if(graphRoot.current)setDisplayPalette(readGraphThemePalette(graphRoot.current))};refresh();document.addEventListener("themechange",refresh);document.addEventListener("appearancechange",refresh);return()=>{document.removeEventListener("themechange",refresh);document.removeEventListener("appearancechange",refresh)}},[Boolean(graphData)])
  useEffect(() => { if (!graphData) loadGraph() }, [graphData, loadGraph])
  useEffect(() => {
    const node=selectedId==null?null:graphData?.nodes?.find(node=>String(node.id)===String(selectedId))
    updateSelection({path:projectPath},node?{path:node.path,revision:null}:null).catch(error=>console.warn("Host graph context:",error.message))
  }, [projectPath, selectedId, graphData])
  useEffect(() => { if (editingTypes || typeDraftDirty.current) return; setTypeDraft(Object.fromEntries((graphData?.types || []).map((type) => { const meta = graphTypeMeta(type.id, graphData.types); return [type.id, { label: meta.label, color: type.color }] }))) }, [graphData, tx.graphTypes, editingTypes])
  useEffect(() => { if (!panelCollapsed) controllerRef.current.ensureVisible?.() }, [panelCollapsed, editingTypes])
  if (!graphData) return graphError?<Empty icon={AlertTriangle} title={tx.loadFailed} description={graphError} action={<button className="lw-btn" onClick={loadGraph}>{tx.retry}</button>}/>:<Loading text={tx.loading} />

  if (!graphData.nodes?.length) return <div className="lw-view"><div className="lw-view-head"><h2>{tx.graph}</h2><span className="spacer" /><button className="lw-btn sm" onClick={loadGraph}><RefreshCw />{tx.refresh}</button></div><Empty icon={Network} title={tx.graphEmpty} description={tx.graphEmptyDesc} /></div>
  const selected = selectedId==null?null:graphData.nodes.find((node) => String(node.id) === String(selectedId))
  const connections = selected ? graphData.edges.filter((edge) => String(edge.source) === String(selected.id) || String(edge.target) === String(selected.id)) : []
  function toggleType(type) { setHiddenTypes((before) => { const next = new Set(before); next.has(type) ? next.delete(type) : next.add(type); return next }) }
  async function saveTypes() {
    if (typeSavingRef.current) return
    typeSavingRef.current=true;setTypeSaving(true)
    try {
      await api("/graph/config", { method: "POST", projectPath, body: { types: typeDraft } })
      typeDraftDirty.current=false;setEditingTypes(false)
      await loadGraph();toast(tx.saved)
    } catch (error) { toast(error.message, "error") }
    finally { typeSavingRef.current=false;setTypeSaving(false) }
  }
  function addType() {
    const id = newType.trim().toLowerCase().replace(/\s+/g, "-")
    if (typeSavingRef.current || !id || typeDraft[id]) return
    typeDraftDirty.current=true
    const meta = graphTypeMeta(id)
    setTypeDraft((before) => ({ ...before, [id]: { label: meta.label, color: meta.color } })); setNewType("")
  }
  async function runGraphAction(action) {
    if (graphBusyRef.current) return
    graphBusyRef.current=true;setGraphBusy(true)
    try {
      const request=buildGraphRequest({projectPath,graphData,selectedId,action,language:language()})
      await showCodexRequest(request.message,projectPath,request.context)
      toast(uiText("已发送到 Codex", "Sent to Codex"))
    } catch (error) { toast(error.message, "error") }
    finally { graphBusyRef.current=false;setGraphBusy(false) }
  }
  function selectGraphNode(nodeId) {
    setSelectedId(nodeId)
    if (nodeId != null) {
      setPanelCollapsed(false);setNodeQuery("");setEditingTypes(false)
      const node=graphData.nodes.find(row=>String(row.id)===String(nodeId))
      if(node && hiddenTypes.has(node.type))setHiddenTypes(before=>{const next=new Set(before);next.delete(node.type);return next})
    }
  }
  return <div ref={graphRoot} className={`lw-graph-shell ${panelCollapsed ? "panel-collapsed" : ""}`}>
    <GraphCanvas data={graphData} openNode={openGraphNode} selectNode={selectGraphNode} selectedId={selectedId} hiddenTypes={hiddenTypes} controllerRef={controllerRef} projectPath={projectPath} />
    <div className="lw-graph-tools"><button className="lw-btn icon" title={tx.refresh} onClick={loadGraph}><RefreshCw /></button><button className="lw-btn icon" title={tx.zoomIn} onClick={() => controllerRef.current.zoomIn?.()}><ZoomIn /></button><button className="lw-btn icon" title={tx.zoomOut} onClick={() => controllerRef.current.zoomOut?.()}><ZoomOut /></button><button className="lw-btn icon" title={tx.resetView} onClick={() => controllerRef.current.reset?.()}><Network /></button><button className="lw-btn primary" title={tx.graphOrganizeHint} disabled={graphBusy} onClick={() => runGraphAction("organize")}><Link2 />{tx.graphOrganize}</button></div>
    <div className="lw-graph-status">{graphData.stats?.node_count || 0} {tx.pages} · {graphData.stats?.edge_count || 0} {tx.graphConnections} · {graphData.stats?.bidirectional_count || 0} {tx.graphBidirectional}</div>
    {panelCollapsed && <button className="lw-graph-panel-expand lw-btn icon" title={tx.graphExpandPanel} onClick={() => setPanelCollapsed(false)}><PanelRightOpen /></button>}
    <aside className="lw-graph-panel" aria-hidden={panelCollapsed}><div className="lw-graph-panel-head"><div><strong>{selected ? selected.title : tx.graphTypes}</strong><small>{selected ? graphTypeMeta(selected.type, graphData.types).label : tx.graphSelectHint}</small></div><div className="lw-graph-panel-actions"><button className="lw-btn ghost icon" title={tx.graphCollapsePanel} onClick={() => setPanelCollapsed(true)}><PanelRightClose /></button><button className="lw-btn ghost icon" title={tx.graphTypes} disabled={typeSaving} onClick={() => setEditingTypes((value) => !value)}><Settings /></button></div></div><div className="lw-graph-find"><input type="search" className="lw-input" aria-label={uiText("查找图中笔记","Find a note in the graph")} placeholder={uiText("查找笔记…","Find a note…")} value={nodeQuery} onChange={event=>setNodeQuery(event.target.value)} onKeyDown={event=>{if(event.key==="Escape")setNodeQuery("")}} />{nodeQuery.trim() && <div className="lw-graph-results">{findGraphNodes(graphData.nodes,nodeQuery).map(node=><button className="lw-connection" key={node.id} onClick={()=>selectGraphNode(node.id)}><span className="lw-dot" style={{"--type-color":graphNodeColor(graphTypeMeta(node.type,graphData.types).color,displayPalette)}}/><span>{node.title}</span></button>)}{!findGraphNodes(graphData.nodes,nodeQuery).length && <p className="lw-muted">{uiText("没有找到笔记","No notes found")}</p>}</div>}</div>{editingTypes ? <fieldset className="lw-type-editor" disabled={typeSaving}>{Object.entries(typeDraft).map(([typeId, type]) => <div className="lw-type-edit-row" key={typeId}><input type="color" aria-label={`${type.label || typeId} · ${uiText("颜色","Color")}`} value={type.color} onChange={(event) => { typeDraftDirty.current=true; setTypeDraft((before) => ({ ...before, [typeId]: { ...before[typeId], color: event.target.value } })) }} /><input className="lw-input" aria-label={`${typeId} · ${uiText("显示名称","Display name")}`} value={type.label || ""} onChange={(event) => { typeDraftDirty.current=true; setTypeDraft((before) => ({ ...before, [typeId]: { ...before[typeId], label: event.target.value } })) }} /><code>{typeId}</code></div>)}<div className="lw-type-add"><input className="lw-input" aria-label={tx.typeIdPlaceholder} value={newType} onChange={(event) => setNewType(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addType()} placeholder={tx.typeIdPlaceholder} /><button className="lw-btn icon" onClick={addType} title={tx.addType}><Plus /></button></div><button className="lw-btn primary" onClick={saveTypes}><Save />{typeSaving ? uiText("正在保存…","Saving…") : tx.graphSaveTypes}</button></fieldset> : selected ? <div className="lw-node-inspector"><div className="lw-node-meta"><span className="lw-dot" style={{ "--type-color": graphNodeColor(graphTypeMeta(selected.type, graphData.types).color,displayPalette) }} />{graphTypeMeta(selected.type, graphData.types).label}<span>{selected.in_degree || 0} {tx.incoming} · {selected.out_degree || 0} {tx.outgoing}</span></div><div className="lw-node-importance">{tx.graphImportance} · {Math.round(Number(selected.importance || 0) * 100)}%</div><button className="lw-btn primary" onClick={() => openGraphNode(selected.path)}><FileText />{tx.graphOpenPage}</button><button className="lw-btn" disabled={graphBusy} onClick={()=>runGraphAction("explain")}><MessageSquare />{uiText("在 Codex 中讨论","Discuss in Codex")}</button><h4>{tx.graphConnections}</h4>{connections.length ? connections.map((edge, index) => { const otherId = String(edge.source) === String(selected.id) ? edge.target : edge.source; const other = graphData.nodes.find((node) => String(node.id) === String(otherId)); const defaultLabel = edge.bidirectional ? tx.graphTwoWay : tx.graphReference; return <button className="lw-connection" key={`${edge.source}-${edge.target}-${index}`} onClick={() => selectGraphNode(otherId)}><span>{other?.title || otherId}</span><small>{edge.bidirectional ? "↔" : String(edge.source) === String(selected.id) ? "→" : "←"} {edge.label === "双向关联" || edge.label === "引用" ? defaultLabel : edge.label || defaultLabel}</small></button> }) : <p className="lw-muted">{tx.graphNoConnections}</p>}</div> : <div className="lw-type-list">{(graphData.types || []).filter((type) => type.count > 0).map((type) => <button className={hiddenTypes.has(type.id) ? "hidden" : ""} key={type.id} aria-pressed={!hiddenTypes.has(type.id)} onClick={() => toggleType(type.id)}><span className="lw-dot" style={{ "--type-color": graphNodeColor(type.color,displayPalette) }} /><span>{graphTypeMeta(type.id,graphData.types).label}</span><small>{type.count}</small></button>)}</div>}</aside>
  </div>
}

function ToolsView({ tx }) {
  const zh = language() === "zh"
  const skills = [
    ["llm-wiki-onboard", Sparkles, zh ? "和 Codex 一起设置知识库的用途、分类和语言。" : "Set up the wiki name, purpose, structure, and language through the native conversation."],
    ["llm-wiki-ingest", BookOpen, zh ? "用当前 Codex 会话读取来源，生成并合并 Wiki 页面。" : "Read sources with the current Codex conversation, then create and merge wiki pages."],
    ["llm-wiki-relink", Network, zh ? "让 AI 按页面内容识别不限数量的类型，并补充有依据的双向知识连接。" : "Infer content-specific types and add evidence-based reciprocal knowledge links."],
    ["llm-wiki-research", Globe2, zh ? "查找资料，保存结论和来源。" : "Use Codex's native web research and save a cited synthesis."],
    ["llm-wiki-lint", ClipboardCheck, zh ? "检查孤岛、断链与未链接其他笔记，并给出修复方向。" : "Check orphan pages, broken links, and missing outgoing links."],
    ["llm-wiki-global", Database, zh ? "查询默认知识库，并按用户明确意图保存值得长期保留的对话信息。" : "Query the global wiki and save durable conversation knowledge with explicit user intent."],
    ["llm-wiki-capture", MessageSquare, zh ? "归纳当前对话中已确认、值得长期保留的知识，优先写入该对话绑定的知识库。" : "Capture confirmed durable knowledge from this conversation, preferring its session-bound wiki."],
  ]
  return <div className="lw-view"><div className="lw-view-body"><div className="lw-card-list"><h1 style={{ margin: "0 0 5px", fontSize: 21 }}>{tx.skills}</h1><p className="lw-muted" style={{ marginTop: 0 }}>{tx.skillsIntro}</p>{skills.map(([name, Icon, desc]) => <div className="lw-review-card" key={name}><div className="lw-review-top"><div className="lw-review-type"><Icon /></div><div className="lw-review-main"><div className="lw-review-title">{name}</div><div className="lw-review-desc">{desc}</div></div></div></div>)}</div></div></div>
}

function MemorySettings({project}) {
 const t=uiText
  const [kb,setKb]=useState("")
  const [link,setLink]=useState(null)
  const [status,setStatus]=useState("")
  const [pending,setPending]=useState(false)
  useEffect(()=>{api("/memory/status",{projectPath:project.path}).then(x=>setLink(x.link)).catch(e=>setStatus(e.message))},[project.path])
  return <section className="lw-settings-section"><h3>{t("已关联的记录","Linked history")}</h3><p className="lw-help">{t("关联后，可以查找以前的讨论和决定，并查看原始出处。","Find earlier discussions and decisions, with links to the original records.")}</p><p className="aw-path">{link?t("已关联 · ","Linked · ")+link.kb:t("尚未关联会话知识库","No conversation library linked")}</p><label htmlFor="memory-root">{t("会话知识库文件夹","Conversation library folder")}</label><input id="memory-root" className="lw-input" value={kb} onChange={e=>setKb(e.target.value)} /><div className="lw-native-actions"><button className="lw-btn" disabled={!kb.trim() || pending} onClick={async()=>{setPending(true);try{await api("/memory/link",{method:"POST",projectPath:project.path,body:{kb}});const x=await api("/memory/status",{projectPath:project.path});setLink(x.link);setStatus(t("关联已验证并保存。","Library verified and linked."))}catch(e){setStatus(e.message)}finally{setPending(false)}}}>{t("关联知识库","Link library")}</button><button className="lw-btn" onClick={async()=>{try{await showCodexRequest(t("请使用 Agent wiki 插件内的 agent-session-knowledge-rebuilder Skill。先读取该插件的 skills/agent-session-knowledge-rebuilder/SKILL.md 和 skills/llm-wiki/references/session-memory.md；不要改用同名独立 Skill。请帮我配置会话知识库，先确认来源与私人输出目录。保留已有证据，不自动扩大扫描范围。","Use the agent-session-knowledge-rebuilder Skill bundled with Agent wiki. Read its skills/agent-session-knowledge-rebuilder/SKILL.md and skills/llm-wiki/references/session-memory.md first; do not substitute the standalone Skill with the same name. Help me configure a conversation library. Confirm sources and the private output folder first. Preserve existing evidence and do not expand the scan scope automatically."),project.path)}catch(e){setStatus(e.message)}}}>{t("帮我整理历史会话","Organize past conversations")}</button></div><p role="status" className="lw-help">{status}</p></section>
}

function RecoverySettings() {
 const t=uiText
 const [sessions,setSessions]=useState("")
 const [snapshots,setSnapshots]=useState("")
 const [status,setStatus]=useState("")
 const [pending,setPending]=useState(false)
 return <section className="lw-settings-section"><h3>{t("历史快照恢复","Recover snapshots")}</h3><p className="lw-help">{t("选择原 OpenClacky 会话与快照目录后，扫描可恢复的知识库。恢复会复制到新目录，保留原快照与冲突版本。","Choose the original OpenClacky session and snapshot folders. Recovered libraries are copied to new folders; original snapshots and conflicting versions are preserved.")}</p><label htmlFor="recovery-sessions">{t("原会话目录","Original sessions folder")}</label><input id="recovery-sessions" className="lw-input" value={sessions} onChange={e=>setSessions(e.target.value)}/><label htmlFor="recovery-snapshots">{t("原快照目录","Original snapshots folder")}</label><input id="recovery-snapshots" className="lw-input" value={snapshots} onChange={e=>setSnapshots(e.target.value)}/><button className="lw-btn" disabled={!sessions.trim()||!snapshots.trim()||pending} onClick={async()=>{setPending(true);try{const result=await api("/recovery/config",{method:"POST",body:{sessions_root:sessions,snapshots_root:snapshots}});setStatus(t(`找到 ${result.candidates.length} 个可恢复知识库，可在知识库列表中选择恢复。`,`Found ${result.candidates.length} recoverable libraries. Choose one from the library list.`))}catch(e){setStatus(e.message)}finally{setPending(false)}}}>{pending?t("正在检查…","Checking…"):t("检查恢复来源","Check recovery folders")}</button><p role="status">{status}</p></section>
}

function GlobalSettings({project}) {
 const t=uiText
 const [state,setState]=useState(null),[status,setStatus]=useState(""),[pending,setPending]=useState(false)
 useEffect(()=>{api("/global-project",{projectPath:null}).then(setState).catch(e=>setStatus(e.message))},[])
 async function change(body){setPending(true);try{const next=await api("/global-project",{method:"POST",body,projectPath:null});setState(next);window.dispatchEvent(new CustomEvent(GLOBAL_ACCESS_EVENT,{detail:next}));setStatus(t("设置已保存。","Settings saved."))}catch(e){setStatus(e.message)}finally{setPending(false)}}
 return <section className="lw-settings-section"><h3>{t("默认知识库","Default library")}</h3><p className="lw-help">{t("新对话需要查笔记时优先使用这里，可随时暂停或切换。设为默认不会自动保存对话；写入按你提出的要求或事先约定的范围执行。","Use this library when a new conversation needs your notes. Pause or switch at any time. Selecting a default does not save conversations automatically; writing follows your request or an agreed scope.")}</p><p>{state?.selected?`${state.project?.name} · ${state.active?t("已启用","Lookup enabled"):t("已暂停","Lookup paused")}`:t("尚未选择默认知识库","No default library selected")}</p><div className="lw-native-actions"><button className="lw-btn" disabled={pending || state?.project?.path===project.path} onClick={async()=>{if(await confirmAction(t(`将“${project.name}”设为默认知识库？`,`Use “${project.name}” as your default library?`)))change({path:project.path})}}>{t("使用这个知识库","Use this library")}</button>{state?.selected && <><button className="lw-btn" disabled={pending} onClick={()=>change({enabled:!state.active})}>{state.active?t("暂停默认查找","Pause default lookup"):t("恢复默认查找","Resume default lookup")}</button><button className="lw-btn" disabled={pending} onClick={()=>change({clear:true})}>{t("清除默认选择","Clear default")}</button></>}</div><p role="status">{status}</p></section>
}

function SettingsView({ tx, project, initialSection="general" }) {
  const [section, setSection] = useState(initialSection)
  const zh=language()==="zh"
  const nav = [["general", BookOpen, zh?"通用":"General"],["memory",History,zh?"会话记录":"History"],["images",ImagePlus,zh?"图片":"Images"],["recovery",History,zh?"恢复旧资料":"Recovery"],["about",Info,tx.about]]
  return <div className="lw-settings-layout"><aside className="lw-settings-nav"><h2>{tx.settings}</h2>{nav.map(([id,Icon,label])=><button className={`lw-settings-link ${section===id?"active":""}`} key={id} onClick={()=>setSection(id)}><Icon/>{label}</button>)}</aside><main className="lw-settings-main"><div className="lw-settings-main-inner">
    {section==="general"?<><h1>{project.name}</h1><section className="lw-settings-section"><h3>{zh?"界面语言":"Interface language"}</h3><LanguageSelect lang={language()}/><p className="lw-help">{zh?"只切换界面文字，笔记内容保持原文。":"Changes interface text only. Your notes stay in their original language."}</p></section><section className="lw-settings-section"><h3>{zh?"外观":"Appearance"}</h3><AppearanceSelect lang={language()}/></section><section className="lw-settings-section"><h3>{tx.storageDirectory}</h3><input className="lw-input" aria-label={tx.storageDirectory} value={project.path||""} readOnly/><p className="lw-help">{zh?"笔记以 Markdown 保存，可以用其他编辑器打开。":"Notes are saved as Markdown and work in other editors."}</p></section><GlobalSettings project={project}/></>:section==="memory"?<><h1>{zh?"会话记录":"Conversation history"}</h1><MemorySettings project={project}/></>:section==="images"?<><h1>{zh?"图片":"Images"}</h1><ImagePolicySettings lang={language()}/></>:section==="recovery"?<><h1>{zh?"恢复旧资料":"Recover older libraries"}</h1><RecoverySettings/></>:<AboutProduct lang={language()} version={VERSION} build={BUILD}/>}
  </div></main></div>
}

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  render() { return this.state.error ? <Empty icon={AlertTriangle} title={this.props.tx.errorTitle} description={String(this.state.error?.message || this.state.error)} action={<button className="lw-btn" onClick={() => this.setState({ error: null })}>{this.props.tx.retry}</button>} /> : this.props.children }
}

function App({ initialSessionId = null, openProjectOnMount = false }) {
  const lang = useHostLanguage()
  const tx = I18N[lang]
  const [sessionId, setSessionId] = useState(initialSessionId)
  const [booting, setBooting] = useState(true)
  const [projects, setProjects] = useState([])
  const [project, setProject] = useState(null)
  const [view, setView] = useState("wiki")
  const [settingsSection,setSettingsSection]=useState("general")
  const [preferencesOpen,setPreferencesOpen]=useState(false)
  const [guideOpen,setGuideOpen]=useState(false)
  const [newPageFocusPath,setNewPageFocusPath]=useState(null)
  const [workspaceBusy,setWorkspaceBusy]=useState(false)
  const workspaceBusyRef=useRef(false)
  async function withWorkspaceMutation(action){if(workspaceBusyRef.current)return false;workspaceBusyRef.current=true;setWorkspaceBusy(true);try{return await action()}finally{workspaceBusyRef.current=false;setWorkspaceBusy(false)}}
  useEffect(()=>{const listener=()=>setView("chat");window.addEventListener("llm-wiki:codex-request",listener);return()=>window.removeEventListener("llm-wiki:codex-request",listener)},[])
  const [pages, setPages] = useState([])
  const [sources, setSources] = useState([])
  const [selectedPage, setSelectedPage] = useState(null)
  const selectedPageRef = useRef(null)
  selectedPageRef.current = selectedPage
  useEffect(() => { if(view==="graph")return; updateSelection(project,view==="wiki"?selectedPage:null).catch(error=>console.warn("Host context:",error.message)) }, [view,project?.path,selectedPage?.path,selectedPage?.revision])
  const [graphData, setGraphData] = useState(null)
  const [graphTypes, setGraphTypes] = useState([])
  const [sidebarOrder, setSidebarOrder] = useState({ types: {}, parents: {} })
  const [workspace,setWorkspace]=useState(()=>normalizeWorkspaceState(null))
  const [workspaceProject,setWorkspaceProject]=useState(null)
  const initialPageOpened=useRef(false)
  const pageRequest=useRef(0)
  const editorEditVersion=useRef(0)
  const [palette,setPalette]=useState(null)
  const [graphLoading,setGraphLoading]=useState(false)
  const [graphError,setGraphError]=useState("")
  const graphRequest=useRef(0)
  const refreshRequest=useRef(0)
  const leftWidth=workspace.leftWidth
  const setLeftWidth=value=>setWorkspace(current=>({...current,leftWidth:value}))
  useEffect(()=>{
    pageRequest.current+=1
    initialPageOpened.current=false
    setWorkspace({...loadWorkspaceState(project?.path),...(window.innerWidth<=1100?{rightVisible:false}:{})})
    setWorkspaceProject(project?.path||null)
    setPalette(null)
  },[project?.path])
  useEffect(()=>{if(workspaceProject&&workspaceProject===project?.path)saveWorkspaceState(workspaceProject,workspace)},[workspace,workspaceProject,project?.path])
  useEffect(()=>{if(selectedPage?.path&&workspaceProject===project?.path)setWorkspace(current=>openWorkspaceTab(current,selectedPage.path))},[selectedPage?.path,workspaceProject,project?.path])
  useWorkspaceShortcuts({enabled:Boolean(project)&&!workspaceBusy&&!palette&&!createDialogOpenSafe(),onQuickOpen:()=>setPalette("pages"),onCommandPalette:()=>setPalette("commands")})
  function createDialogOpenSafe(){return document.querySelector("dialog[open]")!==null}

  useEffect(()=>{
    if(!newPageFocusPath||workspaceBusy||view!=="wiki"||selectedPage?.path!==newPageFocusPath)return
    const frame=requestAnimationFrame(()=>{
      const source=document.querySelector("textarea.lw-md-source")
      const rich=document.querySelector(".lw-md-rich[contenteditable]")
      if(rich){
        let end=rich.lastElementChild
        if(!end||/^H[1-6]$/.test(end.tagName)){end=document.createElement("p");end.append(document.createElement("br"));rich.append(end)}
        rich.focus();const range=document.createRange();range.selectNodeContents(end);range.collapse(false)
        const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range)
      }else if(source){source.focus();source.setSelectionRange(source.value.length,source.value.length)}
      setNewPageFocusPath(null)
    })
    return()=>cancelAnimationFrame(frame)
  },[newPageFocusPath,workspaceBusy,view,selectedPage?.path])

  const [toasts, setToasts] = useState([])
  const [editorDirty, setEditorDirty] = useState(false)
  const editorDirtyRef=useRef(editorDirty)
  editorDirtyRef.current=editorDirty
  const [creatingProject, setCreatingProject] = useState(false)
  const [newPageRequest, setNewPageRequest] = useState(null)
  useEffect(() => { setNewPageRequest(null) }, [project?.path])
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [trashOpen, setTrashOpen] = useState(false)
  const onboardingInFlightRef = useRef(false)
  const onboardingRequestRef = useRef(null)
  const sessionConnectRef = useRef(null)
  const connectedSessionRef = useRef(null)
  const showProjectListRef = useRef(false)
  const workspaceIntentRef = useRef(openProjectOnMount ? "project" : "home")

  useEffect(() => { setActiveSessionId(sessionId) }, [sessionId])
  useEffect(() => { setActiveProjectPath(project?.path) }, [project?.path])
  useEffect(() => {
    const update = (event) => {
      const detail = event.detail || {}
      const selectedPath = detail.project?.path || null
      const enabled = detail.enabled !== false
      setProject((current) => current ? {
        ...current,
        _globalSelected: current.path === selectedPath,
        _globalEnabled: current.path === selectedPath && enabled,
      } : current)
      setProjects((items) => items.map((item) => ({
        ...item,
        global_selected: item.path === selectedPath,
        global_enabled: item.path === selectedPath && enabled,
      })))
    }
    window.addEventListener(GLOBAL_ACCESS_EVENT, update)
    return () => window.removeEventListener(GLOBAL_ACCESS_EVENT, update)
  }, [])

  const toast = useCallback((message, type = "success") => {
    const id = `${Date.now()}-${Math.random()}`
    setToasts((items) => [...items, { id, message, type }])
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 3500)
  }, [])

  useEffect(()=>{const show=event=>toast(event.detail,"error");window.addEventListener("llm-wiki:host-error",show);return()=>window.removeEventListener("llm-wiki:host-error",show)},[toast])

  const canLeaveEditor = useCallback(async () => !editorDirty || await confirmAction(I18N[language()].unsavedConfirm), [editorDirty])
  const navigateView = useCallback(async (next) => {
    if (next === view) return true
    if (!(await canLeaveEditor())) return false
    setEditorDirty(false); setView(next); return true
  }, [canLeaveEditor, view])

  const loadProjects = useCallback(async () => {
    const workspaceIntent = workspaceIntentRef.current
    const statusSessionId = workspaceIntent === "project" ? (initialSessionId || null) : null
    const status = await api("/status", { sessionId: statusSessionId, projectPath: null })
    const globalPath = status.global_project?.path || null
    const list = (status.projects || []).map((item) => ({
      ...item,
      global_selected: item.path === globalPath,
      global_enabled: item.path === globalPath && status.global_enabled !== false,
    }))
    setProjects(list)
    setProject((selectedProject) => {
      const sessionProjectPath = statusSessionId ? status.project : null
      const preferredProject = list.find((item) => item.recoverable !== true && item.provisional !== true && Number(item.knowledge_page_count || item.page_count || 0) > 0)
        || list.find((item) => item.recoverable !== true && item.provisional !== true)
        || list.find((item) => item.recoverable !== true)
      const selectedPath = workspaceProjectPath({
        showProjectList: showProjectListRef.current,
        currentPath: selectedProject?.path,
        intent: workspaceIntent,
        sessionProjectPath,
        globalPath,
        preferredProjectPath: preferredProject?.path,
      })
      if (!selectedPath) {
        setActiveProjectPath(null)
        return null
      }
      const current = (status.project === selectedPath && status.project_info) || list.find((item) => item.path === selectedPath) || selectedProject
      if (!current) {
        setActiveProjectPath(null)
        return null
      }
      setActiveProjectPath(current.path)
      return { ...current, _globalSelected: status.global_project?.path === current.path, _globalEnabled: status.global_enabled !== false }
    })
  }, [initialSessionId, openProjectOnMount])

  useEffect(() => {
    const reopenWorkspace = (event) => {
      if (event.detail?.mode !== "home") return
      setBooting(true)
      workspaceIntentRef.current = "home"
      showProjectListRef.current = false
      setProject(null); setView("home"); setPages([]); setSources([]); setSelectedPage(null); setGraphData(null); setGraphTypes([]); setSidebarOrder({ types: {}, parents: {} })
      connectedSessionRef.current = null
      setSessionId(null); setActiveSessionId(null); setActiveProjectPath(null)
      loadProjects().catch((error) => toast(error.message, "error")).finally(() => setBooting(false))
    }
    window.addEventListener(WORKSPACE_OPEN_EVENT, reopenWorkspace)
    return () => window.removeEventListener(WORKSPACE_OPEN_EVENT, reopenWorkspace)
  }, [loadProjects, toast])

  const refreshData = useCallback(async (reopenPath) => {
    if (!project) return false
    const request=++refreshRequest.current,epoch=activeProjectEpoch
    const current=()=>request===refreshRequest.current && activeProjectPath===project.path && activeProjectEpoch===epoch
    const selectionAtStart=selectedPageRef.current?.path
    const editAtStart=editorEditVersion.current
    const requestOptions = { sessionId, projectPath: project.path }
    const results = await Promise.allSettled([
      api("/wiki/tree", requestOptions),
      api("/sources", requestOptions),
      api("/graph/config", requestOptions),
      api("/sidebar/order", requestOptions),
    ])
    if(!current()) return false
    if (results[0].status === "fulfilled") setPages(flattenTree(results[0].value.tree || []))
    if (results[1].status === "fulfilled") setSources(results[1].value.sources || [])
    if (results[2].status === "fulfilled") setGraphTypes(Object.entries(results[2].value.types || {}).map(([id, type]) => ({ id, ...type })))
    if (results[3].status === "fulfilled") setSidebarOrder(results[3].value || { types: {}, parents: {} })
    const failed = ["wiki", "sources", "graph", "sidebar"].filter((_, index) => results[index].status === "rejected")
    if (failed.length) {
      const detail = results.find((result) => result.status === "rejected")?.reason?.message
      toast(`${tx.loadFailed}: ${failed.join(", ")}${detail ? ` · ${detail}` : ""}`, "error")
    }
    if (reopenPath) {
      try {
        const reopenedPage = await api(`/wiki/page?path=${encodeURIComponent(reopenPath)}`, requestOptions)
        if(!current() || selectedPageRef.current?.path!==selectionAtStart || editorEditVersion.current!==editAtStart || editorDirtyRef.current)return
        selectedPageRef.current = reopenedPage
        setSelectedPage(reopenedPage)
      } catch (error) {
        if(!current() || selectedPageRef.current?.path!==selectionAtStart || editorEditVersion.current!==editAtStart || editorDirtyRef.current)return
        toast(error.message,"error")
      }
    }
    return current()
  }, [project, sessionId, toast, tx.loadFailed])

  useEffect(() => { loadProjects().catch((error) => toast(error.message, "error")).finally(() => setBooting(false)) }, [loadProjects, toast])
  useEffect(() => { if (project) refreshData() }, [project, refreshData])
  useEffect(() => { if (view !== "wiki") setMobileSidebarOpen(false) }, [view])
  useEffect(() => {
    if (!project?.provisional) return undefined
    const timer = window.setInterval(() => loadProjects().catch(() => {}), 3000)
    return () => window.clearInterval(timer)
  }, [project?.path, project?.provisional, loadProjects])

  useEffect(() => {
    if(!project?.path) return
    let cancelled=false, pending=false
    const projectPath=project.path
    async function syncExternalChanges(){
      if(pending || cancelled || document.hidden || editorDirtyRef.current) return
      pending=true
      try{
        if(await refreshData()===false || cancelled || editorDirtyRef.current || activeProjectPath!==projectPath)return
        const editVersion=editorEditVersion.current,epoch=activeProjectEpoch
        const current=selectedPageRef.current
        if(current?.path){
          const latest=await api("/wiki/page?"+new URLSearchParams({path:current.path}),{projectPath})
          if(!cancelled && !editorDirtyRef.current && editorEditVersion.current===editVersion && activeProjectEpoch===epoch && activeProjectPath===projectPath && selectedPageRef.current===current && current.path===latest.path && current.revision!==latest.revision){
            selectedPageRef.current=latest;setSelectedPage(latest);setGraphData(null)
          }
        }
      }catch(error){console.warn("Workspace sync:",error.message)}finally{pending=false}
    }
    const timer=window.setInterval(syncExternalChanges,5000)
    window.addEventListener("focus",syncExternalChanges)
    return()=>{cancelled=true;window.clearInterval(timer);window.removeEventListener("focus",syncExternalChanges)}
  },[project?.path,refreshData])

  const setGlobalProject = useCallback(async (item) => {
    if (!item?.path || item.recoverable) return false
    const message = tx.setGlobalConfirm.replace("{name}", item.name || item.path)
    if (!(await confirmAction(message))) return false
    try {
      await selectGlobalProjectForSession(sessionId, item.path)
      toast(tx.globalSetSuccess)
      return true
    } catch (error) {
      toast(error.message, "error")
      return false
    }
  }, [sessionId, toast, tx.globalSetSuccess, tx.setGlobalConfirm])

  const activateOpenedProject = useCallback((data, successMessage) => {
    const openedProject = projectFromPayload(data)
    if (!openedProject) throw new Error(tx.projectCreateFailed)
    connectedSessionRef.current = null
    showProjectListRef.current = false
    setActiveSessionId(null); setSessionId(null)
    setActiveProjectPath(openedProject.path)
    const opened = { ...openedProject, _globalSelected: data.global_selected === true, _globalEnabled: data.global_selected === true && data.global_enabled !== false }
    setProject(opened)
    setProjects((items) => [opened, ...items.filter((item) => item.path !== opened.path)])
    setView(loadWorkspaceState(openedProject.path).activePath ? "wiki" : "home"); setPages([]); setSources([]); setSelectedPage(null); setGraphData(null); setGraphTypes([]); setSidebarOrder({ types: {}, parents: {} })
    toast(successMessage)
    return openedProject
  }, [toast, tx.projectCreateFailed, tx.sessionCreateFailed])

  const loadExistingProject = useCallback(async (path) => {
    const data = await api("/projects/open-existing", { method: "POST", body: { path }, sessionId: sessionId || null, projectPath: null })
    const message = data.already_loaded ? tx.wikiAlreadyLoaded : data.imported ? tx.wikiImported : tx.wikiLoaded
    return activateOpenedProject(data, message)
  }, [activateOpenedProject, sessionId, tx.wikiAlreadyLoaded, tx.wikiImported, tx.wikiLoaded])

  const recoverHistoricalProject = useCallback(async (item) => {
    if (!item?.recovery_id) throw new Error(tx.projectCreateFailed)
    const data = await api("/projects/recover", {
      method: "POST",
      body: { recovery_id: item.recovery_id },
      sessionId: sessionId || null,
      projectPath: null,
    })
    const opened = activateOpenedProject(data, tx.wikiRecovered)
    setProjects((items) => items.filter((projectItem) => !projectItem.recoverable || projectItem.recovery_id !== item.recovery_id))
    return opened
  }, [activateOpenedProject, sessionId, tx.projectCreateFailed, tx.wikiRecovered])

  const ensureProjectSession = useCallback(async () => {
    if (!project?.path) throw new Error(tx.noSession)
    setActiveProjectPath(project.path)
    return "active-host-conversation"
  }, [project?.path, tx.noSession])

  const selectProject = useCallback(async (item) => {
    if (!(await canLeaveEditor())) return
    setBooting(true)
    try { await (item.recoverable ? recoverHistoricalProject(item) : loadExistingProject(item.path)) }
    catch (error) { toast(error.message, "error") }
    finally { setBooting(false) }
  }, [toast, canLeaveEditor, loadExistingProject, recoverHistoricalProject])

  const openProjectPath = useCallback(async (path) => {
    if (!(await canLeaveEditor())) return
    await loadExistingProject(path)
  }, [canLeaveEditor, loadExistingProject])

  const [createDialogOpen,setCreateDialogOpen]=useState(false)
  const startOnboarding = useCallback(()=>setCreateDialogOpen(true),[])
  async function createLibrary({name,purpose}) {
    if(!await canLeaveEditor())return false
    setCreatingProject(true)
    try {
      const data=await api("/projects",{method:"POST",body:{name,language:lang==="zh"?"Chinese":"English"},projectPath:null})
      const opened=activateOpenedProject(data,tx.wikiLoaded)
      if(purpose) {
        try { await api("/wiki/purpose",{method:"POST",projectPath:opened.path,body:{content:`# ${name}\n\n${purpose}\n`}}) }
        catch(error) { toast((lang==="zh"?"知识库已创建，用途未保存：":"Library created, purpose could not be saved: ")+error.message,"error") }
      }
    } finally {setCreatingProject(false)}
  }
  async function planLibrary({name,purpose}) {
    await askCodex(lang==="zh"?`$llm-wiki-onboard 创建一个新的独立知识库（create_new）。不要编辑现有或默认知识库。${name?`名称：${name}。`:""}${purpose?`用途：${purpose}。`:""}先根据已提供信息规划，只补充必要的缺失信息。`:`$llm-wiki-onboard Plan a new independent library (create_new). Do not edit an existing or default library. Name: ${JSON.stringify(name)}. Purpose: ${JSON.stringify(purpose)}. Use the information provided and ask only for essential missing details.`,{action:"create_new",knowledgeBase:null})
  }

  const openPage = useCallback(async (path) => {
    if (!path || !project?.path) return false
    if(selectedPageRef.current?.path===path){setView("wiki");return true}
    if (!(await canLeaveEditor())) return false
    const request=++pageRequest.current, projectPath=project.path, editVersion=editorEditVersion.current
    try {
      const data = await api(`/wiki/page?path=${encodeURIComponent(path)}`, { sessionId, projectPath })
      if(request!==pageRequest.current || activeProjectPath!==projectPath)return false
      if(editorEditVersion.current!==editVersion){toast(lang==="zh"?"已保留刚才的修改，请保存后再切换笔记。":"Your new edits were kept. Save them before switching notes.");return false}
      setEditorDirty(false)
      selectedPageRef.current = data
      setSelectedPage(data)
      setView("wiki")
      return true
    } catch (error) { toast(error.message, "error");return false }
  }, [toast, canLeaveEditor, sessionId, project?.path])

  useEffect(() => {
    if (view !== "wiki" || selectedPage || !pages.length || workspaceProject!==project?.path || initialPageOpened.current) return
    initialPageOpened.current=true
    const existing=normalizeWorkspaceState(workspace,{availablePaths:pages.map(p=>p.path)})
    setWorkspace(existing)
    const path=existing.activePath || pages[0].path
    openPage(path)
  }, [view, selectedPage, pages, openPage,workspaceProject,project?.path])

  async function closeTab(path){
    const next=closeWorkspaceTab(workspace,path)
    if(path===selectedPageRef.current?.path){
      if(next.activePath){if(!await openPage(next.activePath))return false}
      else {if(!await canLeaveEditor())return false;pageRequest.current+=1;selectedPageRef.current=null;setSelectedPage(null);setEditorDirty(false)}
    }
    setWorkspace(next);return true
  }

  const createPage = useCallback(async ({ title, type: requestedType, parentNode = null, parentPage = null, kind = "page" } = {}) => {
    if (!project || !(await canLeaveEditor())) return null
    const cleanTitle = String(title || "").trim()
    if (!cleanTitle) return null
    const parent = parentNode || (parentPage ? { kind: "page", page: parentPage, type: parentPage.type } : null)
    const parentDocument = parent?.page || parentPage || null
    const firstKnowledgePage = knowledgePages(pages)[0]
    const defaultType = requestedType || parent?.type || parentDocument?.type || selectedPage?.frontmatter?.type || firstKnowledgePage?.type || graphTypes[0]?.id || "other"
    const typeDirectory = typePageDirectory(knowledgePages(pages), defaultType)
    const folder = parent ? childPageDirectory(parent) : typeDirectory
    const slug = pageSlug(cleanTitle)
    const base = `wiki/${folder ? `${folder}/` : ""}${slug}`
    const path = kind === "category" ? `${base}/index.md` : `${base}.md`
    if (pages.some((page) => page.path.toLowerCase() === path.toLowerCase())) { toast(tx.pageExists, "error"); return null }
    if (hasSidebarLogicalPathConflict(pages, path)) { toast(tx.pagePathConflict, "error"); return null }
    const kindLine = kind === "category" ? "kind: category\n" : ""
    const content = `---\ntype: ${defaultType}\n${kindLine}title: ${JSON.stringify(cleanTitle)}\nsources: []\ncreated: ${new Date().toISOString().slice(0, 10)}\n---\n\n# ${cleanTitle}\n\n`
    const body = { path, content, create: true, kind }
    if (parentDocument?.path) body.parent_path = parentDocument.path
    else if (parent?.kind !== "type" && parent?.directory) body.parent_directory = `wiki/${String(parent.directory).replace(/^wiki\//, "")}`
    try {
      await api("/wiki/page", { method: "POST", projectPath:project.path, body })
      if(activeProjectPath!==project.path)return path
      await refreshData(path)
      setView("wiki");setNewPageFocusPath(path)
      toast(tx.saved)
      return path
    } catch (error) {
      toast(error.message, "error")
      return null
    }
  }, [project, canLeaveEditor, tx, pages, selectedPage, graphTypes, refreshData, toast])

  const createType = useCallback(async (label) => {
    const cleanLabel = String(label || "").trim()
    if (!cleanLabel) return null
    const id = pageSlug(cleanLabel)
    const duplicate = graphTypes.some((type) => type.id === id || String(type.label || "").toLocaleLowerCase() === cleanLabel.toLocaleLowerCase())
    if (duplicate) { toast(tx.tagExists, "error"); return null }
    const meta = graphTypeMeta(id)
    try {
      await api("/graph/config", { method: "POST", projectPath:project.path, body: { types: { [id]: { label: cleanLabel, color: meta.color } } } })
      await refreshData()
      toast(tx.tagCreated)
      return id
    } catch (error) { toast(error.message, "error"); return null }
  }, [project, graphTypes, refreshData, toast, tx.tagCreated, tx.tagExists])

  const requestNewPage = useCallback((parentPage = null, type = null) => {
    if (!project?.path) return false
    setView("wiki")
    setNewPageRequest({ key: `${Date.now()}-${Math.random()}`, projectPath: project.path, parentPage, type })
    return true
  }, [project?.path])
  const consumeNewPageRequest = useCallback((key, projectPath) => {
    setNewPageRequest(current => current?.key === key && current.projectPath === projectPath ? null : current)
  }, [])

  const movePage = useCallback(async (page) => {
    if (!page || !(await canLeaveEditor())) return
    const destination = (await promptValue(tx.movePrompt, page.path))?.trim()
    if (!destination || destination === page.path) return
    if (!destination.startsWith("wiki/") || !destination.toLowerCase().endsWith(".md")) return toast(tx.invalidPagePath, "error")
    try {
      await api("/wiki/page/move", { method: "POST", projectPath:project.path, body: { from: page.path, to: destination } })
      if(activeProjectPath!==project.path)return
      setWorkspace(w=>({...w,tabs:w.tabs.map(path=>path===page.path?destination:path),activePath:w.activePath===page.path?destination:w.activePath})); setEditorDirty(false); await refreshData(destination); toast(tx.saved)
    } catch (error) { toast(error.message, "error") }
  }, [project, canLeaveEditor, refreshData, toast, tx])

  const changePageType = useCallback(async (page, type) => {
    if (!page || !type) return
    const changesSelectedPage = selectedPageRef.current?.path === page.path
    if (changesSelectedPage && !(await canLeaveEditor())) return
    try {
      const currentSelectedPage = selectedPageRef.current
      const revision = currentSelectedPage?.path === page.path ? currentSelectedPage.revision : (await api("/wiki/page?"+new URLSearchParams({path:page.path}),{projectPath:project.path})).revision
      await api("/wiki/page/metadata", { method: "POST", projectPath:project.path, body: { path: page.path, type, revision } })
      if(activeProjectPath!==project.path)return
      const reopenSelectedPage = changesSelectedPage && selectedPageRef.current?.path === page.path
      if (reopenSelectedPage) setEditorDirty(false)
      await refreshData(reopenSelectedPage ? page.path : undefined)
      const label = graphTypeMeta(type, graphTypes).label
      toast(`${tx.pageTypeChanged}: ${label}`)
    } catch (error) { toast(error.message, "error") }
  }, [project, canLeaveEditor, graphTypes, refreshData, toast, tx.pageTypeChanged])

  const movePageTree = useCallback(async (page, target) => {
    if (!page || !target?.type) return
    const selectedPath = selectedPageRef.current?.path
    const sourceChildRoot = childPageDirectory(page.path)
    const selectedStem = String(selectedPath || "").replace(/^wiki\//, "").replace(/\.md$/i, "").replace(/\/index$/i, "")
    const movesSelectedPage = selectedPath === page.path || selectedStem.startsWith(`${sourceChildRoot}/`)
    if (movesSelectedPage && !(await canLeaveEditor())) return
    try {
      const data = await api("/sidebar/move", {
        method: "POST", projectPath:project.path,
        body: {
          path: page.path,
          target_type: target.type,
          target_parent: target.parent || null,
          target_path: target.path || null,
          position: target.position,
        },
      })
      if(activeProjectPath!==project.path)return
      setSidebarOrder(data.order || { types: {}, parents: {} })
      setWorkspace(w=>({...w,tabs:w.tabs.map(path=>data.moved_paths?.[path]||path),activePath:data.moved_paths?.[w.activePath]||w.activePath}))
      const reopenSelectedPage = movesSelectedPage && selectedPageRef.current?.path === selectedPath
      if (reopenSelectedPage) setEditorDirty(false)
      const nextSelectedPath = reopenSelectedPage ? data.moved_paths?.[selectedPath] || selectedPath : undefined
      await refreshData(nextSelectedPath)
      toast(tx.pageReordered)
    } catch (error) { toast(error.message, "error") }
  }, [project, canLeaveEditor, refreshData, toast, tx.pageReordered])

  const renamePageTitle = useCallback(async (page, requestedTitle) => {
    if (!page) return null
    const title = String(requestedTitle || "").trim()
    if (!title || title === pageTitle(page)) return null
    const renamesSelectedPage = selectedPageRef.current?.path === page.path
    if (renamesSelectedPage && !(await canLeaveEditor())) return null
    try {
      const currentSelectedPage = selectedPageRef.current
      const revision = currentSelectedPage?.path === page.path ? currentSelectedPage.revision : (await api("/wiki/page?"+new URLSearchParams({path:page.path}),{projectPath:project.path})).revision
      const updated = await api("/wiki/page/metadata", { method: "POST", projectPath:project.path, body: { path: page.path, title, revision } })
      if(activeProjectPath!==project.path)return updated
      const current = selectedPageRef.current
      if (renamesSelectedPage && current?.path === page.path) {
        const next = { ...current, ...updated, title, frontmatter: updated.frontmatter || current.frontmatter }
        selectedPageRef.current = next
        setSelectedPage(next)
      }
      await refreshData()
      toast(tx.pageTitleRenamed)
      return updated
    } catch (error) { toast(error.message, "error"); return null }
  }, [project, canLeaveEditor, refreshData, toast, tx.pageTitleRenamed])

  const renameTypeLabel = useCallback(async (type, meta, requestedLabel) => {
    if (!type) return false
    const label = String(requestedLabel || "").trim()
    if (!label || label === (meta?.label || type)) return false
    try {
      await api("/graph/config", { method: "POST", projectPath:project.path, body: { types: { [type]: { label, color: meta?.color } } } })
      await refreshData()
      toast(tx.typeRenamed)
      return true
    } catch (error) { toast(error.message, "error"); return false }
  }, [project, refreshData, toast, tx.typeRenamed])

  const deleteTreeNode = useCallback(async (node) => {
    if (!node || !(await canLeaveEditor())) return false
    try {
      if (node.kind === "type") {
        await api("/graph/config/type", { method: "DELETE", projectPath:project.path, body: { type: node.type } })
        await refreshData()
        toast(tx.categoryDeleted)
        return true
      }
      const path = node.page?.path
      if (!path) return false
      // Codex's extension proxy does not reliably preserve query strings
      // on DELETE requests. Send the path in JSON so non-ASCII wiki paths
      // reach the extension unchanged.
      await api("/wiki/page", { method: "DELETE", projectPath:project.path, body: { path } })
      if(activeProjectPath!==project.path)return true
      const remaining=closeWorkspaceTab(workspace,path)
      setWorkspace(remaining)
      const wasSelected=selectedPageRef.current?.path===path
      if (selectedPage?.path === path) {
        setEditorDirty(false)
        selectedPageRef.current=null
        setSelectedPage(null)
      }
      await refreshData(wasSelected?remaining.activePath:undefined)
      toast(tx.movedToTrash)
      return true
    } catch (error) {
      toast(error.message, "error")
      return false
    }
  }, [workspace, project, canLeaveEditor, refreshData, selectedPage?.path, toast, tx.categoryDeleted, tx.movedToTrash])

  const restoreTrashFile = useCallback(async (absolutePath) => {
    const root = `${String(project?.path || "").replace(/\/+$/, "")}/`
    const relative = String(absolutePath || "").startsWith(root) ? String(absolutePath).slice(root.length) : ""
    await refreshData(relative.startsWith("wiki/") ? relative : undefined)
  }, [project?.path, refreshData])

  const loadGraph = useCallback(async () => {
    const projectPath=project?.path
    if(!projectPath)return
    const request=++graphRequest.current,epoch=activeProjectEpoch
    const current=()=>request===graphRequest.current&&activeProjectPath===projectPath&&activeProjectEpoch===epoch
    setGraphLoading(true);setGraphError("")
    try { const data = await api("/graph",{projectPath}); if(current()){setGraphData(data); setGraphTypes(data.types || [])} }
    catch (error) { if(current()){setGraphError(error.message);toast(error.message, "error")} }
    finally { if(current())setGraphLoading(false) }
  }, [toast,project?.path])
  useEffect(()=>{if(project?.path && workspace.rightVisible && workspace.inspectorTab==="links")loadGraph()},[project?.path,selectedPage?.revision,workspace.rightVisible,workspace.inspectorTab,loadGraph])

  const openGraphNode = useCallback((node) => {
    const target = resolveWikiPage(node, pages)
    if (target) openPage(target.path)
  }, [openPage, pages])

  async function switchProject() {
    if (!(await canLeaveEditor())) return
    workspaceIntentRef.current = "home"
    showProjectListRef.current = true
    setEditorDirty(false); setProject(null); setSelectedPage(null); setGraphTypes([]); setSidebarOrder({ types: {}, parents: {} }); setView("chat")
    connectedSessionRef.current = null
    setSessionId(null); setActiveSessionId(null); setActiveProjectPath(null); workspaceSessionId = null
    try { window.sessionStorage.removeItem(SESSION_KEY); window.localStorage.removeItem(SESSION_KEY) } catch {}
  }
  function resizeLeft(value) { if (value == null) return leftWidth; setLeftWidth(Math.max(240, Math.min(360, value))) }

  const showKnowledgeSidebar = workspace.leftVisible || mobileSidebarOpen
  const toggleSidebar=()=>{
    if(window.innerWidth<=760){setMobileSidebarOpen(!mobileSidebarOpen);return}
    setWorkspace(current=>({...current,leftVisible:!current.leftVisible}))
  }
  async function quickNewPage(){
    const base=lang==="zh"?"未命名笔记":"Untitled"
    let title=base,number=1
    while(pages.some(page=>pageTitle(page)===title)) title=`${base} ${++number}`
    return withWorkspaceMutation(()=>createPage({title}))
  }
  const commands=[
    {id:"new",label:tx.newPage,run:quickNewPage},
    {id:"open",label:lang==="zh"?"快速打开笔记":"Quick open",shortcut:"⌘O",run:()=>setPalette("pages")},
    ...NAV.filter(([id])=>id!=="wiki").map(([id])=>({id,label:tx[id],run:()=>navigateView(id)})),
    {id:"close-note",label:lang==="zh"?"关闭当前笔记":"Close current note",run:()=>selectedPage&&withWorkspaceMutation(()=>closeTab(selectedPage.path))},
    {id:"capture",label:lang==="zh"?"保存当前讨论":"Save this discussion",run:()=>showCodexRequest(uiText("$llm-wiki-capture 保存当前讨论中的已确认决定和未解决问题，保留来源。","$llm-wiki-capture Save confirmed decisions and open questions from this discussion, with sources."),project.path)},
    {id:"sidebar",label:lang==="zh"?"显示 / 隐藏文件树":"Toggle file tree",run:toggleSidebar},
    {id:"inspector",label:lang==="zh"?"显示 / 隐藏资料栏":"Toggle details",run:()=>setWorkspace(w=>({...w,rightVisible:!w.rightVisible}))},
    {id:"trash",label:tx.trash,run:()=>setTrashOpen(true)},
    {id:"settings",label:tx.settings,run:()=>navigateView("settings")},
    {id:"libraries",label:tx.switchProject,run:switchProject},
  ]
  function selectHeading(heading){
    const roots=[...document.querySelectorAll(".lw-md-rich h1,.lw-md-rich h2,.lw-md-rich h3,.lw-md-rich h4,.lw-md-rich h5,.lw-md-rich h6")]
    const matches=roots.filter(node=>node.textContent.trim()===heading.text)
    const target=matches[0]
    if(target){target.scrollIntoView({block:"start",behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});return}
    const source=document.querySelector("textarea.lw-md-source")
    if(source&&heading.line){const offset=source.value.split("\n").slice(0,heading.line-1).join("\n").length;source.focus();source.setSelectionRange(offset,offset);source.scrollTop=Math.max(0,(heading.line-3)*23)}
  }

  let content = null
  if (view === "home" || (view === "wiki" && !selectedPage)) content = project&&<LibraryStart key={project.path} api={api} project={project} lang={lang} pages={pages} sources={sources} typeLabel={type=>graphTypeMeta(type,graphTypes).label} onNew={quickNewPage} onNavigate={navigateView} onOpen={openPage} onHelp={()=>setGuideOpen(true)}/>
  else if (view === "chat") content = <TaskHome project={project} lang={lang} ask={text=>showCodexRequest(text,project.path)} onNavigate={navigateView} />
  else if (view === "wiki") content = <WikiView key={`${project?.path}:${selectedPage?.path}`} projectPath={project?.path} onEdit={()=>{editorEditVersion.current+=1}} tx={tx} page={selectedPage} pages={pages} openPage={openPage} refresh={refreshData} toast={toast} onDirtyChange={setEditorDirty} onPageResolved={(resolved) => { if (selectedPageRef.current?.path !== resolved.path) return false; selectedPageRef.current = resolved; setSelectedPage(resolved); return true }} onNewPage={quickNewPage} onMovePage={movePage} onOpenSidebar={() => setMobileSidebarOpen(true)} />
  else if (view === "sources") content = <SourcesView key={project?.path} project={project} tx={tx} sources={sources} refresh={refreshData} toast={toast} sessionId={sessionId} ensureSession={ensureProjectSession} />
  else if (view === "research") content = <ResearchView key={project?.path} project={project} lang={lang} api={api} ask={text=>showCodexRequest(text,project.path)} openPage={openPage}/>
  else if (view === "health") content = <HealthView key={project?.path} project={project} lang={lang} api={api} ask={text=>showCodexRequest(text,project.path)} openPage={openPage}/>
  else if (view === "search") content = <SearchView key={project?.path} projectPath={project?.path} api={api} lang={lang} tx={tx} openPage={openPage} />
  else if (view === "graph") content = <GraphView key={project?.path} tx={tx} graphData={graphData} graphError={graphError} loadGraph={loadGraph} openGraphNode={openGraphNode} toast={toast} projectPath={project?.path} />
  else if (view === "skills") content = <TaskHome project={project} lang={lang} ask={text=>showCodexRequest(text,project.path)} onNavigate={navigateView} />
  else if (view === "memory") content = <MemoryView key={project?.path} project={project} lang={lang} api={api} ask={text=>showCodexRequest(text,project.path)} onSettings={()=>{setSettingsSection("memory");navigateView("settings")}} />
  else content = <SettingsView tx={tx} project={project} initialSection={settingsSection} />

  const workspaceBody = booting
    ? <Loading text={tx.loading} />
    : !project
      ? <Welcome projects={projects} lang={lang} tx={tx} onSelect={selectProject} onSetGlobal={setGlobalProject} onNew={startOnboarding} onOpenPath={openProjectPath} toast={toast} creating={creatingProject} />
      : <div className="lw-app"><div className={`lw-shell ${mobileSidebarOpen ? "mobile-sidebar-open" : ""}`} style={{"--right-width":`${workspace.rightWidth}px`,"--left-width":`${leftWidth}px`}}>
        {showKnowledgeSidebar&&<>{mobileSidebarOpen&&<button className="lw-sidebar-scrim" aria-label={tx.close} onClick={()=>setMobileSidebarOpen(false)}/>}<LibraryNavigation project={project} lang={lang} view={view} pages={pages} sources={sources} onNavigate={async id=>{await navigateView(id);setMobileSidebarOpen(false)}} onSwitch={switchProject} onNew={quickNewPage} onQuickOpen={()=>setPalette("pages")} onClose={toggleSidebar} onHelp={()=>setGuideOpen(true)}>{<Sidebar key={project.path} projectPath={project.path} pages={pages} selectedPath={view==="wiki"?selectedPage?.path:null} tx={tx} lang={lang} openPage={(path) => { setMobileSidebarOpen(false); openPage(path) }} leftWidth={leftWidth} typeConfig={graphTypes} sidebarOrder={sidebarOrder} newPageRequest={newPageRequest} onConsumeNewPageRequest={consumeNewPageRequest} onCreatePage={async (options) => { const created = await withWorkspaceMutation(()=>createPage(options)); if (created) setMobileSidebarOpen(false); return created }} onCreateType={label=>withWorkspaceMutation(()=>createType(label))} onDeleteNode={node=>withWorkspaceMutation(()=>deleteTreeNode(node))} onOpenTrash={() => setTrashOpen(true)} onMovePageTree={(page,target)=>withWorkspaceMutation(()=>movePageTree(page,target))} onRenameType={(...args)=>withWorkspaceMutation(()=>renameTypeLabel(...args))} onRenamePage={(...args)=>withWorkspaceMutation(()=>renamePageTitle(...args))} onCloseMobile={() => setMobileSidebarOpen(false)} />}</LibraryNavigation><DragHandle side="left" onWidth={resizeLeft}/></>}
        <main className="lw-center"><LibraryHeader project={project} lang={lang} onSwitch={switchProject} onSearch={()=>setPalette("pages")} onNavigate={navigateView} onCommands={()=>setPalette("commands")} onHelp={()=>setGuideOpen(true)} onToggleSidebar={toggleSidebar}>{view==="wiki"&&<button className={`lw-btn ghost icon ${workspace.rightVisible?"active":""}`} aria-label={lang==="zh"?"大纲与链接":"Outline and links"} onClick={()=>setWorkspace(w=>({...w,rightVisible:!w.rightVisible}))}><PanelRightOpen/></button>}</LibraryHeader>
        {view==="wiki"&&workspace.tabs.length>1&&<DocumentTabs tabs={workspace.tabs.map(path=>pages.find(page=>page.path===path)||path)} activePath={selectedPage?.path} dirty={editorDirty} onSelect={openPage} onClose={path=>withWorkspaceMutation(()=>closeTab(path))} onNewPage={quickNewPage} onQuickOpen={()=>setPalette("pages")} lang={lang} editorPanelId="wiki-document-panel"/>}
        <div id="wiki-document-panel" className="lw-content-panel"><ErrorBoundary key={`${project.path}:${view}`} tx={tx}>{content}</ErrorBoundary></div><CompactNavigation onToggleSidebar={toggleSidebar} lang={lang} view={view} onNavigate={navigateView}/></main>
        {view==="wiki"&&selectedPage&&workspace.rightVisible&&<><DragHandle side="right" onWidth={value=>{if(value==null)return workspace.rightWidth;setWorkspace(w=>({...w,rightWidth:Math.max(220,Math.min(380,value))}))}}/><WorkspaceInspector page={selectedPage} graph={graphData} pages={pages} onOpenPage={openPage} onSelectHeading={selectHeading} onOpenSource={()=>navigateView("sources")} onClose={()=>setWorkspace(w=>({...w,rightVisible:false}))} tab={workspace.inspectorTab} onTabChange={inspectorTab=>setWorkspace(w=>({...w,inspectorTab}))} lang={lang} loadingGraph={graphLoading}/></>}
      </div></div>

  return <div className="llm-wiki-root" data-build={BUILD} lang={lang}>
    {!project&&<header className="lw-workspace-header" inert={workspaceBusy?true:undefined}><div className="lw-library-switch"><LlmWikiLogo /><span>{PRODUCT_NAME}</span></div><button className="lw-btn ghost" onClick={()=>setPreferencesOpen(true)}><Settings/>{tx.settings}</button></header>}
    <div className="lw-workspace-body" inert={workspaceBusy?true:undefined}>{workspaceBody}</div>
    {workspaceBusy&&<div className="lw-operation-status" role="status"><LoaderCircle className="lw-spin"/>{lang==="zh"?"正在保存更改…":"Saving changes…"}</div>}
    {project&&palette&&<WorkspacePalette mode={palette} pages={pages} commands={commands} onSelect={async item=>{if(item.kind==="page")return openPage(item.path);if(item.command.id==="open"){setPalette("pages");return false}return item.command.run()}} onClose={()=>setPalette(null)} lang={lang}/>}
    {preferencesOpen&&<InterfaceSettingsDialog lang={lang} onClose={()=>setPreferencesOpen(false)}/>}
    {guideOpen&&project&&<GuideDialog lang={lang} onClose={()=>setGuideOpen(false)} onNew={quickNewPage} onNavigate={navigateView}/>}
    {createDialogOpen && <CreateLibraryDialog lang={lang} onClose={()=>setCreateDialogOpen(false)} onCreate={createLibrary} onPlan={planLibrary}/> }
    {trashOpen && project && <TrashDialog project={project} tx={tx} toast={toast} onClose={() => setTrashOpen(false)} onRestored={restoreTrashFile} />}
    <div className="lw-toast-stack" aria-live="polite" aria-atomic="false">{toasts.map((item) => <div className={`lw-toast ${item.type}`} key={item.id}>{item.message}</div>)}</div>
  </div>
}

function injectStyles() {
  if (document.getElementById("llm-wiki-replica-styles")) return
  const style = document.createElement("style")
  style.id = "llm-wiki-replica-styles"
  style.textContent = styles+"\n"+chromeStyles+"\n"+readingStyles
  document.head.appendChild(style)
}

const SESSION_KEY = "llm-wiki:last-session"
const WORKSPACE_OPEN_INTENT_KEY = "llm-wiki:workspace-open-intent"
const WORKSPACE_OPEN_EVENT = "llm-wiki:workspace-open"
const WORKSPACE_RETURN_HASH_KEY = "llm-wiki:workspace-return-hash"
let workspaceSessionId = null
let workspaceOpenIntent = null
let activeWorkspaceIntent = null
let workspaceReactRoot = null

function exitWikiWorkspace() { window.dispatchEvent(new CustomEvent(WORKSPACE_OPEN_EVENT,{detail:{mode:"home"}})) }

function consumeWorkspaceOpenIntent() {
  let intent = workspaceOpenIntent
  if (!intent) {
    try { intent = JSON.parse(window.sessionStorage.getItem(WORKSPACE_OPEN_INTENT_KEY) || "null") } catch {}
  }
  workspaceOpenIntent = null
  try { window.sessionStorage.removeItem(WORKSPACE_OPEN_INTENT_KEY) } catch {}
  return intent?.mode === "project" ? intent : { mode: "home", sessionId: null }
}

function renderWikiWorkspace(container) {
  if (!container) return
  if (workspaceReactRoot) {
    try { workspaceReactRoot.unmount() } catch {}
    workspaceReactRoot = null
  }
  const pendingIntent = workspaceOpenIntent || (() => {
    try { return window.sessionStorage.getItem(WORKSPACE_OPEN_INTENT_KEY) ? true : null } catch { return null }
  })()
  if (pendingIntent) activeWorkspaceIntent = consumeWorkspaceOpenIntent()
  const intent = activeWorkspaceIntent || { mode: "home", sessionId: null }
  const sessionId = null
  setActiveSessionId(null)
  const host = document.createElement("div")
  host.className = "llm-wiki-mount-host"
  container.replaceChildren(host)
  workspaceReactRoot = createRoot(host)
  workspaceReactRoot.render(<App initialSessionId={sessionId} openProjectOnMount={intent.mode === "project"} />)
}

async function selectGlobalProjectForSession(_unused, path) {
  const data=await api("/global-project",{method:"POST",body:{path},projectPath:null})
  window.dispatchEvent(new CustomEvent(GLOBAL_ACCESS_EVENT,{detail:data}))
  return data
}

function NativeSetup() {
  const [preferencesOpen,setPreferencesOpen]=useState(false)
  const lang=useHostLanguage(),t=uiText
  const [directory,setDirectory]=useState("")
  const [pending,setPending]=useState(false)
  const [error,setError]=useState("")
  return <div className="llm-wiki-root"><main className="lw-settings-main"><div className="lw-settings-main-inner"><button className="lw-btn ghost" onClick={()=>setPreferencesOpen(true)}><Settings/>{t("设置","Settings")}</button><h1>{t("知识库保存在哪里？","Where should your libraries live?")}</h1><p>{t("选择保存知识库的文件夹。以后打开插件，会继续使用这里的资料。","Choose a local folder for your libraries. The plugin will use it the next time you open it.")}</p><label htmlFor="data-directory">{t("保存位置","Storage folder")}</label><input id="data-directory" className="lw-input" value={directory} onChange={e=>setDirectory(e.target.value)} placeholder={t("粘贴一个本机文件夹的完整路径","Paste the full path to a local folder")} /><button className="lw-btn primary" disabled={pending || !directory.trim()} onClick={async()=>{setPending(true);try{await nativeCall("wiki_open",{data_directory:directory});renderWikiWorkspace(document.getElementById("root"))}catch(e){setError(e.message);setPending(false)}}}>{pending?t("正在准备…","Preparing…"):t("开始使用","Get started")}</button><p role="alert">{error}</p></div></main>{preferencesOpen&&<InterfaceSettingsDialog lang={lang} onClose={()=>setPreferencesOpen(false)}/>}</div>
}
const nativeAssets=new Map()
function hydrateNativeAssets() {
  document.querySelectorAll("img[data-native-asset]").forEach(element=>{
    if(element.dataset.nativeLoading) return
    element.dataset.nativeLoading="true"
    const key=JSON.stringify([element.dataset.nativeProject,element.dataset.nativeAsset])
    if(!nativeAssets.has(key)) nativeAssets.set(key,nativeAsset(element.dataset.nativeProject,element.dataset.nativeAsset))
    nativeAssets.get(key).then(url=>{if(element.tagName==="IMG")element.src=url;else element.href=url}).catch(error=>{element.title=error.message;nativeAssets.delete(key);delete element.dataset.nativeLoading})
  })
}
async function mount() {
  injectStyles()
  try {
    await connectHost()
    if(isNativeHost()) {
      new MutationObserver(hydrateNativeAssets).observe(document.getElementById("root"),{childList:true,subtree:true})
      const state=await nativeCall("wiki_open",{})
      if(state.needs_setup) {workspaceReactRoot=createRoot(document.getElementById("root"));workspaceReactRoot.render(<NativeSetup/>);return}
    }
    renderWikiWorkspace(document.getElementById("root"))
  } catch(error) {document.getElementById("root").textContent=`${uiText("工作区未连接：","Workspace not connected: ")}${error.message}`}
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, {once:true})
else mount()
