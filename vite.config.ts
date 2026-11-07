import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['logo.png', 'icon.svg', 'apple-touch-icon.png', 'pwa-192x192.png', 'pwa-maskable-512x512.png'],
        manifest: {
          id: '/',
          name: 'TOT - Inventory & Scan Edition',
          short_name: 'TOT Stock',
          description: "Gestion d'inventaire professionnelle, suivi des mouvements de stocks, scan QR code/code-barres, traçabilité par chantier et contrôle des flux en temps réel.",
          theme_color: '#0f172a',
          background_color: '#0f172a',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
            {
              src: '/icon.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any',
            },
          ],
        },
        workbox: {
          maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        },
        injectRegister: null,
        devOptions: {
          enabled: false,
        },
      }),
      {
        name: 'tot-csp-extra-connect',
        transformIndexHtml(html) {
          const extra = (process.env.VITE_CSP_EXTRA_CONNECT || '').trim();
          if (!extra) return html;
          const sanitizedTokens = extra
            .split(/[\s,]+/)
            .map((s) => s.trim())
            .filter((s) => /^https?:\/\/|^wss?:\/\//.test(s));
          if (sanitizedTokens.length === 0) return html;
          return html.replace(
            "connect-src 'self' https://*.supabase.co wss://*.supabase.co;",
            `connect-src 'self' https://*.supabase.co wss://*.supabase.co ${sanitizedTokens.join(' ')};`
          );
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
        'https://esm.sh/@supabase/supabase-js@2': '@supabase/supabase-js',
      },
    },
    define: {
      'import.meta.env.VITE_ALLOWED_SUPABASE_HOSTS': JSON.stringify(''),
    },
    build: {
      emptyOutDir: false,
    },
    server: {
      port: 3000,
      host: '0.0.0.0',
      allowedHosts: true as const,
      hmr: false,
      watch: null,
    },
  };
});
