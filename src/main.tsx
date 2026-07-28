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
    {/* Independent of login state: stale JS can be stuck on the /login page
        or on any logged-in page, so the update prompt shouldn't depend on
        AppLayout's #overlay-root (that subtree isn't even mounted when
        logged out). See the top-of-file comment in components/UpdatePrompt.tsx. */}
    <UpdatePrompt />
  </StrictMode>,
)
