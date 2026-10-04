// Screen-space layout: labels must avoid both labels and visible node circles.
// A spatial grid keeps dense libraries bounded without hiding their nodes.
export function layoutGraphLabels(nodes,{width,height,measureText,maxLabels=60,obstacles=[]}) {
  if(width<60||height<60)return []
  const grid=new Map(),cell=64,padding=10
  const cells=box=>{const keys=[];for(let x=Math.floor(box.x/cell);x<=Math.floor((box.x+box.width)/cell);x++)for(let y=Math.floor(box.y/cell);y<=Math.floor((box.y+box.height)/cell);y++)keys.push(`${x}:${y}`);return keys}
  const overlaps=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y
  const insert=box=>cells(box).forEach(key=>{if(!grid.has(key))grid.set(key,[]);grid.get(key).push(box)})
  const clear=box=>cells(box).every(key=>(grid.get(key)||[]).every(other=>!overlaps(box,other)))
  const visible=nodes.filter(n=>Number.isFinite(n.x)&&Number.isFinite(n.y)&&n.x+n.size>=0&&n.y+n.size>=0&&n.x-n.size<=width&&n.y-n.size<=height)
  visible.forEach(n=>insert({x:n.x-n.size-3,y:n.y-n.size-3,width:2*n.size+6,height:2*n.size+6}))
  obstacles.forEach(insert)
  const sorted=[...visible].sort((a,b)=>(b.priority||0)-(a.priority||0)||(b.importance||0)-(a.importance||0)||String(a.id).localeCompare(String(b.id)))
  const result=[]
  for(const node of sorted){
    if(result.length>=maxLabels)break
    let text=String(node.label||'');if(!text)continue
    const fontSize=node.fontSize||12,maxWidth=Math.min(node.priority>=3?220:155,width-2*padding-12)
    if(measureText(text,fontSize)>maxWidth){const chars=Array.from(text);while(chars.length&&measureText(chars.join('')+'…',fontSize)>maxWidth)chars.pop();text=chars.join('')+'…'}
    const w=Math.ceil(measureText(text,fontSize))+8,h=fontSize+8,gap=node.size+6
    const candidates=[{x:node.x+gap,y:node.y-h/2},{x:node.x-gap-w,y:node.y-h/2},{x:node.x-w/2,y:node.y-gap-h},{x:node.x-w/2,y:node.y+gap}]
    const box=candidates.map(p=>({...p,width:w,height:h})).find(box=>box.x>=padding&&box.y>=padding&&box.x+box.width<=width-padding&&box.y+box.height<=height-padding&&clear(box))
    if(!box)continue
    insert(box);result.push({...box,id:node.id,text,fontSize,priority:node.priority||0})
  }
  return result
}
