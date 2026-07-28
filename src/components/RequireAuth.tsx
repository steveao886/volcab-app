import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Button } from './Button'
import { useApp } from '../state/store'

/**
 * Boot state. When the store has a cache it jumps straight to ready on the
 * first frame, so this screen normally only flashes briefly on "a new
 * device with no local word list yet." Reuses the button's loading spinner
 * instead of inventing a separate style.
 */
function Booting() {
  return (
    <div className="auth">
      <Button variant="ghost" loading>载入中…</Button>
    </div>
  )
}

/** Login guard: bounces back to /login whenever not logged in. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { phase } = useApp()
  if (phase === 'boot') return <Booting />
  if (phase === 'login') return <Navigate to="/login" replace />
  return <>{children}</>
}

/** Reverse guard: once logged in, don't stay on the login page. */
export function GuestOnly({ children }: { children: ReactNode }) {
  const { phase } = useApp()
  if (phase === 'boot') return <Booting />
  if (phase === 'ready') return <Navigate to="/" replace />
  return <>{children}</>
}
