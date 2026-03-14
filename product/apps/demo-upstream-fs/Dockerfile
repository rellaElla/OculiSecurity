FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install --include=dev
COPY tsconfig.json ./
COPY src/ ./src/
RUN ./node_modules/.bin/tsc

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
RUN mkdir -p /app/demo-data && \
    echo "Hello from the Oculi Security Gateway demo!" > /app/demo-data/hello.txt && \
    printf '{"appName":"demo","version":"1.0.0","password":"super-secret-should-be-redacted","apiKey":"sk-demo-key-also-redacted","allowedHosts":["localhost"]}' \
    > /app/demo-data/config.json
ENV FS_DEMO_DATA_DIR=/app/demo-data
EXPOSE 3001
CMD ["node", "dist/index.js"]
