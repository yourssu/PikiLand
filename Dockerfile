# --- Production Runtime (Bun) ---
FROM oven/bun:1.2-alpine
WORKDIR /app

# Set timezone to Asia/Seoul
RUN apk add --no-cache tzdata curl && \
    cp /usr/share/zoneinfo/Asia/Seoul /etc/localtime && \
    echo "Asia/Seoul" > /etc/timezone

# Create data directory for persistence
RUN mkdir -p /app/data

# Copy package definition and install dependencies
COPY package.json bun.lock tsconfig.json bunfig.toml ./
RUN bun install --production

# Copy source code and static assets
COPY src/ ./src/
COPY public/ ./public/
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/ || exit 1

ENTRYPOINT ["bun", "src/index.ts"]
