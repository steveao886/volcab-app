import { Outlet } from 'react-router-dom'
import { TabBar } from './TabBar'

/** Shell for the authenticated area: nav + route outlet + overlay mount point. */
export function AppLayout() {
  return (
    <div className="app">
      <TabBar />
      <main className="app__main">
        <Outlet />
      </main>
      {/*
        Fixed-position/overlay content (bottom "delete selected" bar, confirm
        dialogs) should mount here via
        createPortal(node, document.getElementById('overlay-root')):
        stacking order is guaranteed above the tab bar, unaffected by any
        page's own stacking context.
      */}
      <div className="overlay-root" id="overlay-root" />
    </div>
  )
}
