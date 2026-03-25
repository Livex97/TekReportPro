import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const host = process.env.TAURI_DEV_HOST

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],

  // Vite options tailored for Tauri development
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
        protocol: 'ws',
        host,
        port: 1421,
      }
      : undefined,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ['**/src-tauri/**'],
    },
  },
  // envPrefix is important for security and for tauri-specific env vars
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    // Tauri supports es2021
    target: process.env.TAURI_PLATFORM == 'windows' ? 'chrome105' : 'safari15',
    // don't minify for debug builds
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    // produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_DEBUG,
    // Increase warning limit to 3MB (3000000 bytes) to accommodate large but necessary chunks
    chunkSizeWarningLimit: 3000000,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // React core (separate from other React libs)
          if (id.includes('react/cjs/react.production.min') || 
              id.includes('react/cjs/react-jsx-runtime.production.min') ||
              id.includes('react/index') && !id.includes('router')) {
            return 'react-core';
          }
          // React DOM
          if (id.includes('react-dom') || id.includes('react-dom/client')) {
            return 'react-dom';
          }
          // React Router
          if (id.includes('react-router')) {
            return 'react-router';
          }
          // Tauri core API
          if (id.includes('@tauri-apps/api') && !id.includes('plugin-')) {
            return 'tauri-api';
          }
          // Tauri plugins - each separately
          if (id.includes('@tauri-apps/plugin-dialog')) {
            return 'tauri-dialog';
          }
          if (id.includes('@tauri-apps/plugin-fs')) {
            return 'tauri-fs';
          }
          if (id.includes('@tauri-apps/plugin-log')) {
            return 'tauri-log';
          }
          if (id.includes('@tauri-apps/plugin-notification')) {
            return 'tauri-notification';
          }
          if (id.includes('@tauri-apps/plugin-store')) {
            return 'tauri-store';
          }
          if (id.includes('@tauri-apps/plugin-updater')) {
            return 'tauri-updater';
          }
          // PDF.js core
          if (id.includes('pdfjs-dist') && !id.includes('worker')) {
            return 'pdfjs-core';
          }
          // PDF worker (already large, but kept separate)
          if (id.includes('pdf.worker')) {
            return 'pdfjs-worker';
          }
          // Document libraries - separate each
          if (id.includes('mammoth')) {
            return 'mammoth';
          }
          if (id.includes('pizzip')) {
            return 'pizzip';
          }
          if (id.includes('docxtemplater')) {
            return 'docxtemplater';
          }
          if (id.includes('file-saver')) {
            return 'file-saver';
          }
          // Canvas libraries
          if (id.includes('html2canvas')) {
            return 'html2canvas';
          }
          if (id.includes('jspdf')) {
            return 'jspdf';
          }
          // Tailwind
          if (id.includes('tailwindcss') || id.includes('@tailwindcss')) {
            return 'tailwindcss';
          }
          // Lucide icons
          if (id.includes('lucide-react') || id.includes('lucide')) {
            return 'lucide';
          }
          // Utilities
          if (id.includes('idb-keyval')) {
            return 'idb-keyval';
          }
          if (id.includes('postal-mime')) {
            return 'postal-mime';
          }
          if (id.includes('@xmldom/xmldom')) {
            return 'xmldom';
          }
        }
      }
    }
  },
})

