import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/AppLayout'
import { RequireAuth } from './components/RequireAuth'
import { AddWord } from './pages/AddWord'
import { Library } from './pages/Library'
import { Login } from './pages/Login'
import { Quiz } from './pages/Quiz'
import { Review } from './pages/Review'
import { Settings } from './pages/Settings'
import { Today } from './pages/Today'
import { WordDetail } from './pages/WordDetail'

/**
 * 路由表。GitHub Pages 无服务端重写,固定用 HashRouter。
 * /login 之外的所有页面都在 RequireAuth 之内(守卫由 Task 14 接上 store)。
 */
function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}

export default App
