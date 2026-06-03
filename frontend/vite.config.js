import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const BUILD_DATE = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      pwaAssets: {
        image: 'public/favicon.svg',
        preset: 'minimal-2023',
        includeHtmlHeadLinks: true,
        overrideManifestIcons: true,
      },
      workbox: {
        cacheId: `portfolion-${BUILD_DATE}`,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        skipWaiting: true,
        clientsClaim: true,
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'cdn-fonts',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) => /\/api\//i.test(url.pathname) && !/\/api\/auth\/oauth/i.test(url.pathname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 10,
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 5 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        name: 'PortfoliOn',
        short_name: 'PortfoliOn',
        description: '내 포트폴리오를 한눈에 — AI 기반 주식 리포트',
        theme_color: '#f6f6f4',
        background_color: '#f6f6f4',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        lang: 'ko',
      },
    }),
    {
      name: 'sw-cache-bust',
      apply: 'build',
      closeBundle: {
        sequential: true,
        order: 'post',
        async handler() {
          const fs = await import('fs')
          const path = await import('path')
          const indexPath = path.resolve('dist/index.html')
          let html = fs.readFileSync(indexPath, 'utf-8')
          html = html.replace(/(registerSW\.js)/g, `$1?${BUILD_DATE}`)
          fs.writeFileSync(indexPath, html)
        },
      },
    },
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
    watch: {
      usePolling: true,
      interval: 500,
    },
  },
})
