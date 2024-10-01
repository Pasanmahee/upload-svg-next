# Stage 1: Build the application
FROM node:18-alpine AS builder

WORKDIR /app

# Install curl for downloading external files
RUN apk add --no-cache curl

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

# Install curl for downloading external files
RUN apk add --no-cache curl

# Set environment variables for Next.js
ENV NODE_ENV=production
ENV PORT=8080
ENV GOOGLE_APPLICATION_CREDENTIALS=/app/image-processing-server-435318-8550509a53e7.json 

# Copy build files and node_modules from builder
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Download the image-processing-server-435318-8550509a53e7.json file from the Node.js server
RUN curl -o /app/image-processing-server-435318-8550509a53e7.json "https://gcr-json-file-server-897398451684.us-central1.run.app/download-json"

# Expose the Google Cloud Run port
EXPOSE 8080

# Start the Next.js app and listen on port 8080
CMD ["npm", "start"]
