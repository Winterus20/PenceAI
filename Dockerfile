# Stage 1: Builder
# Node.js 22 Bookworm tabanlı imaj kullanılıyor (Native derlemeler için en uyumlu sürüm)
FROM node:22-bookworm AS builder

# Çalışma dizinini ayarla
WORKDIR /app

# Sadece package(.json) dosyalarını önden kopyala (Docker cache mekanizmasından faydalanmak için)
COPY package*.json ./
COPY src/web/react-app/package*.json ./src/web/react-app/

# Root dizinindeki bağımlılıkları tam olarak kur (Frontend build'i için de gerekli dev dependencies dahil)
RUN npm install

# Frontend dizinindeki bağımlılıkları tam olarak kur
RUN cd src/web/react-app && npm install

# Tüm proje dosyalarını kopyala
COPY . .

# Tüm projeyi build et (backend tsc ve frontend vite)
# Not: Frontend build ciktisi vite.config.ts uyarinca 'dist/web/public' altina cikar
RUN npm run build


# Stage 2: Production
# Boyutu optimum tutabilmek adına multistage yapıyoruz ancak better-sqlite3
# derlemesinin runtime'da sorun çıkartmaması için Bookworm tabanında kalıyoruz.
FROM node:22-bookworm AS runner

# Çalışma dizinini ayarla
WORKDIR /app

# Production mode
ENV NODE_ENV=production
ENV PORT=3001

# Sadece package(.json) dosyalarını önden kopyala
COPY package*.json ./

# Sadece production (çalışma zamanı) bağımlılıklarını kurarak imaj boyutunu küçült
RUN npm install --omit=dev

# Builder aşamasından hazır dist klasörünü (backend ve frontend bir arada) kopyala
COPY --from=builder /app/dist ./dist

# Veritabanı için kullanılacak veri klasörünü oluştur
RUN mkdir -p /app/data

# Sunulan portu bildir
EXPOSE 3001

# Uygulamayı başlat
CMD ["npm", "start"]
