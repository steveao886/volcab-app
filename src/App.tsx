import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/AppLayout'
import { GuestOnly, RequireAuth } from './components/RequireAuth'
import { AddWord } from './pages/AddWord'
import { DevGallery } from './pages/DevGallery'
import { Library } from './pages/Library'
import { Login } from './pages/Login'
import { Quiz } from './pages/Quiz'
import { Review } from './pages/Review'
import { Settings } from './pages/Settings'
import { Today } from './pages/Today'
import { WordDetail } from './pages/WordDetail'

/**
 * 路由表。GitHub Pages 无服务端重写,固定用 HashRouter。
 * /login 之外的所有页面都在 RequireAuth 之内;/login 反过来被 GuestOnly 守着,
 * 已登录时弹回首页。
 * /dev 组件总览只在开发模式注册,且刻意留在守卫之外 —— 未登录也要能看。
 */
function App() {
  return (
    <HashRouter>
      <Routes>
        <Route
          path="/login"
          element={
            <GuestOnly>
              <Login />
            </GuestOnly>
          }
        />
        <Route
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route path="/" element={<Today />} />
          <Route path="/review" element={<Review />} />
          <Route path="/quiz" element={<Quiz />} />
          <Route path="/library" element={<Library />} />
          <Route path="/word/:id" element={<WordDetail />} />
          <Route path="/add" element={<AddWord />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
        {import.meta.env.DEV && (
          <Route element={<AppLayout />}>
            <Route path="/dev" element={<DevGallery />} />
          </Route>
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}

export default App
