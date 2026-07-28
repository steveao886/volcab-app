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
  test: {
    environment: 'happy-dom',
    // Claude Code 的后台任务会在 .claude/worktrees/ 下挂 git worktree —— 那是**整个
    // 仓库的另一份签出**,里面有一模一样的一套测试文件。不排掉的话 vitest 会把两份
    // 都跑一遍:测试数凭空翻倍(实测 24 个文件 469 条变成 47 个文件 924 条),而且
    // 另一份的红灯会算到这份头上。默认的 exclude 只挡 node_modules/dist 之类,
    // 覆写时必须把它们一起写回来。
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/worktrees/**'],
  },
})
