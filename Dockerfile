# --- Stage 1: Build Jar ---
FROM eclipse-temurin:21-jdk-alpine AS builder
WORKDIR /app

# Copy gradle wrapper & build configuration
COPY gradle gradle
COPY gradlew build.gradle.kts settings.gradle.kts ./
RUN chmod +x gradlew && ./gradlew dependencies --no-daemon

# Copy source code and build executable jar
COPY src src
RUN ./gradlew bootJar --no-daemon -x test

# --- Stage 2: Production Runtime ---
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app

# Set Timezone to Asia/Seoul
RUN apk add --no-cache tzdata && \
    cp /usr/share/zoneinfo/Asia/Seoul /etc/localtime && \
    echo "Asia/Seoul" > /etc/timezone

# Create data directory for persistence
RUN mkdir -p /app/data

# Copy built jar from builder
COPY --from=builder /app/build/libs/*.jar app.jar

EXPOSE 8080

ENTRYPOINT ["java", "-Duser.timezone=Asia/Seoul", "-jar", "app.jar"]
