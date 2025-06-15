
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path' // Import path module
import { fileURLToPath } from 'url'; // Import fileURLToPath

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Resolve __dirname for ESM
      '@': path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.'), 
    },
  },
})