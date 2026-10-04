import { uiText } from "./ui-language.js"
import React, { useEffect, useRef, useState } from "react"
import { ArrowUpRight, BookOpen, Check, FileText, FolderOpen, History, Link2, MessageSquare, Plus, Search, X } from "./icons.jsx"

export function actionError(error, fallback = uiText("操作未完成", "The action did not complete")) {
  return error instanceof Error ? error : new Error(typeof error === "string" ? error : error?.message || fallback)
}

// The host wrapper may resolve void after accepting a request. Explicit rejection
// must never be presented as sent, including test or alternate host adapters.
export function requireActionAccepted(result) {
  if (result === false || result?.isError === true || result?.ok === false) throw actionError(result?.error || result?.message, uiText("请求未被接受", "The request was not accepted"))
  return result
}

// MCP App sandboxes need not allow native HTML form submissions. Invoke actions
// directly; multiline fields keep Enter for newlines and use Cmd/Ctrl+Enter.
export function actionKeyDown(event, action, { multiline = false } = {}) {
  if (event.defaultPrevented || event.repeat || event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229 || event.key !== "Enter" || event.altKey || event.shiftKey) return
  if (multiline && !(event.metaKey || event.ctrlKey)) return
  event.preventDefault()
  return action()
}

export function useProjectScope(projectPath) {
  const ref = useRef(null)
  if (!ref.current || ref.current.path !== projectPath) ref.current = { path: projectPath, active: true }
  useEffect(() => { const scope = ref.current; scope.active = true; return () => { scope.active = false } }, [projectPath])
  return { capture: () => ref.current, isCurrent: scope => scope === ref.current && scope.active }
}

export function useRefreshOnReturn(refresh, projectPath) {
  const latest=useRef(refresh)
  latest.current=refresh
  useEffect(()=>{
    const reload=()=>{if(!document.hidden)latest.current()}
    window.addEventListener("focus",reload)
    document.addEventListener("visibilitychange",reload)
    return()=>{window.removeEventListener("focus",reload);document.removeEventListener("visibilitychange",reload)}
  },[projectPath])
}

export function Modal({title, onClose, children, busy=false, className=""}) {
  const ref=useRef(null)
  useEffect(()=>{const previous=document.activeElement,current=ref.current;if(current&&!current.open){current.showModal();current.querySelector("input:not([disabled]),textarea:not([disabled])")?.focus()}return()=>{current?.close();if(previous?.isConnected)previous.focus()}},[])
  return <dialog ref={ref} className={`lw-flow-dialog ${className}`} aria-label={title} onCancel={e=>{e.preventDefault();if(!busy)onClose()}}>
    <header><h2>{title}</h2><button className="lw-btn ghost icon" aria-label={uiText("关闭", "Close")} disabled={busy} onClick={onClose}><X/></button></header>{children}
  </dialog>
}

export function CreateLibraryDialog({lang="zh",onClose,onCreate,onPlan}) {
  const zh=lang==="zh",[name,setName]=useState(""),[purpose,setPurpose]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("")
  const sending=useRef(false)
  async function submit(){if(!name.trim()||sending.current)return;sending.current=true;setBusy(true);setError("");try{const result=await onCreate({name:name.trim(),purpose:purpose.trim()});if(result!==false){requireActionAccepted(result);onClose()}}catch(e){setError(actionError(e).message)}finally{sending.current=false;setBusy(false)}}
  async function plan(){if(sending.current)return;sending.current=true;setBusy(true);setError("");try{requireActionAccepted(await onPlan({name,purpose}));onClose()}catch(e){setError(actionError(e).message)}finally{sending.current=false;setBusy(false)}}
  return <Modal title={zh?"新建知识库":"New library"} onClose={onClose} busy={busy}><form onSubmit={e=>e.preventDefault()}>
    <div className="lw-flow-body"><label htmlFor="library-name">{zh?"名称":"Name"}</label><input autoFocus id="library-name" onKeyDown={event=>actionKeyDown(event,submit)} className="lw-input" value={name} maxLength={120} onChange={e=>setName(e.target.value)} placeholder={zh?"例如：产品研究、读书笔记":"Product research, reading notes…"}/>
    <details className="lw-create-options"><summary>{zh?"补充用途（选填）":"Add a purpose (optional)"}</summary><label htmlFor="library-purpose">{zh?"用来做什么":"What is it for?"}<span className="lw-muted">{zh?" · 选填":" · Optional"}</span></label><textarea id="library-purpose" onKeyDown={event=>actionKeyDown(event,submit,{multiline:true})} className="lw-input" rows={3} value={purpose} onChange={e=>setPurpose(e.target.value)} placeholder={zh?"例如：保存访谈资料，跟踪产品决策。":"Keep interviews and track product decisions."}/>
    </details>{error&&<p className="lw-form-error" role="alert">{error}</p>}</div>
    <footer><button type="button" className="lw-btn ghost" disabled={busy} onClick={plan}><MessageSquare/>{zh?"一起规划":"Plan with Codex"}</button><span/><button type="button" className="lw-btn" disabled={busy} onClick={onClose}>{zh?"取消":"Cancel"}</button><button type="button" className="lw-btn primary" onClick={submit} disabled={!name.trim()||busy}>{busy?(zh?"正在创建…":"Creating…"):(zh?"创建知识库":"Create library")}</button></footer>
  </form></Modal>
}

export function TaskHome({project,lang="zh",ask,onNavigate}) {
  const zh=lang==="zh",[text,setText]=useState(""),[pending,setPending]=useState(false),[error,setError]=useState(""),[sent,setSent]=useState(false)
  const scope=useProjectScope(project.path),sending=useRef(null)
  useEffect(()=>{setText("");setPending(false);setError("");setSent(false)},[project.path])
  async function submit(value){const request=scope.capture();if(sending.current===request||!value.trim())return;sending.current=request;setPending(true);setError("");setSent(false);try{requireActionAccepted(await ask(value));if(scope.isCurrent(request)){setText("");setSent(true)}}catch(e){if(scope.isCurrent(request))setError(actionError(e).message)}finally{if(sending.current===request)sending.current=null;if(scope.isCurrent(request))setPending(false)}}
  const actions=[
    [FileText,zh?"整理资料":"Organize material",zh?"把原文整理成笔记，保留出处。":"Turn sources into notes with references.",()=>onNavigate("sources")],
    [Search,zh?"研究一个问题":"Research a question",zh?"查找新资料，保存带引用的结论。":"Find sources and save a cited answer.",()=>onNavigate("research")],
    [History,zh?"找回以前的决定":"Recall a decision",zh?"从关联的会话记录中查找。":"Search your linked conversation history.",()=>onNavigate("memory")],
    [MessageSquare,zh?"保存这次讨论":"Save this discussion",zh?"记录已确认的决定和未解决的问题。":"Keep confirmed decisions and open questions.",()=>submit((zh?"$llm-wiki-capture 保存当前对话中已经确认的决定、事实和未解决问题，写入当前选定知识库，并保留可定位来源。":"$llm-wiki-capture Save confirmed decisions, facts and open questions from this conversation to the selected library, with traceable sources."))],
    [Link2,zh?"连接相关笔记":"Connect related notes",zh?"检查内容，补充有依据的双向链接。":"Add links supported by the notes.",()=>submit((zh?"$llm-wiki-relink 整理当前知识库中已有笔记的关联，保留原文，只添加有依据的链接。":"$llm-wiki-relink Connect existing notes in the selected library. Preserve their content and add only evidence-supported links."))],
    [Check,zh?"检查与待办":"Checks and review",zh?"找出断链，处理需要确认的内容。":"Find broken links and review open items.",()=>onNavigate("health")],
  ]
  return <div className="lw-view"><div className="lw-view-body"><div className="lw-task-home"><div className="lw-page-eyebrow">{project.name}</div><h1>{zh?"提问与整理":"Ask & organize"}</h1><p className="lw-help">{zh?"查资料、整理笔记，或记下这次讨论的决定。":"Find sources, organize notes or save a decision from this conversation."}</p>
    <form className="lw-request-box" onSubmit={e=>e.preventDefault()}><label className="lw-sr-only" htmlFor="codex-question">{zh?"问题或任务":"Question or task"}</label><textarea id="codex-question" onKeyDown={event=>actionKeyDown(event,()=>submit(text),{multiline:true})} disabled={pending} value={text} onChange={e=>setText(e.target.value)} placeholder={zh?"例如：我们为什么决定先做桌面版？":"Why did we decide to build the desktop version first?"} rows={3}/><div><span>{zh?"当前知识库":"Uses this library"}</span><button type="button" className="lw-btn primary" onClick={()=>submit(text)} disabled={pending||!text.trim()}>{pending?(zh?"正在发送…":"Sending…"):(zh?"发送到 Codex":"Send to Codex")}<ArrowUpRight/></button></div></form>
    {sent&&<p role="status" className="lw-inline-success">{zh?"已发送，可在当前对话查看进展。":"Sent. Follow the progress in this conversation."}</p>}{error&&<p role="alert" className="lw-form-error">{error}</p>}
    <div className="lw-task-grid">{actions.map(([Icon,title,description,run])=><button className="lw-task-card" key={title} disabled={pending} onClick={run}><Icon/><strong>{title}</strong><span>{description}</span><ArrowUpRight className="lw-task-arrow"/></button>)}</div>
  </div></div></div>
}

export function MemoryView({project,lang="zh",api,ask,onSettings}) {
  const zh=lang==="zh",[link,setLink]=useState(null),[loaded,setLoaded]=useState(false),[query,setQuery]=useState(""),[pending,setPending]=useState(false),[status,setStatus]=useState(""),[error,setError]=useState("")
  const scope=useProjectScope(project.path),sending=useRef(null),loadId=useRef(0)
  const [loadFailed,setLoadFailed]=useState(false)
  async function load(){const request=scope.capture(),id=++loadId.current;setLoaded(false);setLoadFailed(false);setLink(null);setError("");try{const result=requireActionAccepted(await api("/memory/status",{projectPath:request.path}));if(!result||!("link" in result))throw new Error(zh?"会话记录状态无效":"Invalid conversation history status");if(scope.isCurrent(request)&&id===loadId.current){setLink(result.link);setLoaded(request.path)}}catch(e){if(scope.isCurrent(request)&&id===loadId.current){setError(actionError(e).message);setLoadFailed(true)}}}
  useEffect(()=>{setQuery("");setPending(false);setStatus("");load();return()=>{loadId.current++}},[project.path])
  useRefreshOnReturn(load,project.path)
  async function send(prompt){const request=scope.capture();if(sending.current===request)return;sending.current=request;setPending(true);setStatus("");setError("");try{requireActionAccepted(await ask(prompt));if(scope.isCurrent(request))setStatus(zh?"已发送，请在当前对话查看。":"Sent. Continue in this conversation.")}catch(e){if(scope.isCurrent(request))setError(actionError(e).message)}finally{if(sending.current===request)sending.current=null;if(scope.isCurrent(request))setPending(false)}}
  function recall(){if(query.trim())return send(zh?`请使用 wiki_recall 检索当前选定知识库及其已关联会话知识库，回答这个缺失的历史问题：${query.trim()}。读取完整证据后再回答，给出来源与日期；没有证据就明确说没有找到。`:`Use wiki_recall to search this library and its linked conversation library for this historical question: ${query.trim()}. Read the full evidence before answering, cite sources and dates, and say when no evidence is found.`)}
  return <div className="lw-view"><div className="lw-view-body"><div className="lw-task-home"><div className="lw-page-eyebrow">{project.name}</div><h1>{zh?"会话记录":"Conversation history"}</h1><p className="lw-help">{zh?"以前讨论过什么，为什么这样决定。":"Find what you discussed and why you decided."}</p>
    {loaded===project.path&&link?<><div className="lw-memory-connected"><History/><div><strong>{zh?"已关联会话知识库":"Conversation library linked"}</strong><span>{zh?"答案附有原始出处。":"Answers include their sources."}</span></div><button className="lw-btn sm" onClick={onSettings}>{zh?"管理":"Manage"}</button></div><form className="lw-request-box" onSubmit={e=>e.preventDefault()}><label className="lw-sr-only" htmlFor="memory-question">{zh?"想找回什么":"What do you want to recall?"}</label><textarea id="memory-question" onKeyDown={event=>actionKeyDown(event,recall,{multiline:true})} disabled={pending} rows={3} value={query} onChange={e=>setQuery(e.target.value)} placeholder={zh?"例如：上次讨论定价时，最后决定了什么？":"What did we decide about pricing last time?"}/><div><span>{zh?"查找时不会改动记录":"Leaves your records unchanged"}</span><button type="button" className="lw-btn primary" onClick={recall} disabled={pending||!query.trim()}><Search/>{zh?"查找记录":"Find records"}</button></div></form></>:loaded===project.path?<div className="lw-empty-memory"><History/><h2>{zh?"先关联你的会话记录":"Connect your conversation history"}</h2><p>{zh?"可以关联已有的会话知识库，也可以先从指定的历史记录开始整理。":"Connect an existing conversation library or build one from the history you choose."}</p><div className="lw-native-actions"><button className="lw-btn primary" onClick={onSettings}><FolderOpen/>{zh?"关联已有知识库":"Connect existing library"}</button><button className="lw-btn" disabled={pending} onClick={()=>send((zh?"请使用 Agent wiki 插件内的 agent-session-knowledge-rebuilder Skill。先读取该插件的 skills/agent-session-knowledge-rebuilder/SKILL.md 和 skills/llm-wiki/references/session-memory.md；不要改用同名独立 Skill。我想整理历史会话。先和我确认要整理的会话来源、时间范围和私人保存目录，再执行；保留所有来源与未完成项。完成后验证并关联当前知识库。":"Use the agent-session-knowledge-rebuilder Skill bundled with Agent wiki. Read its skills/agent-session-knowledge-rebuilder/SKILL.md and skills/llm-wiki/references/session-memory.md first; do not substitute the standalone Skill with the same name. Organize my conversation history. Confirm the sources, time range and private output folder before proceeding. Preserve sources and incomplete work. Verify the result and link it to the selected library."))}><Plus/>{zh?"整理历史会话":"Organize conversation history"}</button></div></div>:loadFailed?<button className="lw-btn" onClick={load}>{zh?"重试读取":"Retry loading"}</button>:<p role="status">{zh?"正在读取…":"Loading…"}</p>}
    {loaded===project.path&&link&&<button className="lw-btn" disabled={pending} onClick={()=>send((zh?"请使用 Agent wiki 插件内的 agent-session-knowledge-rebuilder Skill。先读取该插件的 skills/agent-session-knowledge-rebuilder/SKILL.md 和 skills/llm-wiki/references/session-memory.md；不要改用同名独立 Skill。更新当前知识库已经关联的会话知识库。沿用其既有、已授权的来源与范围；如缺少配置或需要扩大范围先说明。完成后重新验证，不手改生成文件。":"Use the agent-session-knowledge-rebuilder Skill bundled with Agent wiki. Read its skills/agent-session-knowledge-rebuilder/SKILL.md and skills/llm-wiki/references/session-memory.md first; do not substitute the standalone Skill with the same name. Update the conversation library linked to this library, using its existing authorized sources and scope. Explain missing configuration or any proposed scope expansion first. Revalidate the result; do not hand-edit generated files."))}><History/>{zh?"更新会话记录":"Update conversation history"}</button>}{status&&<p role="status">{status}</p>}{error&&<p role="alert" className="lw-form-error">{error}</p>}
  </div></div></div>
}
