FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json ./
# Explicit --include=dev so tsc is always present regardless of NODE_ENV
RUN npm install --include=dev
COPY tsconfig.json ./
COPY src/ ./src/
# Call tsc via its explicit path to avoid any $PATH ambiguity
RUN ./node_modules/.bin/tsc

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
EXPOSE 3002
CMD ["node", "dist/index.js"]
