import { Outlet, useLocation } from 'react-router-dom'
import { TabBar } from './TabBar'

/** 已登录区域的外壳:导航 + 路由出口(切换时轻微上浮淡入)。 */
export function AppLayout() {
  const { pathname } = useLocation()

  return (
    <div className="app">
      <TabBar />
      <main className="app__main">
        {/* key 让每次换路由重放进场动画 */}
        <div className="page-transition" key={pathname}>
          <Outlet />
        </div>
      </main>
    </div>
  )
}
