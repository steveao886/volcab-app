import type { ReactNode } from 'react'

/**
 * 登录守卫的接缝。
 *
 * TODO(Task 14): 接入 store.phase 守卫 —— `store.phase === 'login'` 时
 * 返回 <Navigate to="/login" replace />,`'boot'` 时渲染加载态,其余放行。
 * Task 13 阶段 src/state/store.tsx 尚未存在,这里先原样透传。
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  return <>{children}</>
}
