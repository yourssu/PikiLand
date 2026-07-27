# --- Production Runtime (Pre-built Jar) ---
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app

# Set Timezone to Asia/Seoul
RUN apk add --no-cache tzdata && \
    cp /usr/share/zoneinfo/Asia/Seoul /etc/localtime && \
    echo "Asia/Seoul" > /etc/timezone

# Create data directory for persistence
RUN mkdir -p /app/data

# Copy pre-built executable jar from build directory
COPY build/libs/*.jar app.jar

EXPOSE 8080

ENTRYPOINT ["java", "-Duser.timezone=Asia/Seoul", "-jar", "app.jar"]
