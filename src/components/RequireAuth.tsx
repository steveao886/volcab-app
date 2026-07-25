import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Button } from './Button'
import { useApp } from '../state/store'

/**
 * 启动态。store 有缓存时会在首帧就直接进 ready,所以这一屏通常只在
 * 「换了新设备、本地还没有词库」时闪一下。复用按钮的 loading 转圈,不另造样式。
 */
function Booting() {
  return (
    <div className="auth">
      <Button variant="ghost" loading>载入中…</Button>
    </div>
  )
}

/** 登录守卫:未登录一律弹回 /login。 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { phase } = useApp()
  if (phase === 'boot') return <Booting />
  if (phase === 'login') return <Navigate to="/login" replace />
  return <>{children}</>
}

/** 反向守卫:已登录就别再停在登录页。 */
export function GuestOnly({ children }: { children: ReactNode }) {
  const { phase } = useApp()
  if (phase === 'boot') return <Booting />
  if (phase === 'ready') return <Navigate to="/" replace />
  return <>{children}</>
}
