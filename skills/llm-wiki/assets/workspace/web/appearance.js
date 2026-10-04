export const APPEARANCE_KEY = 'llm-wiki:appearance'
let preference
let hostTheme
export function getAppearance() {
  if (preference) return preference
  try { const saved=globalThis.localStorage?.getItem(APPEARANCE_KEY); if(['system','light','dark'].includes(saved)) return saved } catch {}
  return 'light'
}
export function applyAppearance() {
  const mode=getAppearance()
  const resolved=mode==='system'?(hostTheme || (globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches?'dark':'light')):mode
  if(globalThis.document?.documentElement) document.documentElement.dataset.theme=resolved
  globalThis.document?.dispatchEvent(new Event('themechange'))
  return resolved
}
export function setAppearance(value) {
  if(!['system','light','dark'].includes(value)) return false
  preference=value
  try {globalThis.localStorage?.setItem(APPEARANCE_KEY,value)}catch{}
  applyAppearance()
  globalThis.document?.dispatchEvent(new Event('appearancechange'))
  return true
}
export function setHostTheme(theme) {
  if(['light','dark'].includes(theme)) hostTheme=theme
  applyAppearance()
}
if(typeof window!=='undefined') {
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change',()=>{if(getAppearance()==='system')applyAppearance()})
  window.addEventListener('storage',event=>{if(event.key===APPEARANCE_KEY){preference=undefined;applyAppearance();document.dispatchEvent(new Event('appearancechange'))}})
  applyAppearance()
}
