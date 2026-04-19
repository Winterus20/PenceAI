import path from "path"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

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
    target: 'es2020',
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react-dom') || id.includes('react/')) return 'vendor-react';
            if (id.includes('@radix-ui')) return 'vendor-radix';
            if (id.includes('@tanstack/react-query')) return 'vendor-query';
            if (id.includes('framer-motion')) return 'vendor-animation';
            if (id.includes('d3-selection') || id.includes('d3-zoom') || id.includes('d3-force') || id.includes('d3-drag')) return 'vendor-d3';
            if (id.includes('react-syntax-highlighter') || id.includes('prismjs') || id.includes('refractor')) return 'vendor-syntax';
            if (id.includes('react-markdown') || id.includes('remark') || id.includes('rehype') || id.includes('unified') || id.includes('micromark') || id.includes('mdast') || id.includes('vfile')) return 'vendor-markdown';
            if (id.includes('zustand') || id.includes('lucide-react') || id.includes('react-virtuoso') || id.includes('react-hot-toast') || id.includes('class-variance-authority') || id.includes('clsx') || id.includes('tailwind-merge')) return 'vendor-utils';
          }
        },
      },
    },
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
          proxy.on('proxyReqWs', (proxyReq, req, _socket, _options, _head) => {
          	// Auth header'larını WebSocket proxy'ye ilet
          	if (req.headers.authorization) {
          		proxyReq.setHeader('Authorization', req.headers.authorization);
          	}
          	if (req.headers['sec-websocket-protocol']) {
          		proxyReq.setHeader('sec-websocket-protocol', req.headers['sec-websocket-protocol'] as string);
          	}
          	console.log('[Vite Proxy] WebSocket bağlantısı kuruluyor...');
          });
        },
      }
    }
  }
})
