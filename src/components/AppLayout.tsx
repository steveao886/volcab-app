import { Outlet } from 'react-router-dom'
import { TabBar } from './TabBar'

/** 已登录区域的外壳:导航 + 路由出口 + 弹层挂载点。 */
export function AppLayout() {
  return (
    <div className="app">
      <TabBar />
      <main className="app__main">
        <Outlet />
      </main>
      {/*
        固定定位/浮层内容(底部「删除所选」条、确认对话框)请用
        createPortal(node, document.getElementById('overlay-root')) 挂到这里:
        层级确定在页签之上,也不受页面自身的层叠上下文影响。
      */}
      <div className="overlay-root" id="overlay-root" />
    </div>
  )
}
