import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

const rawPort = process.env.PORT;
const basePath = process.env.BASE_PATH ?? '/';
const isDemoMode = process.env.VITE_DEMO_MODE === 'true';

// PORT is only required when running the dev/preview server, not during `vite build`.
const isBuild = process.argv.includes('build');

let port = 3000; // fallback default (unused during build)
if (!isBuild) {
  if (!rawPort) {
    throw new Error('PORT environment variable is required but was not provided.');
  }
  const parsed = Number(rawPort);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }
  port = parsed;
}

// Demo-mode aliases replace the real Firebase SDK with our in-memory mocks.
const demoAliases = isDemoMode
  ? {
      'firebase/app': path.resolve(import.meta.dirname, 'src/lib/mock/firebase-app.ts'),
      'firebase/auth': path.resolve(import.meta.dirname, 'src/lib/mock/firebase-auth.ts'),
      'firebase/firestore': path.resolve(import.meta.dirname, 'src/lib/mock/firebase-firestore.ts'),
    }
  : {};

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      ...demoAliases,
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
