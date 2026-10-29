import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // Expose to LAN (0.0.0.0) so other devices on Wi-Fi can connect
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_BACKEND_PROXY_URL || 'http://localhost:8080',
        changeOrigin: true,
        secure: false,
      },
      '/ws': {
        target: process.env.VITE_WS_PROXY_URL || 'ws://localhost:8080',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
