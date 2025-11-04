# =========================
# Stage 1: Builder
# =========================
FROM node:22-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++ bash

# Install Chromium for Puppeteer
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    fontconfig \
    chromium-chromedriver

# Puppeteer env
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    CHROME_BIN=/usr/bin/chromium

# Copy package.json & lock files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Copy environment file for build
COPY .env.production .env

# Build NestJS app
RUN npm run build


# =========================
# Stage 2: Production
# =========================
FROM node:22-alpine

WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    fontconfig \
    bash \
    wget

# Puppeteer environment
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    CHROME_BIN=/usr/bin/chromium \
    PATH=/usr/local/bin:$PATH

ARG MONGODB_URI
ARG JWT_SECRET
ARG EMAIL_USER
ARG EMAIL_PASS
ARG ENCRYPTION_KEY
ARG AZURE_STORAGE_CONNECTION_STRING
ARG EMAIL_FROM_NAME
ARG EMAIL_FROM_ADDRESS
ARG CLEAN_DATABASE
ARG AZURE_SERVICE_BUS_CONNECTION_STRING
ARG REDIS_CONNECTION_STRING

ENV MONGODB_URI=${MONGODB_URI}
ENV JWT_SECRET=${JWT_SECRET}
ENV EMAIL_USER=${EMAIL_USER}
ENV EMAIL_PASS=${EMAIL_PASS}
ENV ENCRYPTION_KEY=${ENCRYPTION_KEY}
ENV AZURE_STORAGE_CONNECTION_STRING=${AZURE_STORAGE_CONNECTION_STRING}
ENV EMAIL_FROM_NAME=${EMAIL_FROM_NAME}
ENV EMAIL_FROM_ADDRESS=${EMAIL_FROM_ADDRESS}
ENV CLEAN_DATABASE=${CLEAN_DATABASE}
ENV AZURE_SERVICE_BUS_CONNECTION_STRING=${AZURE_SERVICE_BUS_CONNECTION_STRING}
ENV REDIS_CONNECTION_STRING=${REDIS_CONNECTION_STRING}

# Copy package.json & lock
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production

# Copy built app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/.env .env
COPY --from=builder /app/templates ./templates

# Expose app port
EXPOSE 5000

# Run as root (admin privileges inside container)
CMD ["sh", "-c", "if [ \"$CLEAN_DATABASE\" = 1 ]; then node scripts/seed-database.js --clean; fi && npm run start:prod"]