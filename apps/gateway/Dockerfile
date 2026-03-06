FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install --include=dev
COPY tsconfig.json ./
COPY src/ ./src/
COPY config/ ./config/
COPY public/ ./public/
RUN ./node_modules/.bin/tsc

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist   ./dist
COPY --from=builder /app/config ./config
COPY --from=builder /app/public ./public
RUN mkdir -p /data
EXPOSE 3000
CMD ["node", "dist/index.js"]
