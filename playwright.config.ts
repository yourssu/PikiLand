import { defineConfig, devices } from "@playwright/test";

const TEST_PORT = 4300;
const TEST_DATABASE_PATH = "./data/pikiland.e2e-test.sqlite";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${TEST_PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  // Boots an isolated server for the test run only: its own port, its own
  // sqlite file, and every auth-relevant env var pinned explicitly so the
  // developer's local .env (real or dummy OAuth secrets, etc.) can never
  // leak in — env values passed here always win over .env file contents.
  // NODE_ENV is deliberately left unset ("test" via Bun default is fine,
  // just never "production") since PIKILAND_UI_PREVIEW/DEBUG are hard
  // disabled whenever NODE_ENV=production (see src/config/debug.ts).
  webServer: {
    command: "bun run src/index.ts",
    url: `http://localhost:${TEST_PORT}`,
    reuseExistingServer: false,
    timeout: 20_000,
    env: {
      PORT: String(TEST_PORT),
      DATABASE_PATH: TEST_DATABASE_PATH,
      DEBUG: "false",
      PIKILAND_UI_PREVIEW: "true",
      PIKILAND_ADMIN_USERS: "e2e-admin",
      GITHUB_CLIENT_ID: "",
      GITHUB_CLIENT_SECRET: "",
      PIKILAND_SERVER_URL: "",
    },
  },
});
