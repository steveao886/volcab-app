import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/volcab-app/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Volcab 单词本',
        short_name: 'Volcab',
        description: '个人记单词 App',
        display: 'standalone',
        start_url: '/volcab-app/',
        // The UI language is Chinese (index.html has lang="zh-CN"), so this
        // can't be left at vite-plugin-pwa's default of 'en' -- the system
        // install prompt and screen readers handle the app name based on
        // this field.
        lang: 'zh-CN',
        // The "ink and paper" palette (see src/styles/tokens.css): the
        // manifest can only take one static set of color values, so the
        // light (paper) theme is used as the default -- consistent with
        // index.html's default appearance when there's no media query, and
        // with what :root resolves to when the dark media query doesn't
        // match.
        theme_color: '#f4f1ea',
        background_color: '#f4f1ea',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            // Full-bleed color block + centered glyph. Measured directly,
            // the glyph's bounding box is about 48%x50% of the canvas, and
            // its circumscribed circle diameter is about 69%, within
            // maskable's 80% safe zone -- so the same image serves both
            // purposes. (Measurement method and the "re-measure after
            // changing font size" reminder live in scripts/generate-icons.ps1)
            purpose: 'any maskable',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        // Pronunciation recordings (see src/lib/pronounce.ts). CacheFirst
        // against the same bucket preparePronunciation() fills with
        // cache.add(): workbox matches by URL, so a body warmed at prepare
        // time is served from cache at playback time — which is what lets
        // `new Audio(url)` replay a once-heard word offline. An mp3 never
        // changes under its URL, so revalidation would be pure waste.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.dictionaryapi\.dev\/media\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'volcab-pronunciations',
              expiration: { maxEntries: 600 },
            },
          },
          // The server-voice tier (see youdaoUrl in src/lib/pronounce.ts).
          // Youdao sends no CORS headers, so these arrive as opaque
          // responses — cacheable and playable by an <audio> element, but
          // only if cacheableResponse admits status 0; CacheFirst's default
          // (200 only) would silently never cache them and every replay
          // would go back to the network.
          {
            urlPattern: /^https:\/\/dict\.youdao\.com\/dictvoice/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'volcab-pronunciations',
              expiration: { maxEntries: 600 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'happy-dom',
    // Claude Code's background tasks mount a git worktree under
    // .claude/worktrees/ -- that's **a second full checkout of the repo**,
    // containing an identical copy of every test file. Without excluding
    // it, vitest would run both copies: the test count doubles out of
    // nowhere (measured: 24 files / 469 tests becomes 47 files / 924
    // tests), and failures in the other copy would get attributed to this
    // one. The default exclude only blocks things like node_modules/dist,
    // so overriding it means writing those back in alongside this one.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/worktrees/**'],
  },
})
