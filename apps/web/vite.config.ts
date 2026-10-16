import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
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
        share_target: {
          action: '/share-target',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            files: [{ name: 'files', accept: ['*/*'] }],
          },
        },
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
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2,webmanifest}'],
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
