import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/AppLayout'
import { GuestOnly, RequireAuth } from './components/RequireAuth'
import { AddWord } from './pages/AddWord'
import { DevGallery } from './pages/DevGallery'
import { Discover } from './pages/Discover'
import { Library } from './pages/Library'
import { Login } from './pages/Login'
import { Quiz } from './pages/Quiz'
import { Review } from './pages/Review'
import { Settings } from './pages/Settings'
import { Stats } from './pages/Stats'
import { Today } from './pages/Today'
import { WordDetail } from './pages/WordDetail'

/**
 * Route table. GitHub Pages has no server-side rewrites, so HashRouter is
 * used unconditionally.
 * Every page besides /login sits inside RequireAuth; /login, in turn, is
 * guarded by GuestOnly, which bounces back to the home page once logged in.
 * The /dev component gallery is only registered in dev mode, and is
 * deliberately left outside the guard — it needs to be viewable even when
 * logged out.
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
          <Route path="/discover" element={<Discover />} />
          <Route path="/word/:id" element={<WordDetail />} />
          <Route path="/stats" element={<Stats />} />
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
