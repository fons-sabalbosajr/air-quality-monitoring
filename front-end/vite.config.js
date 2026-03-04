import { defineConfig } from 'vite'
import path from 'path'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), basicSsl()],
  build: {
    chunkSizeWarningLimit: 1400,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          antd: ['antd', '@ant-design/icons'],
          recharts: ['recharts'],
          leaflet: ['leaflet', 'react-leaflet'],
          globe: ['globe.gl', 'three'],
        }
      }
    }
  },
  server: {
    // Bind explicitly to all interfaces so other LAN devices can reach it
    host: '0.0.0.0',
    port: 5173,
    // HTTPS enabled via @vitejs/plugin-basic-ssl (self-signed cert)
    // Accept the browser warning on first visit, then it works on LAN.
  },
  resolve: {
    // Ensure a single Three.js instance is used across all dependencies
    dedupe: ['three'],
    alias: {
      '@components': path.resolve(__dirname, 'src/components'),
    }
  },
  optimizeDeps: {
    include: ['three', 'globe.gl'],
  },
})
