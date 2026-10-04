export const UI_LANGUAGE_KEY = 'llm-wiki:interface-language'
let temporaryLanguage = ''
export function getUiLanguage() {
  if (temporaryLanguage === "zh" || temporaryLanguage === "en") return temporaryLanguage
  let saved
  try { saved = globalThis.localStorage?.getItem(UI_LANGUAGE_KEY) } catch {}
  if (saved === 'zh' || saved === 'en') return saved
  const raw = globalThis.window?.I18n?.lang?.() || globalThis.document?.documentElement?.lang || globalThis.navigator?.language || 'en'
  return String(raw).toLowerCase().startsWith('zh') ? 'zh' : 'en'
}
export function setUiLanguage(value) {
  if (!['zh','en'].includes(value)) return false
  temporaryLanguage = value
  try { globalThis.localStorage?.setItem(UI_LANGUAGE_KEY,value) } catch {}
  globalThis.document?.dispatchEvent(new Event('langchange'))
  return true
}
export const uiText = (zh,en) => getUiLanguage()==='zh'?zh:en
