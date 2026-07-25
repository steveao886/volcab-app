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
        // 「墨与纸」调色板(见 src/styles/tokens.css):manifest 只能取一组静态
        // 色值,取浅色(纸)主题作为默认 —— 与 index.html 里无 media query 时
        // 的默认外观、以及 :root 未命中 dark 媒体查询时的取值一致。
        theme_color: '#f4f1ea',
        background_color: '#f4f1ea',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            // 满版色块 + 居中字形,居中 80% 安全区内,同一张图可兼任两种用途
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
    }),
  ],
  test: { environment: 'happy-dom' },
})
