// Plain text only: previewing Markdown never executes HTML or loads remote media.
export function previewText(markdown='') {
  return String(markdown).replace(/^\uFEFF/,'').replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/,'')
    .replace(/```[^\n]*\n[\s\S]*?```/g,'').replace(/^#{1,6} .*$/gm,'')
    .replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/<[^>]*>/g,'')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,(_,path,label)=>label||path)
    .replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[*`_~]/g,'').replace(/^>\s?/gm,'')
    .replace(/\n{3,}/g,'\n\n').trim()
}
export function previewSource(frontmatter={}) {
  const sources=frontmatter.sources
  if(!Array.isArray(sources))return null
  return sources.find(path=>typeof path==='string'&&path.startsWith('raw/sources/')&&!path.split('/').includes('..'))||null
}
export function previewTasks(markdown='') {
  return [...String(markdown).matchAll(/^\s*[-*] \[([ xX])\] (.+)$/gm)].slice(0,3).map(match=>({done:match[1]!==' ',text:previewText(match[2])}))
}
