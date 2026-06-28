# Stage 1: Install deps + build
FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

# Stage 2: Production runtime
FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

# If using Google Cloud Storage, mount/service-account JSON and set GOOGLE_APPLICATION_CREDENTIALS accordingly.
# Example: -e GOOGLE_APPLICATION_CREDENTIALS=/app/keys/service-account.json

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/settings.json ./settings.json

EXPOSE 8080

CMD ["npm", "start"]
