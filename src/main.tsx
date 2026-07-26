import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import App from './App.tsx'
import { UpdatePrompt } from './components/UpdatePrompt.tsx'
import { AppProvider } from './state/store.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
    {/* 独立于登录态之外:一份陈旧的 JS 可能停在 /login 页也可能停在任何已登录
        页面,更新提示不应该依赖 AppLayout 内的 #overlay-root(未登录时那棵子树
        根本没挂载)。见 components/UpdatePrompt.tsx 顶部注释。 */}
    <UpdatePrompt />
  </StrictMode>,
)
