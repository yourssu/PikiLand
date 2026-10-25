import { fromHono } from "chanfana";
import { Hono } from "hono";
import { AuthCallback } from "./endpoints/authCallback";
import { IncidentCreate } from "./endpoints/incidentCreate";
import { jwt } from "hono/jwt";

const app = new Hono<{ Bindings: Env }>();

app.use("/api/incidents/*", (c, next) => {
  return jwt({ secret: c.env.JWT_SECRET, alg: "HS256" })(c, next);
});

const openapi = fromHono(app, {
  docs_url: "/docs",
});

openapi.registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
});

openapi.get("/api/auth/callback", AuthCallback);
openapi.post("/api/incidents", IncidentCreate);

export default app;
