# Stage 1: Build the application
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package.json and package-lock.json for dependencies installation
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm install

# Copy the entire project
COPY . .

# Build the Next.js app
RUN npm run build

# Stage 2: Setup a production environment
FROM node:18-alpine AS runner

WORKDIR /app

# Set environment variables for Next.js
ENV NODE_ENV=production

# Copy build files and node_modules from builder
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Expose the application port
EXPOSE 3000

# Start the Next.js app
CMD ["npm", "start"]
