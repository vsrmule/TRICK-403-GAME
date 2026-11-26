# Trick 304: one container serves the website, the game server and the APK download.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
ENV NODE_ENV=production PORT=3304
EXPOSE 3304
CMD ["npm", "start"]
