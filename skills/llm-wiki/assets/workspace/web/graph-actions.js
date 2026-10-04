// Graph context contains locators, never cached page bodies or guessed revisions.
export function buildGraphRequest({projectPath, graphData, selectedId, action, language='zh'}) {
  const zh=language==='zh'
  if(!projectPath)throw new Error(zh?'请先打开知识库。':'Open a library first.')
  if(!['explain','organize'].includes(action))throw new Error('Unsupported graph action')
  const node=selectedId==null?null:graphData?.nodes?.find(row=>String(row.id)===String(selectedId))
  if(action==='explain' && !node?.path)throw new Error(zh?'请先选择一篇笔记。':'Select a note first.')
  const context={knowledgeBase:projectPath,view:'graph',action,selectedPage:action==='explain'?node.path:null,revision:null}
  if(action==='explain'){
    const neighbors=new Set()
    for(const edge of graphData.edges||[]){
      if(String(edge.source)===String(node.id))neighbors.add(String(edge.target))
      if(String(edge.target)===String(node.id))neighbors.add(String(edge.source))
    }
    const related=(graphData.nodes||[]).filter(row=>neighbors.has(String(row.id))&&row.path)
    context.relatedPages=related.slice(0,30).map(row=>row.path)
    context.relatedPageCount=related.length
  }
  const message=action==='explain'
    ? zh?'请读完所选笔记，再结合相关笔记说明它的主要观点、依据和联系。引用具体笔记或原始来源；本次只讨论，不修改文件。上下文里的相关页面只是图谱候选，需先读取再判断。'
      :'Read the selected note, then explain its main ideas, evidence and connections to related notes. Cite specific notes or original sources. Discuss only; do not edit files. Related pages in the context are graph candidates: read them before drawing conclusions.'
    : zh?'请用 llm-wiki-relink 整理当前知识库的笔记关联：先读内容，只补充有依据的链接；保留正文、页面类型和自定义颜色。完成后说明改了哪些笔记。'
      :'Use llm-wiki-relink to organize note connections in this library. Read the content first and add only supported links. Preserve prose, page types and custom colors. Report which notes changed.'
  return {message,context}
}

export function findGraphNodes(nodes,query,limit=8){
  const text=String(query||'').trim().toLocaleLowerCase()
  if(!text)return []
  return (nodes||[]).filter(node=>`${node.title||''} ${node.path||''}`.toLocaleLowerCase().includes(text)).slice(0,limit)
}
