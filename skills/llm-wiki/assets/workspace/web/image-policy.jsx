import React, { useEffect, useState } from "react"
import { isNativeHost, nativeCall } from "./codex-host.js"

export function ImagePolicySettings({lang="zh"}) {
  const t=(zh,en)=>lang==="zh"?zh:en
  const [value, setValue] = useState("")
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)
  const [attempt,setAttempt]=useState(0)
  useEffect(() => {
    if (!isNativeHost()) return
    let active = true
    setError("");setLoaded(false)
    nativeCall("wiki_image_policy", {}).then(result => {
      if (active) { setValue(result.origins.join("\n")); setLoaded(true) }
    }).catch(reason => { if (active) setError(reason.message) })
    return () => { active = false }
  }, [attempt])
  async function save() {
    setBusy(true); setError(""); setSaved(false)
    try {
      const origins = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
      const result = await nativeCall("wiki_image_policy", { origins })
      setValue(result.origins.join("\n")); setSaved(true)
    } catch (reason) { setError(reason.message) }
    finally { setBusy(false) }
  }
  if (!isNativeHost()) return null
  return <section className="lw-settings-section">
    <h3>{t("外部图片","External images")}</h3>
    <p className="lw-help">{t("每行填写一个图片网站地址（HTTPS）。查看图片时会访问这些网站；留空只显示本地附件。","Enter one HTTPS image website per line. Viewing an image contacts that website. Leave blank for local attachments only.")}</p>
    <label htmlFor="wiki-image-origins">{t("允许的图片来源","Allowed image origins")}</label>
    <textarea id="wiki-image-origins" className="lw-input" rows={4} value={value} disabled={!loaded || busy} spellCheck={false} placeholder="https://images.example.com" onChange={event => { setValue(event.target.value); setSaved(false) }} />
    <button className="lw-btn" disabled={!loaded || busy} onClick={save}>{busy ? t("正在保存…","Saving…") : t("保存图片设置","Save image settings")}</button>
    {saved && <p role="status">{t("已保存。请关闭并重新打开知识工作区，让 Codex 应用新的图片设置。","Saved. Close and reopen the workspace so Codex applies the new image settings.")}</p>}
    {error && <div><p role="alert">{error}</p>{!loaded&&<button className="lw-btn" onClick={()=>setAttempt(value=>value+1)}>{t("重新加载","Retry")}</button>}</div>}
  </section>
}
