import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { webhookRoutes } from "./routes/webhook.routes";
import { authRoutes } from "./routes/auth.routes";
import { settingsRoutes } from "./routes/settings.routes";
import { logReceiverRoutes } from "./routes/log-receiver.routes";
import { viewRoutes } from "./routes/view.routes";

const app = new Hono();

// Global Middlewares
app.use("*", cors());
app.use("/css/*", serveStatic({ root: "./public" }));
app.use("/js/*", serveStatic({ root: "./public" }));

// Route Registration
app.route("/", webhookRoutes);
app.route("/", authRoutes);
app.route("/", viewRoutes);
app.route("/api/settings", settingsRoutes);
app.route("/api/logs", logReceiverRoutes);

const port = parseInt(process.env.PORT || "8080", 10);
console.log(`🏰 PikiLand Web Coordinator running on port ${port} (TypeScript + Bun Engine)`);

export default {
  port,
  fetch: app.fetch,
};
export { app };
