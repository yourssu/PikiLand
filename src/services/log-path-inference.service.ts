export class LogPathInferenceService {
  public inferLogPathFromFilenames(filenames: string[]): string {
    if (!filenames || filenames.length === 0) {
      return "/var/log/production/*.log";
    }

    const set = new Set(filenames);

    // 1. Spring Boot / Java (config files or Gradle/Maven build tools)
    if (
      set.has("application.yml") ||
      set.has("application.yaml") ||
      set.has("application.properties") ||
      set.has("logback-spring.xml") ||
      set.has("logback.xml") ||
      set.has("build.gradle.kts") ||
      set.has("build.gradle") ||
      set.has("pom.xml") ||
      set.has("gradlew") ||
      set.has("mvnw")
    ) {
      return "/var/log/spring/*.log";
    }

    // 2. PM2 / Node.js
    if (set.has("pm2.config.js") || set.has("ecosystem.config.js")) {
      return "/var/log/pm2/*.log";
    }

    // 3. Docker / Docker Compose
    if (set.has("docker-compose.yml") || set.has("docker-compose.yaml")) {
      return "/var/log/docker/*.log";
    }

    // 4. Python / Django / FastAPI
    if (set.has("manage.py") || set.has("pyproject.toml")) {
      return "/var/log/app/*.log";
    }

    // 5. Nginx
    if (set.has("nginx.conf")) {
      return "/var/log/nginx/*.log";
    }

    return "/var/log/production/*.log";
  }
}

export const logPathInferenceService = new LogPathInferenceService();
