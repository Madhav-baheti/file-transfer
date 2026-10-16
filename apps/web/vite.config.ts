import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'quickdrop-icon.svg'],
      manifest: {
        name: 'QuickDrop — Direct File Transfer',
        short_name: 'QuickDrop',
        description: 'Transfer files directly between devices. No sign-up or cloud storage.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f5f5f7',
        theme_color: '#636c79',
        icons: [
          {
            src: '/pwa-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/quickdrop-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2,webmanifest}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    port: 5173,
    host: true, // Expose to local network for phone testing
  },
  build: {
    target: 'ES2022',
    sourcemap: true,
  },
});
