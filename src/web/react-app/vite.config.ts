import path from "path"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "../../../dist/web/public",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
        configure: (proxy, _options) => {
          proxy.on('error', (err, _req, _res) => {
            // ECONNRESET hataları genellikle backend yeniden başlatıldığında oluşur
            // Bu hataları sessizce loglayalım, çünkü frontend otomatik yeniden bağlanacak
            if ('code' in err && err.code === 'ECONNRESET') {
              console.log('[Vite Proxy] Backend bağlantısı sıfırlandı, yeniden bağlanılıyor...');
            } else {
              console.error('[Vite Proxy] WebSocket proxy hatası:', err.message);
            }
          });
          proxy.on('proxyReqWs', (_proxyReq, _req, _socket, _options, _head) => {
            console.log('[Vite Proxy] WebSocket bağlantısı kuruluyor...');
          });
        },
      }
    }
  }
})
