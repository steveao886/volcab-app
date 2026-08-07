/// <reference types="vite-plugin-pwa/react" />
import { useCallback, useEffect, useState } from 'react'
// vite-plugin-pwa 1.3.0: virtual:pwa-register/react exposes useRegisterSW(),
// see node_modules/vite-plugin-pwa/react.d.ts. This is the update hook the
// package officially provides for React, not a hand-rolled workbox-window.
// There's no src/vite-env.d.ts or similar global declaration file in this
// project (tsconfig.app.json's types only lists "vite/client", and it isn't
// among the files allowed to change in this pass), so the triple-slash
// directive is written directly at the top of this file instead — TypeScript
// allows it at the very top of any source file, it doesn't have to be a .d.ts.
import { useRegisterSW } from 'virtual:pwa-register/react'
import { markUpdateReady } from '../lib/appUpdate'
import { Button } from './Button'

/**
 * A problem observed in production (not among the six items in v1.1, but a
 * user ran straight into it):
 * vite.config.ts has registerType set to 'autoUpdate' — the new SW installs
 * itself in the background and runs skipWaiting + clientsClaim on its own
 * (see dist/sw.js), but the page that's already open is still running the
 * old JS it loaded with; a PWA launched from the home screen is often
 * "resumed" rather than "reloaded," so it can stay stuck on an old version
 * indefinitely without anyone noticing.
 *
 * Under registerType: 'autoUpdate' (see the `auto` branch in
 * dist/client/build/register.js), vite-plugin-pwa only follows
 * workbox-window's "activated" event, and never touches the
 * onNeedRefresh / needRefresh path — that one only fires under
 * registerType: 'prompt' (auto=false), and vite.config.ts can't be changed
 * here. The default behavior on the activated event, when onNeedReload is
 * left unset, is to call `window.location.reload()` directly — a silent
 * refresh mid-review-session would wipe out the current card, so
 * onNeedReload has to be taken over: no auto-refresh, instead show a
 * dismissible prompt and only actually refresh once the user clicks
 * "update now."
 *
 * Also proactively re-checks: when the tab resumes from the background
 * (visibilitychange → visible) or the window regains focus, it calls
 * registration.update() — this is precisely the fix for the "resumed from
 * background rather than reloaded" path itself, since it can't rely solely
 * on the browser's own throttled check (which can be as infrequent as every 24 hours).
 */
export function UpdatePrompt() {
  const [visible, setVisible] = useState(false)
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null)

  const { updateServiceWorker } = useRegisterSW({
    onNeedReload: () => {
      // Recorded as well as shown. This event fires once per worker, and
      // dismissing the banner is plain component state, so without the flag
      // there is nothing left in the session that knows a newer version is
      // installed — the settings page would probe the server, find sw.js
      // unchanged, and cheerfully report "已是最新" to someone still looking
      // at the old build. See lib/appUpdate.ts.
      markUpdateReady()
      setVisible(true)
    },
    onRegisteredSW(_swUrl, reg) {
      setRegistration(reg ?? null)
    },
  })

  // Proactive re-check: once registered, whenever the page becomes visible
  // again from the background or the window regains focus, probe for a new
  // version instead of just waiting on the browser's own throttled check
  // (which can be as infrequent as every 24 hours).
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
    // In autoUpdate mode, updateServiceWorker() just waits for registration
    // to finish before returning — the new SW has already done its own
    // skipWaiting + clientsClaim, no need to send a skip-waiting message.
    // What actually gets this page onto the new version is the full page
    // reload that follows.
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
