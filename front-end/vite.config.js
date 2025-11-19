import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import mkcert from 'vite-plugin-mkcert'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), mkcert({
    // Include common local names & current LAN IP; add hostname if needed
    hosts: ['localhost', '127.0.0.1', '10.14.77.107']
  })],
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
    https: true,
    // If tablet still reports unreachable, try setting https:false temporarily
  },
  resolve: {
    // Ensure a single Three.js instance is used across all dependencies
    dedupe: ['three'],
  },
  optimizeDeps: {
    include: ['three', 'globe.gl'],
  },
})
