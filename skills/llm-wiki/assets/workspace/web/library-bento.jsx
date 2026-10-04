import React,{useRef,useEffect,useState} from 'react'
import {FileText,Check,ArrowUpRight} from './icons.jsx'

// One frame per pointer movement; no React renders or document-wide listeners.
export function GlowCard({className='',children,...props}) {
  const frame=useRef(0)
  useEffect(()=>()=>cancelAnimationFrame(frame.current),[])
  function move(event) {
    if(event.pointerType==='touch'||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return
    const card=event.currentTarget,box=card.getBoundingClientRect(),x=event.clientX-box.left,y=event.clientY-box.top
    cancelAnimationFrame(frame.current)
    frame.current=requestAnimationFrame(()=>{card.style.setProperty('--light-x',`${x}px`);card.style.setProperty('--light-y',`${y}px`)})
  }
  return <button {...props} className={`lw-glass-card ${className}`} onPointerMove={move} onPointerLeave={()=>cancelAnimationFrame(frame.current)}>{children}</button>
}

import {previewText,previewSource,previewTasks} from './note-preview.js'
import {Modal} from './workspace-flows.jsx'

export function LibraryBento({lang,pages,projectPath,api,onOpen,typeLabel,onNavigate}) {
  const zh=lang==='zh',[loaded,setLoaded]=useState({}),[source,setSource]=useState(null)
  const selected=pages.slice(0,3),signature=selected.map(p=>`${p.path}:${p.modified||p.updated_at||''}`).join('|')
  useEffect(()=>{
    let current=true
    setLoaded({});setSource(null)
    if(!api)return
    for(const page of selected) {
      api(`/wiki/page?path=${encodeURIComponent(page.path)}`,{projectPath}).then(async data=>{
        const path=previewSource(data.frontmatter),entry={data}
        if(path)try{entry.source=await api(`/sources?path=${encodeURIComponent(path)}`,{projectPath});entry.sourcePath=path}catch{entry.sourceUnavailable=true}
        if(current)setLoaded(previous=>({...previous,[page.path]:entry}))
      }).catch(()=>{if(current)setLoaded(previous=>({...previous,[page.path]:{error:true}}))})
    }
    return()=>{current=false}
  },[projectPath,signature,api])
  return <><section className="lw-note-previews" aria-label={zh?'笔记预览':'Note previews'}>{selected.map((page,index)=>{
    const entry=loaded[page.path],data=entry?.data,meta=data?.frontmatter||page.frontmatter||{},title=meta.title||page.title||page.path.split('/').pop().replace(/\.md$/i,''),tasks=previewTasks(data?.content),text=previewText(data?.content),tags=Array.isArray(meta.tags)?meta.tags:[],date=Date.parse(page.modified||page.updated_at||meta.updated||meta.created||'')
    return <article className={`lw-preview-card ${index===0?'featured':''}`} key={page.path}>
      <div className="lw-preview-meta"><FileText/><span>{typeLabel&&page.type?typeLabel(page.type):(zh?'笔记':'Note')}{meta.kind?` / ${meta.kind}`:''}</span></div>
      <button className="lw-preview-open" onClick={()=>onOpen(page.path)}><h2>{title}</h2></button>
      {tasks.length>0?<ul className="lw-preview-tasks">{tasks.map((task,i)=><li key={i}><span className={task.done?'done':''}>{task.done&&<Check/>}</span>{task.text}</li>)}</ul>:<p className="lw-preview-excerpt">{data?(text||(zh?'还没有正文。':'No text yet.')):entry?.error?(zh?'预览暂不可用，点标题打开。':'Preview unavailable. Open the note to read it.'):(zh?'正在读取…':'Loading…')}</p>}
      {index===0&&entry?.source&&<div className="lw-preview-source"><span>{zh?'来自资料':'From source'} · {entry.source.name}</span><div><p>{previewText(entry.source.content).split(/\n\s*\n/)[0].slice(0,100)}</p><button onClick={()=>setSource(entry.source)}>{zh?'查看原文':'Read source'}<ArrowUpRight/></button></div></div>}
      {index===0&&entry?.sourceUnavailable&&<p className="lw-preview-unavailable">{zh?'来源暂时无法预览。':'Source preview unavailable.'} <button className="lw-link-button" onClick={()=>onNavigate?.('sources')}>{zh?'查看资料':'View sources'}</button></p>}
      <footer>{tags[0]&&<span className="lw-preview-tag"># {String(tags[0])}</span>}{Number.isFinite(date)&&<time dateTime={new Date(date).toISOString()}>{new Intl.DateTimeFormat(zh?'zh-CN':'en',{month:'short',day:'numeric'}).format(date)}</time>}</footer>
    </article>
  })}</section>{source&&<Modal title={source.name} onClose={()=>setSource(null)}><div className="lw-flow-body"><pre className="lw-source-original">{source.content}</pre>{source.truncated&&<p>{zh?'仅显示前 256 KB。':'Showing the first 256 KB.'}</p>}</div></Modal>}</>
}
