# Stage 1: Builder
# Node.js 22 Bookworm tabanli imaj (better-sqlite3 ve sqlite-vec derlemeleri icin glibc uyumlu)
FROM node:22-bookworm AS builder

WORKDIR /app

# Sadece package dosyalarini oneden kopyala (Docker cache mekanizmasindan faydalanmak icin)
COPY package*.json ./
COPY src/web/react-app/package*.json ./src/web/react-app/

# Root dizinindeki bagimliliklari tam olarak kur (Frontend build'i icin de gerekli dev dependencies dahil)
RUN npm install

# Frontend dizinindeki bagimliliklari tam olarak kur
RUN cd src/web/react-app && npm install

# Tum proje dosyalarini kopyala
COPY . .

# Tum projeyi build et (backend tsc, asset kopyalama ve frontend vite)
RUN npm run build

# Dev bagimliliklarini kaldir (sadece production bagimliliklari kalsin)
# better-sqlite3 ve sqlite-vec native modulleri henuz builder ortaminda derlenmis olur
RUN npm prune --omit=dev


# Stage 2: Production
# Boyutu optimum tutabilmek adina multistage yapiyoruz ancak better-sqlite3
# derlemesinin runtime'da sorun cikartmamasi icin Bookworm tabaninda kaliyoruz.
FROM node:22-bookworm AS runner

WORKDIR /app

# Production mode
ENV NODE_ENV=production
ENV PORT=3001

# Production bagimliliklarini builder asamasindan kopyala (yeniden npm install yapma)
# Bu sayede native moduller (better-sqlite3, sqlite-vec) dogru platformda derlenmis olur
COPY --from=builder /app/node_modules ./node_modules

# package dosyalarini kopyala
COPY package*.json ./

# Builder asamasindan hazir dist klasorunu (backend ve frontend bir arada) kopyala
COPY --from=builder /app/dist ./dist

# Veritabani icin kullanilacak veri klasorunu olustur
RUN mkdir -p /app/data

# Sunulan portu bildir
EXPOSE 3001

# Saglik kontrolu
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:3001/api/health').then(r => { process.exit(r.ok ? 0 : 1) }).catch(() => process.exit(1))"

# Uygulamayi baslat
CMD ["node", "dist/gateway/index.js"]