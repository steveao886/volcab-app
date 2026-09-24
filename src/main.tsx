import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// The 朱批 faces (see docs/superpowers/specs/2026-09-23-zhupi-redesign-design.md).
// Bundled, not linked from a CDN: the user reads on Windows and Android,
// neither of which ships a usable Song face. Every @font-face in these
// sheets carries a unicode-range, so the browser fetches only the slices
// whose glyphs are on screen; vite.config.ts caches them for offline use.
import '@fontsource-variable/noto-serif-sc'
import '@fontsource-variable/source-serif-4/opsz.css'
import '@fontsource-variable/source-serif-4/opsz-italic.css'
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
