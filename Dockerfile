# Stage 1: Install deps + build
FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: Production runtime
FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

# For Google Cloud Storage, prefer GCP_SA_KEY_B64/GCP_SA_KEY_JSON at runtime.
# A GOOGLE_APPLICATION_CREDENTIALS path is also supported, but only when that JSON file
# is actually mounted into the running container. Do not bake service-account keys into the image.

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/settings.json ./settings.json

EXPOSE 8080

CMD ["npm", "start"]
