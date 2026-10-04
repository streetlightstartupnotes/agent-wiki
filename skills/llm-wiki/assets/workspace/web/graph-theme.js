function cssValue(style, name, fallback) {
  const value = style?.getPropertyValue?.(name)?.trim()
  return value || fallback
}

export function graphThemePalette(style) {
  const scheme = String(style?.colorScheme || cssValue(style, "color-scheme", "")).toLowerCase()
  const dark = scheme.includes("dark")
  const background = cssValue(style, "--background", dark ? "#27272a" : "#ffffff")
  return {
    dark, background,
    text: cssValue(style, "--foreground", style?.color || (dark ? "#fafafa" : "#252525")),
    muted: cssValue(style, "--muted-foreground", dark ? "#a3a3a3" : "#737373"),
    surface: cssValue(style, "--card", background),
    border: cssValue(style, "--border", dark ? "rgba(255,255,255,.18)" : "rgba(15,23,42,.16)"),
    shadow: dark ? "rgba(0,0,0,.62)" : "rgba(15,23,42,.24)",
    labelAlphaFloor: dark ? .68 : .74,
    edge: dark ? "#596760" : "#9baaa2",
    bidirectionalEdge: dark ? "#6a8295" : "#91aabd",
    focusedEdge: dark ? "#b4cce0" : "#527da6",
  }
}

export function readGraphThemePalette(element) {
  const root = element?.closest?.(".llm-wiki-root") || element
  return graphThemePalette(window.getComputedStyle(root))
}

// Saturated, stable category colors. Bright dark-mode variants keep their hue.
const DOPAMINE_COLORS = {
  "#2563eb": ["#1670ff", "#65b4ff"],
  "#7c3aed": ["#853dff", "#b18aff"],
  "#db2777": ["#f52c87", "#ff71b6"],
  "#ea580c": ["#fa6715", "#ffab4e"],
  "#16a34a": ["#00a85b", "#54e990"],
  "#0891b2": ["#009cbd", "#45dbea"],
  "#4f46e5": ["#5f4bff", "#9992ff"],
  "#c026d3": ["#cf31eb", "#ee83ff"],
  "#ca8a04": ["#edaf00", "#ffda45"],
  "#0f766e": ["#009c85", "#4de1be"],
}
export function graphColorContrast(a,b){
  const rgb=value=>{const hex=String(value).replace('#','');return hex.length===6?[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)):null}
  const luminance=color=>{const c=rgb(color);if(!c||c.some(v=>!Number.isFinite(v)))return 0;return c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0)}
  const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)
}
export function graphNodeColor(raw,palette){
  let hex=String(raw||'').toLowerCase()
  if(/^#[0-9a-f]{3}$/.test(hex))hex='#'+Array.from(hex.slice(1)).map(c=>c+c).join('')
  if(!/^#[0-9a-f]{6}$/.test(hex))hex='#2563eb'
  hex=DOPAMINE_COLORS[hex]?.[palette.dark?1:0]||hex
  const background=/^#[0-9a-f]{6}$/i.test(palette.background)?palette.background:palette.dark?'#202223':'#fcfcfa'
  const original=[0,2,4].map(i=>parseInt(hex.slice(i+1,i+3),16)),target=palette.dark?230:25
  for(let step=0;step<=20;step++){
    const mix=step/20,color='#'+original.map(v=>Math.round(v+(target-v)*mix).toString(16).padStart(2,'0')).join('')
    if(graphColorContrast(color,background)>=3)return color
  }
  return palette.dark?'#e6e6e6':'#191919'
}
