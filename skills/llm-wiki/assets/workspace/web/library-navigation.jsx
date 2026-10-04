import {ProductSignature} from "./product-info.jsx"
import llmWikiLogo from "./assets/llm-wiki-logo.png"
import React, {useEffect, useRef} from 'react'
import {Library,ChevronDown,FileText,FolderOpen,Search,Plus,History,Network,Globe2,ClipboardCheck,MessageSquare,Settings,PanelLeftClose,Shapes,Languages,House,CircleHelp,List,PlusSquare,Send,MoreHorizontal} from './icons.jsx'
import {setUiLanguage} from './ui-language.js'

export function LanguageSelect({lang}) {
  return <label className="lw-language-select"><Languages aria-hidden="true"/><select aria-label={lang==='zh'?'界面语言':'Interface language'} value={lang} onChange={e=>setUiLanguage(e.target.value)}><option value="zh">中文</option><option value="en">English</option></select></label>
}
export function LibraryNavigation({project,lang,view,pages,sources,onNavigate,onSwitch,onNew,onQuickOpen,onClose,onHelp,children}) {
  const zh=lang==='zh', menu=useRef(null)
  useEffect(()=>{
    const outside=e=>{if(menu.current?.open&&!menu.current.contains(e.target))menu.current.open=false}
    const escape=e=>{if(e.key==='Escape'&&menu.current?.open){e.preventDefault();menu.current.open=false;menu.current.querySelector('summary')?.focus()}}
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape)
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape)}
  },[])
  const items=[['home',FileText,zh?'笔记':'Notes',pages.length],['sources',FolderOpen,zh?'资料':'Sources',sources.length],['memory',History,zh?'会话':'History'],['graph',Network,zh?'关系图':'Graph']]
  const tools=[['research',Globe2,zh?'研究问题':'Research'],['health',ClipboardCheck,zh?'检查链接':'Check links'],['search',Search,zh?'全文搜索':'Search all content']]
  return <aside className="lw-library-nav" aria-label={zh?'知识库导航':'Library navigation'}>
    <div className="lw-library-nav-brand"><button onClick={onSwitch} title={zh?'切换知识库':'Switch library'}><img className="lw-brand-icon" src={llmWikiLogo} alt="" aria-hidden="true" draggable="false"/><strong>{project.name}</strong><ChevronDown/></button><button className="lw-icon-btn" onClick={onClose} title={zh?'收起侧栏':'Collapse sidebar'} aria-label={zh?'收起侧栏':'Collapse sidebar'}><PanelLeftClose/></button></div>
    <div className="lw-nav-capture"><button className="lw-library-search" onClick={onQuickOpen}><Search/><span>{zh?'快速打开':'Quick open'}</span><kbd>⌘O</kbd></button><button className="lw-nav-write" onClick={onNew} title={zh?'写笔记':'Write a note'} aria-label={zh?'写笔记':'Write a note'}><Plus/></button></div>
    <nav className="lw-library-primary">{items.map(([id,Icon,label,count])=><button key={id} className={(view===id||(id==='home'&&view==='wiki'))?'active':''} aria-current={(view===id||(id==='home'&&view==='wiki'))?'page':undefined} onClick={()=>onNavigate(id)}><Icon/><span>{label}</span>{count!==undefined&&count>0&&<small>{count}</small>}</button>)}</nav>
    <div className="lw-library-tree">{children}</div>
    <div className="lw-library-bottom"><ProductSignature lang={lang} compact/><button className="lw-nav-ask" onClick={()=>onNavigate('chat')}><MessageSquare/><span>{zh?'与 Codex 一起整理':'Work with Codex'}</span></button><div className="lw-library-bottom-row"><details ref={menu} className="lw-library-menu"><summary aria-label={zh?'工具':'Tools'}><Shapes/><span>{zh?'工具':'Tools'}</span></summary><div className="lw-library-menu-content">{tools.map(([id,Icon,label])=><button key={id} aria-label={label} onClick={()=>{menu.current.open=false;onNavigate(id)}}><Icon/>{label}</button>)}</div></details><button className="lw-nav-settings" onClick={()=>onNavigate('settings')}><Settings/><span>{zh?'设置':'Settings'}</span></button><button className="lw-icon-btn" title={zh?'使用指南':'Guide'} aria-label={zh?'使用指南':'Guide'} onClick={onHelp}><CircleHelp/></button></div></div>
  </aside>
}

export function CompactNavigation({lang,view,onNavigate,onToggleSidebar}) {
  const zh=lang==='zh'
  return <nav className="lw-compact-nav" aria-label={zh?'常用操作':'Quick actions'}><button onClick={onToggleSidebar}><List/><span>{zh?'目录':'Browse'}</span></button><button aria-current={view==='sources'?'page':undefined} onClick={()=>onNavigate('sources')}><PlusSquare/><span>{zh?'添加资料':'Add source'}</span></button><button aria-current={view==='chat'?'page':undefined} onClick={()=>onNavigate('chat')}><Send/><span>{zh?'交给 Codex':'Ask Codex'}</span></button></nav>
}

export function LibraryHeader({project,lang,onSwitch,onSearch,onNavigate,onCommands,onHelp,onToggleSidebar,children}) {
  const zh=lang==='zh',menu=useRef(null)
  useEffect(()=>{
    const outside=e=>{if(menu.current?.open&&!menu.current.contains(e.target))menu.current.open=false}
    const escape=e=>{if(e.key==='Escape'&&menu.current?.open){menu.current.open=false;menu.current.querySelector('summary')?.focus()}}
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape)
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape)}
  },[])
  function choose(action){menu.current.open=false;action()}
  return <div className="lw-document-topbar"><button className="lw-header-sidebar lw-icon-btn" onClick={onToggleSidebar} aria-label={zh?'显示 / 隐藏侧栏':'Toggle sidebar'}><List/></button><button className="lw-header-library" onClick={onSwitch} aria-label={zh?'切换知识库':'Switch library'}><img src={llmWikiLogo} alt=""/><strong>{project.name}</strong><ChevronDown/></button><span className="spacer"/><button className="lw-icon-btn" aria-label={zh?'搜索笔记':'Search notes'} onClick={onSearch}><Search/></button>{children}<details className="lw-header-menu" ref={menu}><summary aria-label={zh?'更多操作':'More actions'}><MoreHorizontal/></summary><div className="lw-library-menu-content"><button onClick={()=>choose(()=>onNavigate('home'))}><FileText/>{zh?'全部笔记':'All notes'}</button><button onClick={()=>choose(()=>onNavigate('settings'))}><Settings/>{zh?'设置':'Settings'}</button><button onClick={()=>choose(onCommands)}><KeyboardIcon/>{zh?'命令面板':'Command palette'}</button><button onClick={()=>choose(onHelp)}><CircleHelp/>{zh?'使用指南':'Guide'}</button></div></details></div>
}
const KeyboardIcon=List
