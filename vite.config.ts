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
        // 界面语言是中文(index.html 是 lang="zh-CN"),不能留 vite-plugin-pwa
        // 默认的 'en' —— 系统安装提示与朗读会按这个字段处理应用名。
        lang: 'zh-CN',
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
            // 满版色块 + 居中字形。实测字形包围盒约为画布的 48%x50%,外接圆
            // 直径约 69%,在 maskable 的 80% 安全区内,故同一张图兼任两种用途。
            // (实测方法与「改字号后须重测」的提醒见 scripts/generate-icons.ps1)
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
