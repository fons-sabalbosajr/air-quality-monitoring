import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    // Ensure a single Three.js instance is used across all dependencies
    dedupe: ['three'],
  },
  optimizeDeps: {
    include: ['three', 'globe.gl'],
  },
})
