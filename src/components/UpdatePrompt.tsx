/// <reference types="vite-plugin-pwa/react" />
import { useCallback, useEffect, useState } from 'react'
// vite-plugin-pwa 1.3.0:virtual:pwa-register/react 暴露 useRegisterSW(),见
// node_modules/vite-plugin-pwa/react.d.ts。这是这个包官方给 React 用的更新钩子,
// 不是自己拼 workbox-window。项目里没有 src/vite-env.d.ts 这类全局声明文件
// (tsconfig.app.json 的 types 只列了 "vite/client",且它不在本次允许改动的
// 文件之列),所以三斜线指令直接写在本文件顶部——TypeScript 允许出现在任意
// 源文件的最前面,不必是 .d.ts。
import { useRegisterSW } from 'virtual:pwa-register/react'
import { Button } from './Button'

/**
 * 生产环境实测到的问题(不在 v1.1 六项之内,但用户当场撞上了):
 * vite.config.ts 的 registerType 是 'autoUpdate'——新 SW 在后台装好后会自己
 * skipWaiting + clientsClaim(见 dist/sw.js),但已经打开的这个页面仍在跑
 * 装载时那份旧 JS;PWA 从主屏幕启动时常是"恢复"而不是"重新加载",
 * 可能长期停在旧版本上不自知。
 *
 * vite-plugin-pwa 在 registerType: 'autoUpdate' 下(见 dist/client/build/register.js
 * 里 `auto` 分支)只走 workbox-window 的 "activated" 事件,不会用到
 * onNeedRefresh / needRefresh 那一套——那套只在 registerType: 'prompt'(auto=false)
 * 时才会被触发,而这里改不了 vite.config.ts。activated 事件的默认行为是
 * onNeedReload 缺省时直接 `window.location.reload()`——静默刷新会在复习
 * 会话翻到一半时把当前卡冲掉,所以必须接管 onNeedReload:不自动刷新,
 * 改为弹一条可关闭的提示,用户点「立即更新」才真正刷新。
 *
 * 另外主动补一次检查:后台恢复(visibilitychange → visible)或窗口重新
 * 获得焦点时调用 registration.update()——这正是"从后台恢复而非重新加载"
 * 这条路径本身的修法,不能只靠浏览器自己的节流检查(间隔可长达 24 小时)。
 */
export function UpdatePrompt() {
  const [visible, setVisible] = useState(false)
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null)

  const { updateServiceWorker } = useRegisterSW({
    onNeedReload: () => setVisible(true),
    onRegisteredSW(_swUrl, reg) {
      setRegistration(reg ?? null)
    },
  })

  // 主动补检查:注册完成后,只要页面从后台恢复可见或窗口重新获得焦点,就
  // 探一次新版本,而不是干等浏览器自己的节流检查(间隔可长达 24 小时)。
  useEffect(() => {
    if (!registration) return
    const checkForUpdate = () => {
      void registration.update()
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') checkForUpdate()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', checkForUpdate)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', checkForUpdate)
    }
  }, [registration])

  const handleUpdate = useCallback(() => {
    setVisible(false)
    // updateServiceWorker() 在 autoUpdate 模式下只是等注册完成再返回——新 SW
    // 早已自行 skipWaiting + clientsClaim,不需要再发 skip-waiting 消息。
    // 真正让这个页面吃到新版本的是随后的整页刷新。
    void updateServiceWorker().finally(() => window.location.reload())
  }, [updateServiceWorker])

  const handleDismiss = useCallback(() => setVisible(false), [])

  if (!visible) return null

  return (
    <div className="update-prompt" role="status">
      <p className="update-prompt__text">有新版本</p>
      <div className="update-prompt__actions">
        <Button variant="ghost" size="sm" onClick={handleDismiss}>
          稍后
        </Button>
        <Button variant="primary" size="sm" onClick={handleUpdate}>
          立即更新
        </Button>
      </div>
    </div>
  )
}
