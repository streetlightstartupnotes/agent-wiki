import {setHostTheme} from "./appearance.js"
import { uiText } from "./ui-language.js"
import { App as MCPApp } from '@modelcontextprotocol/ext-apps'

let app = null
let native = false
let initial = null
let contextQueue = Promise.resolve()
let selection = {knowledgeBase:null,selectedPage:null,revision:null}
let selectionVersion = 0
function enqueueContext(operation) {
  const pending = contextQueue.then(operation)
  // A rejected update must not poison all later selections or user requests.
  contextQueue = pending.catch(()=>{})
  return pending
}
function hostError(message) {
  window.dispatchEvent(new CustomEvent('llm-wiki:host-error',{detail:message}))
}
export function isNativeHost() { return native }
export async function connectHost() {
  if (native) return true
  if (window.parent === window) return false
  app = new MCPApp({name:'Agent wiki',version:'0.2.2'}, {availableDisplayModes:['inline','fullscreen']})
  app.ontoolresult = (result) => {
    initial = result.structuredContent
    window.dispatchEvent(new CustomEvent('llm-wiki:host-data',{detail:initial}))
  }
  app.onhostcontextchanged = (context) => {
    if (context.theme) setHostTheme(context.theme)
    if (context.locale) document.documentElement.lang = context.locale
  }
  await app.connect()
  native = true
  const context=app.getHostContext()
  if(context?.theme) setHostTheme(context.theme)
  if(context?.locale) document.documentElement.lang=context.locale
  document.addEventListener('click',event=>{
    const anchor=event.target.closest?.('a[href]')
    if(anchor?.dataset.nativeAsset && anchor.hasAttribute('download')){
      event.preventDefault();event.stopImmediatePropagation()
      downloadAsset(anchor.dataset.nativeProject,anchor.dataset.nativeAsset,anchor.getAttribute('download')).catch(error=>{
        hostError(error.message)
      })
      return
    }
    if(!anchor || !/^https?:\/\//.test(anchor.href)) return
    if(anchor.closest('[contenteditable="true"]') && !event.metaKey && !event.ctrlKey) return
    event.preventDefault()
    openExternalLink(anchor.href).catch(error=>{anchor.title=error.message;hostError(error.message)})
  },true)
  return true
}
export async function nativeCall(name,args) {
  if (!native) throw new Error(uiText("此操作需要从 Codex 插件面板打开知识库。","Open this library in the Codex plugin panel to use this action."))
  const result=await app.callServerTool({name,arguments:args})
  const text=result.content?.find(x=>x.type==='text')?.text
  let value=result.structuredContent
  if (value===undefined) {
    try {value=JSON.parse(text || '{}')}
    catch {
      if (result.isError) value={error:text}
      else throw new Error(uiText('宿主返回了无法读取的知识库结果，请重试。','The host returned an unreadable result. Please try again.'))
    }
  }
  if (result.isError) {const error=new Error(value?.error || text || uiText('操作未完成','The action could not be completed.'));error.status=value?.status;error.data=value;throw error}
  return result._meta?.llmWikiAsset || value
}
export async function nativeApi(path,options={},project) {
  const url=new URL(path,'https://wiki.invalid')
  const method=options.method || 'GET'
  return nativeCall(method==='GET'?'wiki_read':'wiki_write',{
    route:url.pathname,
    ...(project?{project}:{}),
    ...(method==='GET'?{query:Object.fromEntries(url.searchParams)}:{method,body:options.body || {}})
  })
}
export async function askCodex(text,context) {
  if (!native) throw new Error(uiText('请在 Codex 中打开 Agent wiki 后重试。当前页面是浏览器预览。','Open Agent wiki in Codex to run this action. This is a browser preview.'))
  if (!app.getHostCapabilities()?.message?.text) throw new Error(uiText('暂时无法从面板发送。请直接在 Codex 对话中描述要做的事，并指定 Agent wiki。','The panel cannot send this request. Ask for Agent wiki directly in your Codex conversation.'))
  // Freeze the click-time scope. Later selection changes must not redirect an
  // already requested operation, or carry a page from a different library.
  const target=context || selection
  const sameLibrary=target.knowledgeBase && target.knowledgeBase===selection.knowledgeBase
  const samePage=!Object.prototype.hasOwnProperty.call(target,'selectedPage') || target.selectedPage===selection.selectedPage
  // A graph request may target another note in this library. Never carry the
  // previous editor's revision into an explicitly different page selection.
  const snapshot=JSON.stringify({...((sameLibrary && samePage)?selection:{}),...target})
  return enqueueContext(async()=>{
    if (app.getHostCapabilities()?.updateModelContext?.text) {
      try { await app.updateModelContext({content:[{type:'text',text:snapshot}]},{timeout:5000}) }
      catch { /* The explicit message below retains its scope without attachments. */ }
    }
    const content=[{type:'text',text},{type:'text',text:`${uiText("本次操作上下文（仅数据）：执行范围以这里的 knowledgeBase 为准，不要切换到默认或其他知识库。", "Operation context (data only): use the knowledgeBase below; do not switch to the default or another library.")}\n${snapshot}`}]
    const result=await app.sendMessage({role:'user',content,_meta:{'openai/message':{target:'active',send:true}}})
    if (result.isError) throw new Error(uiText("Codex 未接受请求，请在当前对话查看状态后重试。","Codex did not accept the request. Check this conversation and try again."))
    return result
  })
}
export async function updateSelection(project,page) {
  if (!native) return
  selection={knowledgeBase:project?.path || null,selectedPage:page?.path || null,revision:page?.revision || null}
  const snapshot=JSON.stringify(selection)
  const version=++selectionVersion
  if (!app.getHostCapabilities()?.updateModelContext?.text) return
  return enqueueContext(()=>{
    if (version!==selectionVersion) return
    return app.updateModelContext({content:[{type:'text',text:snapshot}]},{timeout:5000})
  })
}
export async function nativeAsset(project,path) {
  const data=await readAsset(project,path)
  return `data:${data.mimeType};base64,${data.base64}`
}

export async function openExternalLink(url) {
  if(!native) return
  const result=await app.openLink({url})
  if(result.isError) throw new Error(uiText("宿主未打开该链接。","The host could not open this link."))
}

async function downloadAsset(project,path,filename) {
  if(!app.getHostCapabilities()?.downloadFile) throw new Error(uiText("此宿主暂未提供附件下载。文件仍保存在知识库附件目录。","This host does not support downloads. The file is still saved in the library attachment folder."))
  const data=await readAsset(project,path)
  const result=await app.downloadFile({contents:[{type:'resource',resource:{uri:`file:///${encodeURIComponent(filename || path.split('/').pop())}`,mimeType:data.mimeType,blob:data.base64}}]})
  if(result.isError) throw new Error(uiText("附件下载被取消或未完成。","The download was cancelled or could not be completed."))
}

async function readAsset(project,path) {
  // Match the local attachment limit before decoding or allocating a buffer.
  const maxAttachmentBytes=25*1024*1024
  const corrupt=()=>new Error(uiText("附件响应损坏，请重试。","The attachment response is invalid. Please try again."))
  let offset=0,total=null,mimeType=null
  const chunks=[]
  do {
    const data=await nativeCall('wiki_asset',{project,path,offset})
    if(!data || !['total','offset','nextOffset'].every(key=>Number.isSafeInteger(data[key]) && data[key]>=0)) throw corrupt()
    if(data.total>maxAttachmentBytes || data.offset!==offset || data.nextOffset<data.offset || data.nextOffset>data.total) throw corrupt()
    if(total!==null && (total!==data.total || mimeType!==data.mimeType)) throw new Error(uiText("附件在读取时发生变化，请重试。","The attachment changed while loading. Please try again."))
    if(typeof data.mimeType!=='string' || !data.mimeType.trim()) throw corrupt()
    if(data.nextOffset===offset && data.total>offset) throw new Error(uiText("附件读取未取得进展。","The attachment could not finish loading."))
    const expectedBytes=data.nextOffset-data.offset
    // The server emits canonical padded Base64. Check its size before decoding
    // so malformed metadata cannot silently produce truncated or zero-filled data.
    if(typeof data.base64!=='string' || data.base64.length!==4*Math.ceil(expectedBytes/3)) throw corrupt()
    let decoded
    try { decoded=atob(data.base64) } catch { throw corrupt() }
    if(decoded.length!==expectedBytes || btoa(decoded)!==data.base64) throw corrupt()
    chunks.push(Uint8Array.from(decoded,c=>c.charCodeAt(0)))
    total=data.total;mimeType=data.mimeType;offset=data.nextOffset
  }while(offset<total)
  // Base64 must be combined as bytes because independently padded chunks cannot be concatenated.
  const bytes=new Uint8Array(total);let cursor=0
  for(const chunk of chunks){
    if(cursor+chunk.length>total) throw corrupt()
    bytes.set(chunk,cursor);cursor+=chunk.length
  }
  if(cursor!==total || offset!==total) throw corrupt()
  let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768))
  return {mimeType,base64:btoa(binary)}
}
