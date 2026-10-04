import {getAppearance,setAppearance} from "./appearance.js"
import {LibraryBento} from "./library-bento.jsx"
import React, {useState,useEffect,useRef} from 'react'
import {ArrowUpRight,FileText,FolderPlus,History,ArrowRight,Search,Keyboard,MessageSquare,BookOpen,Check,Network,Plus} from './icons.jsx'
import {Modal,actionError,actionKeyDown,useProjectScope,requireActionAccepted} from './workspace-flows.jsx'
import {LanguageSelect} from './library-navigation.jsx'

export function AppearanceSelect({lang}) {
  const [mode,setMode]=useState(getAppearance),zh=lang==='zh'
  useEffect(()=>{const update=()=>setMode(getAppearance());document.addEventListener('appearancechange',update);return()=>document.removeEventListener('appearancechange',update)},[])
  return <div className="lw-appearance-select" role="group" aria-label={zh?'外观':'Appearance'}>{[['system',zh?'跟随 Codex':'System'],['light',zh?'浅色':'Light'],['dark',zh?'深色':'Dark']].map(([value,label])=><button key={value} aria-pressed={mode===value} onClick={()=>setAppearance(value)}><span className={`lw-theme-swatch ${value}`}/>{label}</button>)}</div>
}
export function InterfaceSettingsDialog({lang,onClose}) {
  const zh=lang==='zh'
  return <Modal title={zh?'设置':'Settings'} onClose={onClose} className="lw-preferences-dialog"><div className="lw-flow-body"><div className="lw-preference-row"><div><strong>{zh?'界面语言':'Language'}</strong><p>{zh?'笔记保留原文。':'Notes keep their original language.'}</p></div><LanguageSelect lang={lang}/></div><div className="lw-preference-row lw-appearance-row"><div><strong>{zh?'外观':'Appearance'}</strong><p>{zh?'动态效果跟随系统设置。':'Motion follows your system preferences.'}</p></div><AppearanceSelect lang={lang}/></div></div></Modal>
}

export function GuideDialog({lang,onClose,onNew,onNavigate}) {
  const zh=lang==='zh',[error,setError]=useState(''),[busy,setBusy]=useState(false),running=useRef(false)
  async function go(action,focusNote=false){if(running.current)return;running.current=true;setBusy(true);setError('');try{if(await action()!==false){onClose();if(focusNote)requestAnimationFrame(()=>(document.querySelector(".lw-tree-create input")||document.querySelector(".lw-md-rich"))?.focus())}}catch(e){setError(actionError(e).message)}finally{running.current=false;setBusy(false)}}
  const choices=[
    [MessageSquare,zh?'直接在 Codex 里说':'Ask in Codex',zh?'试试「查一下这个库里的定价笔记」或「把刚才的决定记到这个库」。不必记命令。':'Try “Find pricing notes in this library” or “Save that decision to this library.” No commands to remember.',zh?'问问这些笔记':'Ask about these notes',()=>onNavigate('chat')],
    [FileText,zh?'记下一个想法':'Write something down',zh?'停止输入后自动保存，看到「已保存」即可离开。用 [[笔记名]] 连接笔记。':'Pause typing to save. Wait for “Saved” before leaving. Link notes with [[note name]].',zh?'写笔记':'Write a note',onNew],
    [FolderPlus,zh?'从手边的资料开始':'Start with a source',zh?'拖入文件，点「整理成笔记」。原文件留在资料中。':'Drop in a file, then choose “Make notes”. Your original stays in Sources.',zh?'添加资料':'Add a source',()=>onNavigate('sources')],
    [History,zh?'接上以前的讨论':'Pick up an earlier conversation',zh?'已有整理好的会话记录，可以直接关联；第一次使用，可让 Codex 帮你整理指定记录。':'Link an existing conversation library, or ask Codex to organize the records you choose.',zh?'打开会话':'Open history',()=>onNavigate('memory')],
  ]
  return <Modal title={zh?'从这里开始':'A few ways to start'} onClose={onClose} busy={busy} className="lw-guide-dialog"><div className="lw-guide-choices">{choices.map(([Icon,title,description,label,action])=><section key={title}><Icon/><div><h3>{title}</h3><p>{description}</p><button className="lw-link-button" disabled={busy} onClick={()=>go(action,action===onNew)}>{label}<ArrowRight/></button></div></section>)}</div><div className="lw-guide-shortcuts"><Keyboard/><span>{zh?'快速打开':'Quick open'} <kbd>⌘ / Ctrl O</kbd></span><span>{zh?'全部操作':'All actions'} <kbd>⌘ / Ctrl P</kbd></span></div>{error&&<p className="lw-form-error" role="alert">{error}</p>}<footer><p>{zh?'查阅不会改动笔记。保存按你的要求或事先约定的范围执行；结果在当前 Codex 对话中查看。':'Reading leaves notes unchanged. Saving follows your request or agreed scope. Check the result in your current Codex conversation.'}</p><button className="lw-btn" disabled={busy} onClick={onClose}>{zh?'知道了':'Got it'}</button></footer></Modal>
}

export function LibraryStart({project,lang,pages,sources,api,typeLabel,onNew,onNavigate,onOpen,onHelp}) {
  const zh=lang==='zh',[filter,setFilter]=useState(''),[order,setOrder]=useState('recent'),[showAll,setShowAll]=useState(false)
  const title=page=>page.frontmatter?.title||page.title||page.path.split('/').pop().replace(/\.md$/i,'')
  const listed=[...pages].filter(page=>title(page).toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase())).sort((a,b)=>order==='recent'?(Date.parse(b.modified||b.updated_at||'')||0)-(Date.parse(a.modified||a.updated_at||'')||0):title(a).localeCompare(title(b),zh?'zh':'en'))
  function date(page){const value=Date.parse(page.modified||page.updated_at||'');return Number.isFinite(value)?new Intl.DateTimeFormat(zh?'zh-CN':'en',{month:'short',day:'numeric'}).format(value):''}
  return <div className="lw-library-start">
    <header className="lw-collection-heading"><h1>{zh?'笔记':'Notes'}</h1><button className="lw-btn lw-new-note" onClick={onNew}><Plus/>{zh?'新建':'New note'}</button></header>
    <nav className="lw-collection-tabs" aria-label={zh?'知识库内容':'Library content'}><button aria-current="page" onClick={()=>{setFilter('');setShowAll(false)}}>{zh?'全部':'All'}</button><button onClick={()=>onNavigate('sources')}>{zh?'资料':'Sources'}</button><button onClick={()=>onNavigate('memory')}>{zh?'会话':'History'}</button><button aria-label={zh?'关系图':'Graph'} onClick={()=>onNavigate('graph')}><Network/></button></nav>
    {!filter&&pages.length>0&&<LibraryBento key={project.path} lang={lang} pages={listed} projectPath={project.path} api={api} typeLabel={typeLabel} onOpen={onOpen} onNavigate={onNavigate}/>}
    {pages.length>0&&<div className="lw-recent-heading"><h2>{zh?'最近编辑':'Recently edited'}</h2><button onClick={()=>setShowAll(value=>!value)}>{showAll?(zh?'收起':'Show less'):(zh?'查看全部':'See all')}<ArrowRight/></button></div>}
    <div className={`lw-collection-search ${showAll||filter?'':'is-collapsed'}`}><Search/><input aria-label={zh?'按标题查找笔记':'Find notes by title'} placeholder={zh?'查找笔记…':'Find a note…'} value={filter} onChange={e=>setFilter(e.target.value)}/><button onClick={()=>onNavigate('search')} title={zh?'搜索笔记正文':'Search note content'}>{zh?'全文搜索':'Search all'}<ArrowUpRight/></button></div>
    {pages.length>0?<><div className={`lw-collection-order ${showAll?'':'is-collapsed'}`} role="group" aria-label={zh?'排序':'Sort notes'}><button aria-pressed={order==='recent'} onClick={()=>setOrder('recent')}>{zh?'最近编辑':'Recent'}</button><button aria-pressed={order==='title'} onClick={()=>setOrder('title')}>{zh?'按名称':'By name'}</button><span>{filter?(zh?`${listed.length} 篇匹配`:`${listed.length} matches`):''}</span></div><section className="lw-note-list" aria-label={zh?'笔记列表':'Note list'}>{(showAll||filter?listed:listed.slice(3,5).length?listed.slice(3,5):listed).map(page=><button className="lw-start-note" key={page.path} onClick={()=>onOpen(page.path)}><span className="lw-note-glyph"><FileText/></span><span className="lw-note-summary"><strong>{title(page)}</strong><small>{typeLabel&&page.type?typeLabel(page.type):(zh?'笔记':'Note')}</small></span><time>{date(page)}</time><ArrowRight/></button>)}</section>{listed.length===0&&<p className="lw-empty-filter">{zh?'没有找到这个标题。可以试试全文搜索。':'No matching titles. Try searching all content.'}</p>}</>:<section className="lw-collection-empty"><BookOpen/><h2>{zh?'写下第一篇笔记':'Your first note starts here'}</h2><p>{zh?'直接写，或导入手边的文件。':'Start writing, or bring in a file.'}</p><button className="lw-btn" onClick={()=>onNavigate('sources')}><FolderPlus/>{zh?'添加资料':'Add a source'}</button></section>}
    <div className="lw-collection-footer"><button onClick={()=>onNavigate('chat')}><MessageSquare/>{zh?'问问这些笔记':'Ask about these notes'}<ArrowRight/></button><button onClick={onHelp}>{zh?'使用指南':'Guide'}</button></div>
  </div>
}

export function SearchView({ tx, projectPath, openPage, api, lang }) {
  const [query,setQuery]=useState(""),[results,setResults]=useState([]),[searching,setSearching]=useState(false),[searched,setSearched]=useState(false),[error,setError]=useState("")
  const scope=useProjectScope(projectPath),requestId=useRef(0),timer=useRef(null)
  async function search(value=query) {
    clearTimeout(timer.current)
    const id=++requestId.current,request=scope.capture(),term=value.trim()
    setError("");setResults([]);setSearched(false)
    if(!term){setSearching(false);return}
    setSearching(true)
    try {const data=await api(`/search?q=${encodeURIComponent(term)}&limit=30`,{projectPath:request.path});if(scope.isCurrent(request)&&id===requestId.current){setResults(data.results||[]);setSearched(true)}}
    catch(e){if(scope.isCurrent(request)&&id===requestId.current)setError(e.message)}
    finally{if(scope.isCurrent(request)&&id===requestId.current)setSearching(false)}
  }
  useEffect(()=>{requestId.current++;setResults([]);setError("");setSearched(false);setSearching(Boolean(query.trim()));timer.current=setTimeout(()=>search(query),250);return()=>{clearTimeout(timer.current);requestId.current++}},[query,projectPath])
  return <div className="lw-view"><div className="lw-view-body"><div className="lw-search-wrap"><h1>{tx.search}</h1><div className="lw-searchbox"><Search/><input autoFocus className="lw-input" aria-label={tx.searchPlaceholder} value={query} onChange={e=>setQuery(e.target.value)} placeholder={tx.searchPlaceholder} onKeyDown={e=>actionKeyDown(e,()=>search())}/></div><div className="lw-search-status" role="status">{searching?tx.loading:searched?`${results.length} ${tx.results}`:""}</div>{error&&<p role="alert" className="lw-form-error">{error}<button className="lw-btn" onClick={()=>search()}>{tx.retry}</button></p>}{results.map(result=><button className="lw-result" key={result.path} onClick={()=>openPage(result.path)}><div className="lw-result-title"><FileText/>{result.title||result.path}</div>{result.snippet&&<div className="lw-result-snippet">{result.snippet}</div>}</button>)}{searched&&!searching&&!results.length&&<div className="lw-empty"><Search/><h3>{tx.noResults}</h3><p>{lang==="zh"?"试试更短的关键词。":"Try a shorter search."}</p></div>}</div></div></div>
}

export function SourceLinkDialog({lang,onClose,onImport}) {
  const zh=lang==='zh',[url,setUrl]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),sending=useRef(false)
  async function submit(){
    if(sending.current||!url.trim())return
    let parsed
    try{parsed=new URL(url.trim());if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)throw new Error()}
    catch{setError(zh?'输入一个完整的 http 或 https 网页链接。':'Enter a complete http or https web address.');return}
    sending.current=true;setBusy(true);setError('')
    try{requireActionAccepted(await onImport(parsed.href));onClose()}catch(e){setError(actionError(e).message)}finally{sending.current=false;setBusy(false)}
  }
  return <Modal title={zh?'添加网页':'Add a web page'} onClose={onClose} busy={busy}><div className="lw-flow-body"><label htmlFor="source-link">{zh?'网页链接':'Web address'}</label><input id="source-link" className="lw-input" autoFocus value={url} onChange={e=>setUrl(e.target.value)} onKeyDown={e=>actionKeyDown(e,submit)} placeholder="https://…"/><p className="lw-help">{zh?'在当前 Codex 对话中读取网页，保留出处并整理成笔记。':'Read the page in your current Codex conversation and save a note with its source.'}</p>{error&&<p className="lw-form-error" role="alert">{error}</p>}</div><footer><span/><button className="lw-btn" disabled={busy} onClick={onClose}>{zh?'取消':'Cancel'}</button><button className="lw-btn primary" disabled={busy||!url.trim()} onClick={submit}>{busy?(zh?'正在发送…':'Sending…'):(zh?'添加并整理':'Add & make notes')}</button></footer></Modal>
}
