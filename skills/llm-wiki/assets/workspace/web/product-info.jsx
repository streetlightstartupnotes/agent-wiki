import React from "react"
import logo from "./assets/llm-wiki-logo.png"
import {ArrowUpRight} from "./icons.jsx"

export const PRODUCT_NAME = "Agent wiki"
export const AUTHOR_NAME = "路灯同学创业笔记"
export const AUTHOR_LINKS = [
  {id:"x",label:"X",url:"https://x.com/LDstartupnotes"},
  {id:"github",label:"GitHub",url:"https://github.com/streetlightstartupnotes"},
  {id:"xiaohongshu",label:"小红书",en:"Xiaohongshu",url:"https://www.xiaohongshu.com/user/profile/63fd97c1000000001400d0ea"},
]

function AuthorLinks({lang}) {
  const zh=lang==="zh"
  return <nav className="aw-social-links" aria-label={zh?"作者主页":"Creator profiles"}>
    {AUTHOR_LINKS.map(link=><a key={link.id} href={link.url} target="_blank" rel="noopener noreferrer" aria-label={`${AUTHOR_NAME} · ${zh?link.label:link.en||link.label}${zh?"（新窗口）":" (new window)"}`}>{zh?link.label:link.en||link.label}<ArrowUpRight aria-hidden="true"/></a>)}
  </nav>
}

export function ProductSignature({lang="zh",compact=false}) {
  return <div className={`aw-signature ${compact?"compact":""}`}>
    <span className="aw-signature-name"><strong>{PRODUCT_NAME}</strong><span aria-hidden="true"> · </span><span>{AUTHOR_NAME}</span></span>
    <AuthorLinks lang={lang}/>
  </div>
}

export function AboutProduct({lang="zh",version,build}) {
  const zh=lang==="zh"
  return <div className="aw-about"><img className="aw-about-logo" src={logo} alt=""/><h1>{PRODUCT_NAME}</h1><p className="aw-about-lead">{zh?"把资料、笔记和做过的决定留在一起。":"A home for your sources, notes and decisions."}</p>
    <section className="lw-settings-section aw-author"><h3>{AUTHOR_NAME}</h3><AuthorLinks lang={lang}/></section>
    <section className="lw-settings-section"><h3>{zh?"在 Codex 里使用":"Made for Codex"}</h3><p className="lw-help">{zh?"直接在对话中查笔记、整理资料、保存决定。笔记以 Markdown 存在你的电脑上。":"Find notes, organize sources and save decisions from your conversation. Your Markdown files stay on your computer."}</p><p className="lw-help">{zh?"原 LLM Wiki。已有知识库和会话记录仍可继续使用。":"Previously LLM Wiki. Your existing libraries and linked history still work."}</p><small>{version} · GPL-3.0</small><details className="aw-build"><summary>{zh?"版本详情":"Build details"}</summary><code>{build}</code></details></section>
  </div>
}
